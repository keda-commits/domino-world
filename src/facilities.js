import * as THREE from 'three';
import { CFG } from './config.js';
import { radiusAt, X_SCALE } from './route.js';
import { crateCapacity, machineRate, factoryRate } from './upgrades.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const shadow = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
const miniGeo = new THREE.BoxGeometry(CFG.dominoW * 0.7, CFG.dominoH * 0.7, CFG.dominoT * 0.9);
const miniMats = ['#ff4d4d', '#ffd93b', '#38b6ff', '#5ad46a', '#ff9a2e', '#7b6cff', '#ff6fb8'].map((c) => std(c, { roughness: 0.4 }));

// ---------------- 倉庫（おもちゃ箱） ----------------
function toyBox(color) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 2.2), std(color));
  box.position.y = 0.9; g.add(box);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.25, 2.4), std('#fff4dc'));
  rim.position.y = 1.85; g.add(rim);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 2.4), std(color));
  lid.position.set(0, 2.7, -1.6); lid.rotation.x = -1.1; g.add(lid);
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Mesh(miniGeo, miniMats[i]);
    d.position.set(-1.1 + (i % 4) * 0.7, 1.95, -0.3 + Math.floor(i / 4) * 0.6);
    d.rotation.set(Math.random() - 0.5, Math.random(), Math.random() - 0.5);
    g.add(d);
  }
  const star = new THREE.Mesh(new THREE.CircleGeometry(0.5, 5), std('#ffe066'));
  star.position.set(0, 0.95, 1.11); g.add(star);
  return shadow(g);
}

export function buildChests(scene, route) {
  const chests = [];
  const cols = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#f08c00', '#d6336c', '#0c8599', '#5f3dc4'];
  const K = 10;
  for (let k = 0; k < K; k++) {
    const th = (k / K) * Math.PI * 2 + 0.2;
    let r = radiusAt(th) - 5;
    let p = new THREE.Vector3();
    // ルートと重ならない位置まで内側へずらす
    for (let it = 0; it < 20; it++) {
      p.set(Math.cos(th) * r * X_SCALE, 0, Math.sin(th) * r);
      let md = Infinity;
      for (let i = 0; i < route.length; i += 2) {
        const dx = route.pos[i * 3] - p.x, dz = route.pos[i * 3 + 2] - p.z;
        md = Math.min(md, dx * dx + dz * dz);
      }
      if (md > 4.2 * 4.2) break;
      r -= 0.8;
    }
    const mesh = toyBox(cols[k % cols.length]);
    mesh.position.copy(p);
    mesh.rotation.y = Math.atan2(p.x, p.z); // 前面が外向き（ルート側）
    scene.add(mesh);
    const spot = p.clone().add(new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(1.9));
    chests.push({ pos: p, spot, mesh });
  }
  return chests;
}

// ---------------- 前線資材置き場 ----------------
export class Crate {
  constructor(scene) {
    this.group = new THREE.Group();
    const wood = std('#c08a4e', { roughness: 0.85 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 1.8), wood);
    base.position.y = 0.12; this.group.add(base);
    [[0, 0.5, 0.85, 2.4, 0.5, 0.12], [0, 0.5, -0.85, 2.4, 0.5, 0.12], [1.15, 0.5, 0, 0.12, 0.5, 1.8], [-1.15, 0.5, 0, 0.12, 0.5, 1.8]].forEach(([x, y, z, w, h, d]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood); m.position.set(x, y, z); this.group.add(m);
    });
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 3), std('#ff4d4d'));
    flag.rotation.z = -Math.PI / 2; flag.position.set(1.4, 2.1, 0); this.group.add(flag);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2), std('#eee'));
    pole.position.set(1.15, 1.1, 0); this.group.add(pole);
    this.minis = [];
    for (let i = 0; i < 24; i++) {
      const d = new THREE.Mesh(miniGeo, miniMats[i % miniMats.length]);
      d.position.set(-0.85 + (i % 6) * 0.34, 0.6 + Math.floor(i / 12) * 0.72, -0.35 + (Math.floor(i / 6) % 2) * 0.7);
      d.visible = false;
      this.group.add(d);
      this.minis.push(d);
    }
    shadow(this.group);
    scene.add(this.group);
    this.pos = this.group.position;
    this.count = 0;
    this.cap = 60;
    this._v = new THREE.Vector3();
  }
  spot(id, out) {
    const a = (id * 2.399) % (Math.PI * 2);
    return out.set(this.pos.x + Math.cos(a) * 1.6, 0, this.pos.z + Math.sin(a) * 1.4);
  }
  update(dt, game) {
    this.cap = crateCapacity(game.levels.basket);
    const tgt = game.route.side(game.buildPtr + 10, 2.8, this._v);
    const d = this.pos.distanceTo(tgt);
    if (d > 4) this.moving = true;
    if (this.moving) {
      const step = Math.min(d, 7 * game.odMult() * dt);
      if (d > 1e-3) this.pos.addScaledVector(tgt.sub(this.pos).normalize(), step);
      if (d < 0.1) this.moving = false;
    }
    const show = Math.min(24, Math.ceil(this.count / Math.max(1, this.cap / 24)));
    for (let i = 0; i < 24; i++) this.minis[i].visible = i < show;
  }
}

