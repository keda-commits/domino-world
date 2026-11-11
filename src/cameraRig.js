import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// カメラ操作：OrbitControls + 連鎖先端の自動追尾 + 全体ビュー + キー移動
export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.1;
    c.minDistance = 6;
    c.maxDistance = 160;
    c.maxPolarAngle = 1.35;
    c.minPolarAngle = 0.25;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.screenSpacePanning = false;
    this.follow = true;
    this.keys = new Set();
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this.flyTo = null;
    c.addEventListener('start', () => { this.flyTo = null; });
  }
  setView(target, distance, polar = 0.85, azimuth = null) {
    const c = this.controls;
    const az = azimuth ?? Math.atan2(this.camera.position.x - c.target.x, this.camera.position.z - c.target.z);
    const pos = new THREE.Vector3(
      target.x + Math.sin(az) * Math.sin(polar) * distance,
      target.y + Math.cos(polar) * distance,
      target.z + Math.cos(az) * Math.sin(polar) * distance,
    );
    this.flyTo = { target: target.clone(), pos };
  }
  overview() {
    this.follow = false;
    this.setView(new THREE.Vector3(0, 0, 4), 105, 0.75, 0);
  }
  update(dt, focus) {
    const c = this.controls;
    if (this.flyTo) {
      const k = Math.min(1, dt * 3);
      c.target.lerp(this.flyTo.target, k);
      this.camera.position.lerp(this.flyTo.pos, k);
      if (this.camera.position.distanceTo(this.flyTo.pos) < 0.3) this.flyTo = null;
    } else if (this.follow && focus) {
      this._v.copy(focus).sub(c.target).multiplyScalar(Math.min(1, dt * 2.5));
      c.target.add(this._v);
      this.camera.position.add(this._v);
    }
    // キー移動
    if (this.keys.size) {
      this.camera.getWorldDirection(this._f);
      this._f.y = 0; this._f.normalize();
      this._r.set(-this._f.z, 0, this._f.x);
      const sp = dt * Math.max(10, this.camera.position.distanceTo(c.target) * 0.9);
      const mv = this._v.set(0, 0, 0);
      if (this.keys.has('w')) mv.add(this._f);
      if (this.keys.has('s')) mv.sub(this._f);
      if (this.keys.has('d')) mv.add(this._r);
      if (this.keys.has('a')) mv.sub(this._r);
      if (mv.lengthSq() > 0) {
        mv.normalize().multiplyScalar(sp);
        c.target.add(mv);
        this.camera.position.add(mv);
        this.follow = false;
        this.flyTo = null;
      }
    }
    c.update();
  }
}
