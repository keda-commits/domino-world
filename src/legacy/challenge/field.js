import * as THREE from 'three';
import { CFG } from './config.js';

// スロットの状態
export const EMPTY = 0, STANDING = 1, FALLING = 2, FALLEN = 3;
// 予約の種類
export const CLAIM_NONE = 0, CLAIM_PLACE = 1, CLAIM_COLLECT = 2, CLAIM_REPAIR = 3;

const PALETTE = ['#ff4d4d', '#ff9a2e', '#ffd93b', '#5ad46a', '#38b6ff', '#7b6cff', '#ff6fb8'];

function pipTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 128);
  x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(4, 62, 56, 4);
  x.fillStyle = '#fffbea';
  const dot = (px, py) => { x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.fill(); };
  x.fillStyle = 'rgba(255,255,255,1)';
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#3a2a20';
  [[20, 22], [44, 42], [32, 32]].forEach(([a, b]) => dot(a, b));
  [[20, 86], [44, 86], [20, 108], [44, 108]].forEach(([a, b]) => dot(a, b));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * ルート上の全スロットのドミノ状態と、その描画 (InstancedMesh) を持つ。
 * abs は「何周目の何番目か」を含む絶対インデックス。スロット = abs mod L。
 */
export class DominoField {
  constructor(route, scene) {
    this.route = route;
    const L = (this.L = route.length);
    this.state = new Uint8Array(L);
    this.abs = new Float64Array(L).fill(-1e9);
    this.t = new Float32Array(L);
    this.dur = new Float32Array(L);
    this.dir = new Int8Array(L);
    this.claim = new Uint8Array(L);
    this.angle = new Float32Array(L);
    this.target = new Float32Array(L);
    this.drop = new Float32Array(L).fill(1); // 0→1 置かれる瞬間の落下アニメ
    this.counts = { standing: 0, falling: 0, fallen: 0 };

    const geo = new THREE.BoxGeometry(CFG.dominoW, CFG.dominoH, CFG.dominoT);
    const face = new THREE.MeshStandardMaterial({ map: pipTexture(), roughness: 0.35, metalness: 0.05 });
    const plain = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.05 });
    // BoxGeometry の面順: +x, -x, +y, -y, +z, -z。広い面 (±z) にだけ目を描く
    const mat = [plain, plain, plain, plain, face, face];
    this.mesh = new THREE.InstancedMesh(geo, mat, L);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < L; i++) this.mesh.setColorAt(i, col.set(PALETTE[0]));
    scene.add(this.mesh);
    this.geo = geo;
    this.mat = mat;

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._col = new THREE.Color();
    this.updateMatrices(true);
  }

  slot(abs) { const L = this.L; return ((abs % L) + L) % L; }
  stateAt(abs) { const s = this.slot(abs); return this.abs[s] === abs ? this.state[s] : EMPTY; }
  isStanding(abs) { return this.stateAt(abs) === STANDING; }
  isClaimedPlace(abs) { const s = this.slot(abs); return this.claim[s] === CLAIM_PLACE || this.claim[s] === CLAIM_REPAIR; }

  colorFor(abs) { return PALETTE[((Math.floor(abs / 3) % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

  /** スロットを置く。前の周回の倒れたドミノが残っていたら返り値 1（回収扱い） */
  place(abs) {
    const s = this.slot(abs);
    let recycled = 0;
    if (this.state[s] !== EMPTY && this.abs[s] !== abs) {
      if (this.state[s] === FALLEN || this.state[s] === FALLING) recycled = 1;
      this._dec(this.state[s]);
    }
    this.abs[s] = abs;
    this.state[s] = STANDING;
    this.counts.standing++;
    this.angle[s] = 0;
    this.dir[s] = 1;
    this.claim[s] = CLAIM_NONE;
    this.drop[s] = 0;
    this.mesh.setColorAt(s, this._col.set(this.colorFor(abs)));
    this.mesh.instanceColor.needsUpdate = true;
    return recycled;
  }

  topple(abs, dir, dur, target) {
    const s = this.slot(abs);
    if (this.abs[s] !== abs || this.state[s] !== STANDING) return false;
    this.state[s] = FALLING;
    this.counts.standing--; this.counts.falling++;
    this.t[s] = 0;
    this.dur[s] = dur;
    this.dir[s] = dir;
    this.target[s] = target;
    this.drop[s] = 1;
    return true;
  }

  setTarget(abs, target) { const s = this.slot(abs); if (this.abs[s] === abs) this.target[s] = target; }

  /** 倒れたドミノを立て直す */
  stand(abs) {
    const s = this.slot(abs);
    if (this.abs[s] !== abs || this.state[s] !== FALLEN) return false;
    this.state[s] = STANDING;
    this.counts.fallen--; this.counts.standing++;
    this.claim[s] = CLAIM_NONE;
    return true;
  }

  /** 倒れたドミノを拾う */
  pickUp(abs) {
    const s = this.slot(abs);
    if (this.abs[s] !== abs || this.state[s] !== FALLEN) return false;
    this.state[s] = EMPTY;
    this.counts.fallen--;
    this.claim[s] = CLAIM_NONE;
    this.abs[s] = -1e9;
    return true;
  }

  _dec(st) {
    if (st === STANDING) this.counts.standing--;
    else if (st === FALLING) this.counts.falling--;
    else if (st === FALLEN) this.counts.fallen--;
  }

  update(dt) {
    const L = this.L;
    for (let s = 0; s < L; s++) {
      const st = this.state[s];
      if (st === FALLING) {
        this.t[s] += dt;
        const f = Math.min(1, this.t[s] / this.dur[s]);
        this.angle[s] = this.target[s] * f * f;
        if (f >= 1) { this.state[s] = FALLEN; this.counts.falling--; this.counts.fallen++; }
      } else if (st === FALLEN) {
        this.angle[s] += (this.target[s] - this.angle[s]) * Math.min(1, dt * 10);
      } else if (st === STANDING) {
        if (this.angle[s] !== 0) {
          this.angle[s] *= Math.max(0, 1 - dt * 8);
          if (this.angle[s] < 0.01) this.angle[s] = 0;
        }
        if (this.drop[s] < 1) this.drop[s] = Math.min(1, this.drop[s] + dt * 5);
      }
    }
  }

  updateMatrices() {
    const { route, L } = this;
    const h = CFG.dominoH, t = CFG.dominoT;
    const m = this._m, q = this._q, e = this._e, p = this._p, sc = this._s;
    for (let s = 0; s < L; s++) {
      if (this.state[s] === EMPTY) { this.mesh.setMatrixAt(s, this._zero); continue; }
      const yaw = route.yaw[s];
      const d = this.dir[s] || 1;
      const phi = d * this.angle[s];
      const cy = Math.cos(phi) * h / 2 + d * Math.sin(phi) * t / 2;
      const cz = Math.sin(phi) * h / 2 - d * Math.cos(phi) * t / 2 + d * t / 2;
      let y = cy;
      const dr = this.drop[s];
      if (dr < 1) y += (1 - dr) * (1 - dr) * 1.6 - Math.sin(dr * Math.PI) * 0.05;
      const sy = Math.sin(yaw), cyaw = Math.cos(yaw);
      p.set(route.pos[s * 3] + sy * cz, y, route.pos[s * 3 + 2] + cyaw * cz);
      e.set(phi, yaw, 0);
      q.setFromEuler(e);
      m.compose(p, q, sc);
      this.mesh.setMatrixAt(s, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 全スロットを空にして、場にあったドミノ数を返す */
  clearAll() {
    let n = 0;
    for (let s = 0; s < this.L; s++) {
      if (this.state[s] !== EMPTY) n++;
      this.state[s] = EMPTY; this.claim[s] = 0; this.abs[s] = -1e9; this.angle[s] = 0;
    }
    this.counts = { standing: 0, falling: 0, fallen: 0 };
    return n;
  }
}
