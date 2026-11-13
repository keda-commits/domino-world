import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * カメラ：俯瞰 / 建設現場 / 連鎖追跡 / 小人観察 / 自由。
 * 連鎖中は「テレビのドミノ倒し番組」風に自動でカットを切り替える（OFF可）。
 */
export const CAM_MODES = { overview: '俯瞰', build: '建設現場', chain: '連鎖追跡', gnome: '小人観察', free: '自由' };

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    const c = (this.controls = new OrbitControls(camera, dom));
    c.enableDamping = true; c.dampingFactor = 0.1;
    c.minDistance = 3; c.maxDistance = 220;
    c.maxPolarAngle = 1.42; c.minPolarAngle = 0.1;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.screenSpacePanning = false;
    this.mode = 'build';
    this.auto = true; // 連鎖中の自動カメラ
    this.keys = new Set();
    this.dist = 26;
    this.polar = 0.9;
    this.azimuth = 0.6;
    this.target = new THREE.Vector3();
    this.cut = null; // 自動カメラのショット
    this.cutT = 0;
    this.gnomeIdx = 0;
    this.userTouched = 0;
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
    c.addEventListener('start', () => { this.userTouched = 2.5; });
  }

  setMode(m) {
    this.mode = m;
    this.cut = null;
    if (m === 'overview') { this.dist = this.stageSize * 0.95; this.polar = 0.72; }
    if (m === 'build') { this.dist = 32; this.polar = 0.82; }
    if (m === 'chain') { this.dist = 16; this.polar = 1.0; }
    if (m === 'gnome') { this.dist = 5; this.polar = 1.15; }
    this.snap = true;
  }

  /** 直接見たい場所へ */
  lookAt(p, dist, polar) { this.mode = 'free'; this.goal = { p: p.clone(), dist: dist ?? this.dist, polar: polar ?? this.polar }; }

  update(dt, ctx) {
    const c = this.controls;
    this.userTouched -= dt;
    // ユーザーが操作した距離・角度を覚える
    const off = this._v.copy(this.camera.position).sub(c.target);
    const curDist = off.length();
    const curPolar = Math.acos(Math.max(-1, Math.min(1, off.y / curDist)));
    const curAz = Math.atan2(off.x, off.z);
    let want = null, wantDist = this.dist, wantPolar = this.polar, wantAz = null, dof = false;

    if (this.mode === 'free') {
      if (this.goal) { want = this.goal.p; wantDist = this.goal.dist; wantPolar = this.goal.polar; if (c.target.distanceTo(want) < 0.3) this.goal = null; }
    } else if (ctx.running && this.auto && this.mode !== 'gnome') {
      // 自動カメラ：数秒ごとにショットを切り替える
      this.cutT -= dt;
      if (ctx.event) { this.cut = { type: 'event', p: ctx.event.clone(), t: 3.2 }; this.cutT = 3.2; ctx.event = null; }
      if (!this.cut || this.cutT <= 0) {
        const shots = ['side', 'low', 'aerial', 'ahead', 'side'];
        const type = shots[Math.floor(Math.random() * shots.length)];
        this.cut = { type, az: Math.random() * Math.PI * 2 };
        this.cutT = 3.5 + Math.random() * 2.5;
        this.snap = true;
      }
      const f = ctx.front || ctx.focus;
      switch (this.cut.type) {
        case 'side': want = f; wantDist = 10; wantPolar = 1.15; wantAz = ctx.frontYaw != null ? ctx.frontYaw + Math.PI / 2 : this.cut.az; dof = true; break;
        case 'low': want = f; wantDist = 6.5; wantPolar = 1.33; wantAz = ctx.frontYaw != null ? ctx.frontYaw + 2.4 : this.cut.az; dof = true; break;
        case 'aerial': want = f; wantDist = 34; wantPolar = 0.55; break;
        case 'ahead': want = ctx.ahead || f; wantDist = 9; wantPolar = 1.2; wantAz = ctx.frontYaw != null ? ctx.frontYaw : this.cut.az; dof = true; break;
        case 'event': want = this.cut.p; wantDist = 14; wantPolar = 0.95; break;
      }
      this.snapSoft = true;
    } else if (this.mode === 'overview') { want = ctx.center; wantDist = this.stageSize * 0.95; wantPolar = 0.72; }
    else if (this.mode === 'build') { want = ctx.buildFocus || ctx.focus; }
    else if (this.mode === 'chain') { want = ctx.front || ctx.focus; dof = !!ctx.running; }
    else if (this.mode === 'gnome') {
      const list = ctx.gnomes;
      if (list && list.length) { const g = list[this.gnomeIdx % list.length]; want = g.pos.clone().setY(0.6); dof = true; }
    }

    if (want && this.userTouched <= 0) {
      const k = this.snap ? 1 : Math.min(1, dt * (this.snapSoft ? 2.2 : 2.5));
      const nt = c.target.clone().lerp(want, this.snap ? 0.35 : k);
      const delta = nt.clone().sub(c.target);
      c.target.copy(nt);
      this.camera.position.add(delta);
      // 距離・角度
      const kd = Math.min(1, dt * 1.6);
      const nd = curDist + (wantDist - curDist) * kd;
      const np = curPolar + (wantPolar - curPolar) * kd;
      let na = curAz;
      if (wantAz != null) { let d = wantAz - curAz; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; na = curAz + d * Math.min(1, dt * 1.2); }
      this.camera.position.set(c.target.x + Math.sin(na) * Math.sin(np) * nd, c.target.y + Math.cos(np) * nd, c.target.z + Math.cos(na) * Math.sin(np) * nd);
      this.snap = false;
    } else if (want && this.mode !== 'free') {
      // 操作中は注目点だけゆっくり追う
      const delta = want.clone().sub(c.target).multiplyScalar(Math.min(1, dt * 1.2));
      c.target.add(delta); this.camera.position.add(delta);
    }
    // キー移動
    if (this.keys.size) {
      this.camera.getWorldDirection(this._f); this._f.y = 0; this._f.normalize();
      this._r.set(-this._f.z, 0, this._f.x);
      const sp = dt * Math.max(10, curDist * 0.9);
      const mv = new THREE.Vector3();
      if (this.keys.has('w')) mv.add(this._f);
      if (this.keys.has('s')) mv.sub(this._f);
      if (this.keys.has('d')) mv.add(this._r);
      if (this.keys.has('a')) mv.sub(this._r);
      if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); c.target.add(mv); this.camera.position.add(mv); this.mode = 'free'; this.goal = null; }
    }
    if (this.camera.position.y < 0.6) this.camera.position.y = 0.6;
    c.update();
    this.dof = dof;
    return { dof, focusDist: this.camera.position.distanceTo(c.target) };
  }
}