// ---------------- ドミノ自動設置機 ----------------
export class Machine {
  constructor(scene) {
    const g = (this.group = new THREE.Group());
    const yellow = std('#ffc21a', { roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 2.4), yellow);
    body.position.y = 0.85; g.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.0), yellow);
    cab.position.set(0, 1.85, -0.6); g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.6, 0.8), std('#8fe0ff', { roughness: 0.1 }));
    win.position.set(0, 1.95, -0.6); g.add(win);
    const track = std('#333');
    [-0.9, 0.9].forEach((x) => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 2.8), track);
      t.position.set(x, 0.3, 0); g.add(t);
    });
    // ホッパー
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.35, 0.9, 12, 1, true), std('#e8423b', { side: THREE.DoubleSide }));
    hop.position.set(0, 1.85, 0.6); g.add(hop);
    // アーム（ルート側＝ +x 側へ伸びる）
    this.arm = new THREE.Group();
    this.arm.position.set(0.7, 1.4, 0.9);
    const armBar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.18), std('#e8423b'));
    armBar.position.x = 0.55; this.arm.add(armBar);
    this.held = new THREE.Mesh(miniGeo, miniMats[0]);
    this.held.position.set(1.05, -0.45, 0); this.arm.add(this.held);
    g.add(this.arm);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshStandardMaterial({ color: '#ff7a00', emissive: '#ff5500', emissiveIntensity: 1 }));
    light.position.set(0, 2.45, -0.6); g.add(light);
    this.light = light;
    this.hopMinis = [];
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(miniGeo, miniMats[(i + 2) % miniMats.length]);
      d.position.set(-0.25 + (i % 3) * 0.25, 1.8 + Math.floor(i / 3) * 0.2, 0.6);
      d.rotation.z = 0.3 * (i - 2);
      g.add(d);
      this.hopMinis.push(d);
    }
    shadow(g);
    g.visible = false;
    scene.add(g);
    this.pos = g.position;
    this.hopper = 0;
    this.timer = 0;
    this.armT = 1;
    this.placed = 0;
    this._v = new THREE.Vector3();
    this.idleNotice = 0;
  }
  update(dt, game) {
    const lv = game.levels.machine;
    this.group.visible = lv > 0;
    if (lv <= 0) return;
    const od = game.odMult();
    const cap = CFG.machineHopper + 10 * lv;
    // 前線資材置き場から補給
    if (this.hopper < cap && game.crate.count > 0 && this.pos.distanceTo(game.crate.pos) < 14) {
      const n = Math.min(game.crate.count, cap - this.hopper, Math.max(1, Math.round(30 * od * dt)));
      game.crate.count -= n;
      this.hopper += n;
    }
    // 倉庫からの直送ライン（レベル×1個/秒）。運搬小人がいなくても少しは動く
    this.direct = (this.direct || 0) + dt * lv * od;
    while (this.direct >= 1) {
      this.direct -= 1;
      if (this.hopper < cap && game.stock > 0) { game.stock--; this.hopper++; }
    }
    // 最前線の内側へ移動
    const tgt = game.route.side(game.buildPtr, -1.5, this._v);
    const d = this.pos.distanceTo(tgt);
    if (d > 0.05) {
      const step = Math.min(d, 10 * od * dt);
      this.pos.addScaledVector(tgt.clone().sub(this.pos).normalize(), step);
    }
    // ルートの進行方向を向く（アームはルート側 = 外向き）
    const yaw = game.route.yawAt(game.buildPtr);
    let dy = yaw - this.group.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.group.rotation.y += dy * Math.min(1, dt * 8);

    const rate = machineRate(lv) * od;
    this.timer = Math.min(this.timer + dt * rate, 2);
    while (this.timer >= 1) {
      if (this.hopper <= 0 || !game.canBuild() || d > 2.5) { this.timer = Math.min(this.timer, 1); break; }
      this.timer -= 1;
      const idx = game.claimBuild();
      this.hopper--;
      this.placed++;
      game.finishPlace(idx, null);
      this.armT = 0;
    }
    this.idleNotice -= dt;
    if (this.hopper <= 0 && this.idleNotice <= 0 && game.canBuild()) {
      this.idleNotice = 4;
      game.fx.floatAt(this.pos.clone().setY(2.4), '補給待ち…', 'warn', 1.5);
    }
    this.armT = Math.min(1, this.armT + dt * rate * 1.5);
    this.arm.rotation.z = -Math.sin(this.armT * Math.PI) * 0.5;
    this.held.visible = this.hopper > 0;
    const show = Math.min(6, Math.ceil(this.hopper / (cap / 6)));
    this.hopMinis.forEach((m, i) => (m.visible = i < show));
    this.light.material.emissiveIntensity = this.hopper > 0 ? 0.6 + Math.sin(performance.now() * 0.02 * od) * 0.5 : 0.1;
    this.group.position.y = Math.abs(Math.sin(performance.now() * 0.03 * od)) * 0.05;
  }
}

