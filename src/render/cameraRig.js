import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * カメラ操作（Ver.0.4 で作り直し）
 * - 左ドラッグ（何もない場所）：平行移動。つかんだ床の点がカーソルの下に残る（WASD と同じ方向感覚）
 * - 右ドラッグ／Alt＋左ドラッグ：回転
 * - ホイール：カーソル位置へズーム／WASD：平行移動／Home：建設現場へ
 * - 本番（▶倒す！）中は操作ロック。連鎖の先頭を低い位置から滑らかに追う。俯瞰との切り替えだけ可能
 * - 手で動かしたあとに勝手に元の場所へ戻ることはしない
 *
 * WASD の入力は e.code（物理キー）で管理する。日本語入力（IME）中は keyup の e.key が "Process" になり、
 * キーが押されたまま残って一方向へ動き続ける原因になっていた。さらに blur・タブ切り替え・モード遷移でも破棄する。
 */
export const VIEWS = { build: '建設', view: '観賞', chain: '連鎖追跡', overview: '俯瞰' };

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const KEY_CODES = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd' };

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    const c = (this.controls = new OrbitControls(camera, dom));
    c.enableDamping = true; c.dampingFactor = 0.28; // 慣性は控えめ（狙った場所で止まれる）
    c.minDistance = 2.5; c.maxDistance = 240;
    c.maxPolarAngle = 1.48; c.minPolarAngle = 0.05;
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.rotateSpeed = 0.7;
    c.enablePan = false; // 平行移動は自前（床をつかむ方式）
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.keys = new Set();
    this.fly = null;
    this.locked = false; // ガチャ演出中
    this.runLock = false; // 本番中
    this.runView = 'chase'; // 本番中：chase（連鎖追跡）/ overview（俯瞰）
    this.listeners = [];
    this.pan = null;
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
    this._ray = new THREE.Raycaster(); this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.smoothFront = null;
    c.addEventListener('start', () => { this.fly = null; });
    dom.addEventListener('wheel', () => { if (!this.inputBlocked()) this.fly = null; }, { passive: true });
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach((f) => f()); }
  inputBlocked() { return this.locked || this.runLock; }

  // ---------- キー ----------
  keyDown(code) { const k = KEY_CODES[code]; if (!k || this.inputBlocked()) return false; this.keys.add(k); return true; }
  keyUp(code) { const k = KEY_CODES[code]; if (k) this.keys.delete(k); return !!k; }
  isMoveKey(code) { return !!KEY_CODES[code]; }
  /** 入力状態をすべて破棄（blur・タブ切り替え・モード遷移など） */
  clearInput() {
    this.keys.clear();
    this.pan = null;
    // OrbitControls の回転途中の状態も止める
    const c = this.controls;
    if (c.state !== undefined && c.state !== -1) { c.dispatchEvent({ type: 'end' }); c.state = -1; }
    c._rotateDelta && c._rotateDelta.set(0, 0);
    c._sphericalDelta && c._sphericalDelta.set(0, 0, 0);
    c._panOffset && c._panOffset.set(0, 0, 0);
  }

  /** 回転（右ドラッグ／Alt＋左）を許可するか */
  setRotateButton(alt) { this.controls.mouseButtons.LEFT = alt ? THREE.MOUSE.ROTATE : null; }
  setEnabled(on) { this.controls.enabled = on; }

  // ---------- 床をつかむ平行移動 ----------
  floorAt(ndc, out) { this._ray.setFromCamera(ndc, this.camera); return this._ray.ray.intersectPlane(this._plane, out); }
  panStart(ndc) {
    if (this.inputBlocked()) return false;
    const c = this.controls;
    const dist = this.camera.position.distanceTo(c.target);
    const p = this.floorAt(ndc, new THREE.Vector3());
    this.fly = null;
    // 地平線に近い遠い点はつかまない（わずかなマウス移動で大きく飛ぶため）→ 画面基準の移動にする
    const anchor = p && p.distanceTo(this.camera.position) < dist * 2.2 ? p.clone() : null;
    this.pan = { anchor, last: ndc.clone(), dist };
    return true;
  }
  panMove(ndc) {
    const pn = this.pan;
    if (!pn || this.inputBlocked()) return;
    const c = this.controls;
    if (pn.anchor) {
      const now = this.floorAt(ndc, this._v);
      // 床の点がカーソルの下に残るように動かす（つかんだ点が手前にある限り移動量は有限）
      if (now && now.distanceTo(this.camera.position) < pn.dist * 3) {
        const d = this._f.copy(pn.anchor).sub(now); d.y = 0;
        this.camera.position.add(d); c.target.add(d);
        pn.last.copy(ndc);
        return;
      }
    }
    // 画面基準：画面の端から端まで動かすと、ほぼ注目距離ぶん動く
    const dist = this.camera.position.distanceTo(c.target);
    this.camera.getWorldDirection(this._f); this._f.y = 0; this._f.normalize();
    this._r.set(-this._f.z, 0, this._f.x);
    const dx = (ndc.x - pn.last.x) * dist * 0.8, dy = (ndc.y - pn.last.y) * dist * 0.8;
    const mv = this._v.copy(this._r).multiplyScalar(-dx).addScaledVector(this._f, -dy);
    this.camera.position.add(mv); c.target.add(mv);
    pn.last.copy(ndc);
  }
  panEnd() { this.pan = null; }

  /** 位置と注目点へなめらかに移動 */
  flyTo(pos, target, dur = 0.9) {
    this.fly = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos.clone(), t1: target.clone(), t: 0, dur };
  }
  /** 今の向き・距離を保ったまま注目点だけ移す */
  focusOn(target, dist = null, dur = 0.7) {
    const off = this.camera.position.clone().sub(this.controls.target);
    if (dist) off.setLength(dist);
    this.flyTo(target.clone().add(off), target, dur);
  }
  orbitView(target, dist, polar, azimuth = null, dur = 0.9) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const az = azimuth ?? Math.atan2(off.x, off.z);
    const pos = new THREE.Vector3(target.x + Math.sin(az) * Math.sin(polar) * dist, target.y + Math.cos(polar) * dist, target.z + Math.cos(az) * Math.sin(polar) * dist);
    this.flyTo(pos, target, dur);
  }

  /** 視点ボタン（建設中） */
  setView(name, ctx) {
    if (this.runLock) { this.runView = name === 'overview' ? 'overview' : 'chase'; this.view = name; this.emit(); return; }
    if (name === 'build') this.orbitView(ctx.buildFocus || ctx.center, 30, 0.85);
    if (name === 'view') {
      const f = ctx.buildFocus || ctx.center;
      const yaw = ctx.buildYaw ?? 0;
      this.flyTo(new THREE.Vector3(f.x + Math.cos(yaw) * 5.5 - Math.sin(yaw) * 4, 1.4, f.z - Math.sin(yaw) * 5.5 - Math.cos(yaw) * 4), new THREE.Vector3(f.x, 0.6, f.z), 1.1);
    }
    if (name === 'overview') this.orbitView(ctx.center, ctx.stageSize * 0.95, 0.72, 0.35, 1.1);
    if (name === 'chain') { const f = ctx.buildFocus; if (f) this.orbitView(f, 14, 1.05); }
    this.view = name;
    this.emit();
  }
  reset(ctx) { this.setView('build', ctx); }

  startRun() { this.clearInput(); this.runLock = true; this.runView = 'chase'; this.view = 'chain'; this.smoothFront = null; this.chaseSide = null; this.controls.enabled = false; this.fly = null; this.emit(); }
  endRun() { this.runLock = false; this.controls.enabled = true; this.clearInput(); this.emit(); }

  update(rawDt, ctx) {
    const dt = Math.min(rawDt, 0.05); // 巨大なフレーム時間で遠くへ飛ばない
    const c = this.controls;
    if (this.fly) {
      const f = this.fly;
      f.t += dt / f.dur;
      const k = ease(Math.min(1, f.t));
      this.camera.position.lerpVectors(f.p0, f.p1, k);
      c.target.lerpVectors(f.t0, f.t1, k);
      if (f.t >= 1) this.fly = null;
    } else if (this.runLock && !this.locked) {
      this.runCamera(dt, ctx);
    }
    // WASD：画面基準の平行移動
    if (this.keys.size && !this.inputBlocked()) {
      const dist = this.camera.position.distanceTo(c.target);
      this.camera.getWorldDirection(this._f); this._f.y = 0; this._f.normalize();
      this._r.set(-this._f.z, 0, this._f.x);
      const mv = this._v.set(0, 0, 0);
      if (this.keys.has('w')) mv.add(this._f);
      if (this.keys.has('s')) mv.sub(this._f);
      if (this.keys.has('d')) mv.add(this._r);
      if (this.keys.has('a')) mv.sub(this._r);
      if (mv.lengthSq()) {
        mv.normalize().multiplyScalar(dt * Math.max(8, dist * 0.8));
        c.target.add(mv); this.camera.position.add(mv);
        this.fly = null;
      }
    }
    // 安全策：注目点は部屋の範囲（＋余白）から出さない
    if (this.bounds) {
      const b = this.bounds, m = 12;
      const tx = Math.max(b.minX - m, Math.min(b.maxX + m, c.target.x)), tz = Math.max(b.minZ - m, Math.min(b.maxZ + m, c.target.z));
      if (tx !== c.target.x || tz !== c.target.z) { this.camera.position.x += tx - c.target.x; this.camera.position.z += tz - c.target.z; c.target.x = tx; c.target.z = tz; }
    }
    if (this.camera.position.y < 0.5) this.camera.position.y = 0.5;
    if (!this.runLock || this.fly) c.update();
    else this.camera.lookAt(c.target);
    return { dof: this.runLock && this.runView === 'chase', focusDist: this.camera.position.distanceTo(c.target) };
  }

  /** 本番：連鎖の先頭を低い位置から滑らかに追う（カットは無し）。俯瞰では全体＋先頭マーカー */
  runCamera(dt, ctx) {
    const c = this.controls;
    if (!ctx.front) return;
    if (!this.smoothFront) this.smoothFront = ctx.front.clone();
    this.smoothFront.lerp(ctx.front, Math.min(1, dt * 3));
    const f = this.smoothFront;
    if (this.runView === 'overview') {
      const pos = this._v.set(ctx.center.x + ctx.stageSize * 0.15, ctx.stageSize * 0.85, ctx.center.z + ctx.stageSize * 0.62);
      this.camera.position.lerp(pos, Math.min(1, dt * 2));
      c.target.lerp(this._f.set(ctx.center.x, 0, ctx.center.z), Math.min(1, dt * 2));
      return;
    }
    // 進行方向（先頭の向き）をなめらかに
    const yaw = ctx.frontYaw ?? 0;
    if (this.chaseYaw == null) this.chaseYaw = yaw;
    let d = yaw - this.chaseYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.chaseYaw += d * Math.min(1, dt * 1.2);
    // 先頭の斜め後ろ・横の低い位置。カメラが家具の中に入りにくい側を保つ
    if (this.chaseSide == null) this.chaseSide = 1;
    const fx = Math.sin(this.chaseYaw), fz = Math.cos(this.chaseYaw), nx = Math.cos(this.chaseYaw), nz = -Math.sin(this.chaseYaw);
    const s = this.chaseSide;
    const pos = this._v.set(f.x - fx * 4.2 + nx * s * 3.2, 1.7, f.z - fz * 4.2 + nz * s * 3.2);
    const tgt = this._f.set(f.x + fx * 2.2, 0.45, f.z + fz * 2.2);
    this.camera.position.lerp(pos, Math.min(1, dt * 2.6));
    c.target.lerp(tgt, Math.min(1, dt * 3.5));
  }
}
