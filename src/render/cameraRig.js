import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * カメラ操作（v0.3 で作り直し）
 * - 左ドラッグ：回転／右ドラッグ：平行移動／ホイール：カーソル位置へズーム／WASD：平行移動
 * - 視点ボタン（建設・観賞・俯瞰・リセット）は「その位置へ一度だけ移動」。その後は勝手に動かない
 * - 連鎖追跡だけは明示的に選んだときに追いかける（回転・ズームしながら追える。平行移動すると解除）
 * - 連鎖中の自動カメラは ON/OFF 可。プレイヤーが触ったら、その連鎖の間は自動カメラを止める
 */
export const VIEWS = { build: '建設', view: '観賞', chain: '連鎖追跡', overview: '俯瞰' };

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    const c = (this.controls = new OrbitControls(camera, dom));
    c.enableDamping = true; c.dampingFactor = 0.12;
    c.minDistance = 2.5; c.maxDistance = 240;
    c.maxPolarAngle = 1.48; c.minPolarAngle = 0.05;
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.rotateSpeed = 0.7;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.follow = false; // 連鎖追跡
    this.auto = true; // 連鎖中の自動カメラ
    this.autoSuspended = false; // その連鎖中はプレイヤーが操作したので止める
    this.locked = false; // ガチャ等の演出中
    this.keys = new Set();
    this.fly = null;
    this.shot = null;
    this.shotT = 0;
    this.listeners = [];
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3();
    c.addEventListener('start', () => this.userInput('drag'));
    dom.addEventListener('wheel', () => this.userInput('wheel'), { passive: true });
  }

  onChange(fn) { this.listeners.push(fn); }
  emit() { this.listeners.forEach((f) => f()); }

  /** プレイヤーがカメラを触った */
  userInput(kind) {
    if (this.locked) return;
    this.fly = null;
    if (this.running && this.auto) { this.autoSuspended = true; this.shot = null; this.emit(); }
    void kind;
  }

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
  /** 方位・仰角・距離を指定して見る */
  orbitView(target, dist, polar, azimuth = null, dur = 0.9) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const az = azimuth ?? Math.atan2(off.x, off.z);
    const pos = new THREE.Vector3(target.x + Math.sin(az) * Math.sin(polar) * dist, target.y + Math.cos(polar) * dist, target.z + Math.cos(az) * Math.sin(polar) * dist);
    this.flyTo(pos, target, dur);
  }

  /** 視点ボタン */
  setView(name, ctx) {
    this.follow = name === 'chain';
    if (name === 'build') this.orbitView(ctx.buildFocus || ctx.center, 30, 0.85);
    if (name === 'view') {
      // 観賞：人の目線くらいの低い位置から、建設の先頭を横から眺める
      const f = ctx.buildFocus || ctx.center;
      const yaw = ctx.buildYaw ?? 0;
      this.flyTo(new THREE.Vector3(f.x + Math.cos(yaw) * 5.5 - Math.sin(yaw) * 4, 1.4, f.z - Math.sin(yaw) * 5.5 - Math.cos(yaw) * 4), new THREE.Vector3(f.x, 0.6, f.z), 1.1);
    }
    if (name === 'overview') this.orbitView(ctx.center, ctx.stageSize * 0.95, 0.72, 0.35, 1.1);
    if (name === 'chain') { const f = ctx.front || ctx.buildFocus; if (f) this.orbitView(f, 14, 1.05); }
    this.view = name;
    this.emit();
  }
  reset(ctx) { this.setView('build', ctx); }

  startRun() { this.running = true; this.autoSuspended = false; this.shot = null; this.emit(); }
  endRun() { this.running = false; this.shot = null; this.emit(); }

  update(dt, ctx) {
    const c = this.controls;
    if (this.fly) {
      const f = this.fly;
      f.t += dt / f.dur;
      const k = ease(Math.min(1, f.t));
      this.camera.position.lerpVectors(f.p0, f.p1, k);
      c.target.lerpVectors(f.t0, f.t1, k);
      if (f.t >= 1) this.fly = null;
    } else if (!this.locked) {
      // 連鎖中の自動カメラ（プレイヤーが触っていなければ）
      if (this.running && this.auto && !this.autoSuspended && ctx.front) this.director(dt, ctx);
      else if (this.follow) {
        const f = this.running ? ctx.front : ctx.buildFocus;
        if (f) { this._v.copy(f).sub(c.target).multiplyScalar(Math.min(1, dt * 3)); c.target.add(this._v); this.camera.position.add(this._v); }
      }
    }
    // WASD：画面基準の平行移動
    if (this.keys.size && !this.locked) {
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
        this.fly = null; this.follow = false; this.userInput('keys');
      }
    }
    if (this.camera.position.y < 0.5) this.camera.position.y = 0.5;
    c.update();
    return { dof: this.running && this.shot && this.shot.dof, focusDist: this.camera.position.distanceTo(c.target) };
  }

  /** テレビ中継風：先頭を横から追う低いショットを中心に、ときどき引きや先回り */
  director(dt, ctx) {
    const c = this.controls;
    this.shotT -= dt;
    if (ctx.event) { this.shot = { type: 'event', p: ctx.event.clone(), t: 3.0 }; this.shotT = 3.0; ctx.event = null; this.cutTo(); }
    if (!this.shot || this.shotT <= 0) {
      const r = Math.random();
      const type = r < 0.5 ? 'track' : r < 0.7 ? 'low' : r < 0.85 ? 'ahead' : 'wide';
      this.shot = { type, side: Math.random() < 0.5 ? 1 : -1, dof: type === 'track' || type === 'low' };
      this.shotT = type === 'wide' ? 3.5 : 6 + Math.random() * 2;
      this.cutTo();
    }
    const f = ctx.front, yaw = ctx.frontYaw ?? 0, s = this.shot;
    const nx = Math.cos(yaw), nz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
    let pos, tgt;
    switch (s.type) {
      case 'track': pos = new THREE.Vector3(f.x + nx * s.side * 6 - fx * 2, 2.6, f.z + nz * s.side * 6 - fz * 2); tgt = new THREE.Vector3(f.x + fx * 1.5, 0.5, f.z + fz * 1.5); break;
      case 'low': pos = new THREE.Vector3(f.x + nx * s.side * 2.2 + fx * 3.2, 0.7, f.z + nz * s.side * 2.2 + fz * 3.2); tgt = new THREE.Vector3(f.x - fx * 1.5, 0.5, f.z - fz * 1.5); break;
      case 'ahead': { const a = ctx.ahead || f; pos = new THREE.Vector3(a.x + nx * s.side * 3 + fx * 2, 1.2, a.z + nz * s.side * 3 + fz * 2); tgt = new THREE.Vector3(f.x, 0.5, f.z); break; }
      case 'wide': pos = new THREE.Vector3(f.x + nx * s.side * 18, 22, f.z + nz * s.side * 18); tgt = new THREE.Vector3(f.x + fx * 6, 0, f.z + fz * 6); break;
      case 'event': pos = new THREE.Vector3(s.p.x + 7, 6, s.p.z + 9); tgt = s.p.clone().setY(1); break;
    }
    // 追従は先頭の動きに合わせてなめらかに（ショットの途中でカメラが跳ばない）
    const k = s.type === 'ahead' || s.type === 'event' ? Math.min(1, dt * 1.5) : Math.min(1, dt * 4);
    this.camera.position.lerp(pos, k);
    c.target.lerp(tgt, k);
  }
  cutTo() { this.cutFlag = true; }
}