// ---------------- ドミノ製造機 ----------------
export class Factory {
  constructor(scene) {
    const g = (this.group = new THREE.Group());
    const body = new THREE.Mesh(new THREE.BoxGeometry(5, 3.6, 4), std('#5c7cfa'));
    body.position.y = 1.8; g.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.6, 2, 4, 1), std('#e8423b'));
    roof.position.y = 4.6; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.8); g.add(roof);
    const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.4, 12), std('#868e96'));
    chim.position.set(1.5, 5.2, -0.8); g.add(chim);
    this.gear = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.25, 6, 10), std('#ffd43b', { metalness: 0.5, roughness: 0.3 }));
    this.gear.position.set(0, 2.2, 2.05); g.add(this.gear);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 4.4), std('#343a40'));
    belt.position.set(0, 0.5, 4.0); g.add(belt);
    this.items = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(miniGeo, miniMats[i]);
      d.visible = false; d.rotation.x = Math.PI / 2;
      g.add(d); this.items.push({ m: d, t: 1 });
    }
    this.puffs = [];
    const puffMat = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.8 });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), puffMat.clone());
      p.visible = false; g.add(p); this.puffs.push({ m: p, t: 1 });
    }
    shadow(g);
    g.position.set(-2, 0, 12);
    g.visible = false;
    scene.add(g);
    this.timer = 0;
    this.produced = 0;
    this.k = 0;
    this.stalled = false;
  }
  update(dt, game) {
    const lv = game.levels.factory;
    this.group.visible = lv > 0;
    if (lv <= 0) return;
    const od = game.odMult();
    this.timer += dt * factoryRate(lv) * od;
    this.stalled = false;
    while (this.timer >= 1) {
      if (game.coins < CFG.factoryCostPerDomino) { this.timer = 1; this.stalled = true; break; }
      this.timer -= 1;
      game.coins -= CFG.factoryCostPerDomino;
      game.stock += 1;
      game.stats.produced++;
      this.produced++;
      const it = this.items[this.k++ % this.items.length];
      it.t = 0;
      const p = this.puffs[this.k % this.puffs.length];
      p.t = 0;
    }
    this.gear.rotation.z += dt * 3 * od;
    for (const it of this.items) {
      if (it.t >= 1) { it.m.visible = false; continue; }
      it.t = Math.min(1, it.t + dt * 1.2);
      it.m.visible = true;
      it.m.position.set(0, 0.8 + Math.sin(it.t * Math.PI) * 0.3, 2 + it.t * 4);
    }
    for (const p of this.puffs) {
      if (p.t >= 1) { p.m.visible = false; continue; }
      p.t = Math.min(1, p.t + dt * 0.6);
      p.m.visible = true;
      p.m.position.set(1.5 + p.t * 1.5, 6.5 + p.t * 3, -0.8);
      p.m.scale.setScalar(0.6 + p.t * 1.6);
      p.m.material.opacity = 0.8 * (1 - p.t);
    }
  }
}
