import * as THREE from 'three';

// 画面上に浮かぶ文字（+コイン、！、💫 など）と、3Dの紙吹雪。
export class FX {
  constructor(scene, camera, container) {
    this.scene = scene;
    this.camera = camera;
    this.container = container;
    this.items = [];
    this.pool = [];
    this._v = new THREE.Vector3();

    // 紙吹雪
    const N = 400;
    this.confN = N;
    const geo = new THREE.PlaneGeometry(0.18, 0.12);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.conf = new THREE.InstancedMesh(geo, mat, N);
    this.conf.frustumCulled = false;
    this.confData = [];
    const cols = ['#ff4d4d', '#ffd93b', '#38b6ff', '#5ad46a', '#ff6fb8', '#ff9a2e'];
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      this.confData.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: Math.random() * 6 });
      this.conf.setColorAt(i, c.set(cols[i % cols.length]));
      this.conf.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    this.confNext = 0;
    scene.add(this.conf);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._one = new THREE.Vector3(1, 1, 1);
  }

  _el() {
    // 多すぎる場合は古いものから消す
    while (this.items.length > 45) {
      const old = this.items.shift();
      old.el.remove();
      this.pool.push(old.el);
    }
    const el = this.pool.pop() || document.createElement('div');
    this.container.appendChild(el);
    return el;
  }

  /** ワールド座標に文字を浮かべる */
  floatAt(pos, text, cls = '', life = 1.2, rise = 1.4) {
    const el = this._el();
    el.className = 'fl ' + cls;
    el.textContent = text;
    this.items.push({ el, pos: pos.clone(), obj: null, t: 0, life, rise, yOff: 0 });
  }
  /** オブジェクトに追従する文字 */
  floatObj(obj, text, cls = '', life = 1.2, yOff = 0) {
    const el = this._el();
    el.className = 'fl ' + cls;
    el.textContent = text;
    this.items.push({ el, pos: null, obj, t: 0, life, rise: 0.5, yOff: 1.25 + yOff });
  }

  confetti(pos, n = 60, power = 6) {
    for (let i = 0; i < n; i++) {
      const d = this.confData[this.confNext];
      this.confNext = (this.confNext + 1) % this.confN;
      d.life = 2.5 + Math.random();
      d.p.copy(pos);
      d.p.y += 0.5;
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * power * 0.5;
      d.v.set(Math.cos(a) * sp, power * (0.6 + Math.random() * 0.6), Math.sin(a) * sp);
      d.r.set(Math.random() * 6, Math.random() * 6, 0);
    }
  }

  /** ストッパーを投げる放物線（着地でコールバック） */
  throwArc(from, to, time, cb) {
    if (!this.arcs) this.arcs = [];
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.12), new THREE.MeshStandardMaterial({ color: '#ffd21f' }));
    m.position.copy(from);
    this.scene.add(m);
    this.arcs.push({ m, a: from.clone().setY(1), b: to.clone(), t: 0, time, cb });
  }
  /** 経験値オーブが吸い寄せられる演出 */
  suck(mesh, target) {
    if (!this.sucks) this.sucks = [];
    this.sucks.push({ mesh, a: mesh.position.clone(), b: target.clone(), t: -Math.random() * 0.4 });
  }

  update(dt, w, h) {
    for (let i = (this.arcs || []).length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.t += dt / a.time;
      const k = Math.min(1, a.t);
      a.m.position.lerpVectors(a.a, a.b, k);
      a.m.position.y += Math.sin(k * Math.PI) * 4;
      a.m.rotation.x += dt * 14;
      if (k >= 1) { this.scene.remove(a.m); this.arcs.splice(i, 1); a.cb && a.cb(); }
    }
    for (let i = (this.sucks || []).length - 1; i >= 0; i--) {
      const s = this.sucks[i];
      s.t += dt * 1.3;
      if (s.t < 0) continue;
      const k = Math.min(1, s.t);
      const e = k * k;
      s.mesh.position.lerpVectors(s.a, s.b, e);
      s.mesh.position.y += Math.sin(k * Math.PI) * 2.5;
      s.mesh.scale.setScalar(1 - e * 0.7);
      if (k >= 1) { s.mesh.visible = false; this.sucks.splice(i, 1); this.floatAt(s.b, '+XP', 'coin', 0.6, 0.8); }
    }
    const v = this._v;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.t >= it.life) {
        it.el.remove();
        this.pool.push(it.el);
        this.items.splice(i, 1);
        continue;
      }
      const k = it.t / it.life;
      if (it.obj) v.copy(it.obj.position).setY(it.obj.position.y + it.yOff + k * it.rise);
      else v.copy(it.pos).setY(it.pos.y + k * it.rise);
      v.project(this.camera);
      if (v.z > 1) { it.el.style.opacity = 0; continue; }
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const sc = k < 0.15 ? 0.6 + k * 2.7 : 1;
      it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${sc})`;
      it.el.style.left = '0px';
      it.el.style.top = '0px';
      it.el.style.opacity = k > 0.7 ? (1 - k) / 0.3 : 1;
    }
    // 紙吹雪
    let any = false;
    for (let i = 0; i < this.confN; i++) {
      const d = this.confData[i];
      if (d.life <= 0) continue;
      any = true;
      d.life -= dt;
      d.v.y -= 9 * dt;
      d.v.multiplyScalar(1 - dt * 1.2);
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < 0.02) { d.p.y = 0.02; d.v.set(0, 0, 0); }
      d.r.x += dt * d.w; d.r.y += dt * d.w * 0.7;
      this._q.setFromEuler(d.r);
      const s = d.life <= 0 ? 0 : Math.min(1, d.life * 2);
      this._m.compose(d.p, this._q, this._one.set(s, s, s));
      this.conf.setMatrixAt(i, this._m);
    }
    if (any || this._confWas) this.conf.instanceMatrix.needsUpdate = true;
    this._confWas = any;
  }
}
