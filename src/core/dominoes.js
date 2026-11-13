import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CFG } from '../config.js';
import { R } from './physics.js';

/**
 * 物理ドミノの管理。
 * - 全ドミノが Rapier の剛体（立っている間はスリープ）
 * - 倒れて落ち着いたドミノは固定剛体に切り替えて計算を止める（実際に倒れた姿勢のまま）
 * - 描画は InstancedMesh 1つ（色はインスタンスごと、白い目はシェーダで合成）
 */
export const PALETTE = ['#ff3b3b', '#ff8a1f', '#ffd21f', '#3ccf5a', '#1fa8ff', '#6b5cff', '#ff5cb0', '#ffffff', '#22c2b5'];
const MAX = 3200;

function pipMask() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 128, 256);
  x.fillStyle = '#8a8a8a'; x.fillRect(14, 125, 100, 6); // 中央の溝
  x.fillStyle = '#fff';
  const dot = (px, py) => { x.beginPath(); x.arc(px, py, 11, 0, Math.PI * 2); x.fill(); };
  [[36, 40], [92, 40], [64, 64], [36, 88], [92, 88]].forEach(([a, b]) => dot(a, b));
  [[40, 168], [88, 168], [40, 216], [88, 216]].forEach(([a, b]) => dot(a, b));
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

function makeMaterials() {
  const mask = pipMask();
  const face = new THREE.MeshPhysicalMaterial({ map: mask, roughness: 0.22, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.15 });
  face.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', '#include <color_fragment>\n float pipM = texture2D(map, vMapUv).r;\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.95, 0.9), pipM);');
  };
  const side = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.15 });
  // RoundedBoxGeometry も BoxGeometry と同じ面順: +x, -x, +y, -y, +z, -z
  return [side, side, side, side, face, face];
}

export class Dominoes {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.list = new Set();
    this.free = [];
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);
    const geo = new RoundedBoxGeometry(CFG.dominoW, CFG.dominoH, CFG.dominoT, 2, 0.035);
    this.mesh = new THREE.InstancedMesh(geo, makeMaterials(), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color('#fff');
    for (let i = 0; i < MAX; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, col); }
    scene.add(this.mesh);
    this._zero = zero;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this.nextId = 1;
    this.onTopple = null; // (d) => void
    this.time = 0;
    this.dirty = true;
    // 特殊ドミノの飾り（プレゼント・四つ葉）
    this.decor = new Map();
  }

  get count() { return this.list.size; }

  /**
   * ドミノを作る。pose: {x,y,z,yaw,pitch?}。y は底面の高さ。
   * opts: {slot, kind, color, lying, quat}
   */
  create(pose, opts = {}) {
    if (!this.free.length) return null;
    const kind = opts.kind || 'normal';
    const w = kind === 'wide' ? CFG.wideW : CFG.dominoW;
    const idx = this.free.pop();
    const bd = R.RigidBodyDesc.dynamic().setCanSleep(true).setLinearDamping(0.05).setAngularDamping(0.2);
    let q;
    if (opts.quat) {
      q = opts.quat;
      bd.setTranslation(pose.x, pose.y, pose.z);
    } else if (opts.lying) {
      // 寝かせた状態（散らばったドミノ）
      const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, pose.yaw || 0, 0, 'YXZ'));
      q = { x: qq.x, y: qq.y, z: qq.z, w: qq.w };
      bd.setTranslation(pose.x, (pose.y || 0) + CFG.dominoT / 2 + 0.01, pose.z);
    } else {
      q = this.physics.quatYawPitch(pose.yaw || 0, pose.pitch || 0);
      bd.setTranslation(pose.x, (pose.y || 0) + CFG.dominoH / 2 + 0.002, pose.z);
    }
    bd.setRotation(q);
    const body = this.physics.world.createRigidBody(bd);
    const r = 0.025;
    const cd = R.ColliderDesc.roundCuboid(w / 2 - r, CFG.dominoH / 2 - r, CFG.dominoT / 2 - r, r)
      .setDensity(kind === 'wide' ? 0.9 : 0.7).setFriction(0.45).setRestitution(0.05);
    const collider = this.physics.world.createCollider(cd, body);
    body.sleep();
    const d = {
      id: this.nextId++, idx, body, collider, kind, slot: opts.slot || null,
      toppled: false, toppledAt: -1, runId: -1, frozen: false, standing: !opts.lying && !opts.quat,
      drop: opts.drop ? 0 : 1, w, accident: false,
    };
    this.list.add(d);
    const color = opts.color || (kind === 'present' ? '#ffcf3a' : kind === 'clover' ? '#3fd16b' : PALETTE[(opts.colorIndex ?? d.id) % 7]);
    d.color = color;
    this.mesh.setColorAt(idx, this._c.set(color));
    this.mesh.instanceColor.needsUpdate = true;
    if (kind === 'present' || kind === 'clover') this.addDecor(d);
    this.writeMatrix(d);
    if (opts.lying || opts.quat) {
      d.toppled = true;
      if (opts.frozen) { body.setBodyType(R.RigidBodyType.Fixed, false); d.frozen = true; }
      else { d.frozen = false; body.wakeUp(); }
    }
    return d;
  }

  addDecor(d) {
    const g = new THREE.Group();
    if (d.kind === 'present') {
      const rib = new THREE.MeshStandardMaterial({ color: '#e8233f', roughness: 0.4 });
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.1, CFG.dominoH + 0.02, CFG.dominoT + 0.02), rib);
      const b = new THREE.Mesh(new THREE.BoxGeometry(CFG.dominoW + 0.02, 0.1, CFG.dominoT + 0.02), rib);
      const bow1 = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.04, 8, 14), rib);
      bow1.position.set(-0.1, CFG.dominoH / 2 + 0.1, 0); bow1.rotation.y = Math.PI / 2; bow1.rotation.z = 0.6;
      const bow2 = bow1.clone(); bow2.position.x = 0.1; bow2.rotation.z = -0.6;
      g.add(a, b, bow1, bow2);
    } else {
      const leaf = new THREE.MeshStandardMaterial({ color: '#1f9e45', roughness: 0.5, emissive: '#0a3d18' });
      for (let i = 0; i < 4; i++) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), leaf);
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        l.position.set(Math.cos(a) * 0.09, 0.15 + Math.sin(a) * 0.09, CFG.dominoT / 2 + 0.02);
        l.scale.set(1, 1, 0.3);
        g.add(l);
        const l2 = l.clone(); l2.position.z = -l.position.z; g.add(l2);
      }
    }
    g.traverse((c) => { c.castShadow = true; });
    this.scene.add(g);
    this.decor.set(d, g);
  }

  remove(d) {
    if (!this.list.has(d)) return;
    this.list.delete(d);
    this.physics.world.removeRigidBody(d.body);
    this.mesh.setMatrixAt(d.idx, this._zero);
    this.free.push(d.idx);
    const g = this.decor.get(d);
    if (g) { this.scene.remove(g); this.decor.delete(d); }
    if (d.slot && d.slot.domino === d) d.slot.domino = null;
    d.removed = true;
    this.dirty = true;
  }

  /** 倒れたドミノを、その場のスロットに立て直す（剛体を作り直す） */
  restand(d) {
    const slot = d.slot;
    if (!slot) return null;
    const kind = d.kind;
    const color = d.color;
    this.remove(d);
    const nd = this.create(slot, { slot, kind, color, drop: true });
    slot.domino = nd;
    return nd;
  }

  upY(d) {
    const r = d.body.rotation();
    return 1 - 2 * (r.x * r.x + r.z * r.z);
  }

  /** 固定ステップごとに呼ぶ：転倒の検出と固定化 */
  step(dt) {
    this.time += dt;
  }

  /** 毎フレーム：起きている剛体を検出して描画行列・転倒判定を更新 */
  update(dt) {
    this.time = this.physics.time;
    let awake = 0;
    for (const d of this.list) {
      if (d.drop < 1) { d.drop = Math.min(1, d.drop + dt * 6); this.writeMatrix(d); }
      if (d.frozen) continue;
      const b = d.body;
      if (b.isSleeping()) continue;
      awake++;
      this.writeMatrix(d);
      const up = this.upY(d);
      if (d.standing && up < 0.97) d.standing = false;
      if (!d.toppled && up < CFG.toppleUpY) {
        d.toppled = true;
        d.toppledAt = this.time;
        if (this.onTopple) this.onTopple(d);
      }
      if (d.toppled && this.time - d.toppledAt > CFG.freezeAfter) {
        const lv = b.linvel(), av = b.angvel();
        const still = lv.x * lv.x + lv.y * lv.y + lv.z * lv.z < 0.08 && av.x * av.x + av.y * av.y + av.z * av.z < 0.3;
        if (still || this.time - d.toppledAt > 4) {
          b.setBodyType(R.RigidBodyType.Fixed, false);
          d.frozen = true;
        }
      }
      // 立ったまま押されて落ち着いたら（ルンバに押されただけ等）再スリープ扱い
      if (!d.toppled && up > 0.97) {
        const lv = b.linvel();
        if (lv.x * lv.x + lv.z * lv.z < 0.0004) d.standing = true;
      }
    }
    this.awake = awake;
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
  }

  writeMatrix(d) {
    const t = d.body.translation(), r = d.body.rotation();
    this._p.set(t.x, t.y, t.z);
    if (d.drop < 1) this._p.y += (1 - d.drop) * (1 - d.drop) * 1.2;
    this._q.set(r.x, r.y, r.z, r.w);
    this._s.set(d.w / CFG.dominoW, 1, 1);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(d.idx, this._m);
    const g = this.decor.get(d);
    if (g) { g.position.copy(this._p); g.quaternion.copy(this._q); }
    this.dirty = true;
  }

  /** ドミノがスロットの位置で立っているか */
  isStandingAt(d, slot) {
    if (!d || d.toppled) return false;
    const t = d.body.translation();
    const dx = t.x - slot.x, dz = t.z - slot.z;
    return dx * dx + dz * dz < 0.04 && this.upY(d) > 0.95;
  }

  /** 剛体に衝撃を与える（押す・ぶつかる） */
  push(d, dirX, dirZ, strength = 0.05, height = 0.9) {
    const t = d.body.translation();
    d.body.wakeUp();
    d.body.applyImpulseAtPoint({ x: dirX * strength, y: 0, z: dirZ * strength }, { x: t.x, y: t.y - CFG.dominoH / 2 + CFG.dominoH * height, z: t.z }, true);
  }

  clear() { for (const d of [...this.list]) this.remove(d); }

  // 統計（性能計測用）
  stats() {
    let frozen = 0, toppled = 0;
    for (const d of this.list) { if (d.frozen) frozen++; if (d.toppled) toppled++; }
    return { total: this.list.size, awake: this.awake || 0, frozen, toppled };
  }
}
