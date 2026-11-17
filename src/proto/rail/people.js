import * as THREE from 'three';
import { buildGnome } from '../../actors/gnomeModel.js';
import { MAT, rbox } from '../../world/props.js';

/**
 * 試作の「人」：建設担当・エリート建築士・レールはがし隊・鉄道の修理班・駅長。
 * 行動は async の手順（walkTo / act）で書き、シミュレーション時間で進む（早送りしても同じ動き）。
 */
const plankGeo = new THREE.BoxGeometry(0.22, 0.12, 1.3);
const plankMat = MAT.wood('#d4a373');

export class Person {
  constructor(rw, role, pos, name) {
    this.rw = rw; this.role = role; this.name = name;
    this.m = buildGnome(role);
    this.root = this.m.root; this.pos = this.root.position; this.pos.copy(pos);
    this.yaw = 0; this.pose = 'idle'; this.poseT = 0; this.phase = Math.random() * 6;
    this.speed = 3.4; this.busy = false;
    this.waiters = [];
    this.carry = new THREE.Group(); this.carry.position.set(0, 0.7, 0.32); this.m.pivot.add(this.carry);
    rw.scene.add(this.root);
    this.tool = null;
  }
  // ---------- 持ち物 ----------
  hold(kind) {
    this.carry.clear();
    if (kind === 'plank') { const a = new THREE.Mesh(plankGeo, plankMat); a.rotation.x = 0.1; this.carry.add(a); }
    if (kind === 'planks') for (let i = 0; i < 2; i++) { const a = new THREE.Mesh(plankGeo, plankMat); a.position.y = i * 0.13; this.carry.add(a); }
    if (kind === 'domino') for (let i = 0; i < 4; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.55), MAT.plastic(['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c'][i])); d.position.y = i * 0.14; this.carry.add(d); }
    if (kind === 'rail') { const r = new THREE.Mesh(rbox(0.9, 0.07, 1.5, 0.03), MAT.plastic('#9aa7b8')); r.position.set(0, 0.45, -0.1); r.rotation.y = Math.PI / 2; this.carry.add(r); for (const sx of [-0.4, 0.4]) { const rr = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.06), MAT.metal('#e9ecef')); rr.position.set(0, 0.5, -0.1 + sx); this.carry.add(rr); } }
    if (kind === 'debris') { const r = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), MAT.plastic('#6c7a8c')); this.carry.add(r); }
    if (kind === 'blueprint') { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), MAT.plastic('#4dabf7')); r.rotation.z = Math.PI / 2; this.carry.add(r); }
  }
  setTool(kind) {
    if (this.tool) { this.tool.removeFromParent(); this.tool = null; }
    if (!kind) return;
    const g = new THREE.Group();
    if (kind === 'bar') { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), MAT.metal('#adb5bd')); b.position.y = -0.45; g.add(b); const h = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), MAT.metal('#adb5bd')); h.position.set(0, -0.9, 0.07); g.add(h); }
    if (kind === 'drill') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.3), MAT.plastic('#fab005')); b.position.set(0, -0.3, 0.1); g.add(b); const bit = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), MAT.metal('#868e96')); bit.position.set(0, -0.48, 0.1); g.add(bit); }
    if (kind === 'flag') { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), MAT.metal()); p.position.y = -0.4; g.add(p); const f = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.25), new THREE.MeshStandardMaterial({ color: '#e03131', side: THREE.DoubleSide })); f.position.set(0.18, -0.75, 0); g.add(f); }
    if (kind === 'wrench') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), MAT.metal('#adb5bd')); b.position.y = -0.3; g.add(b); }
    g.position.set(0, -0.22, 0.04);
    this.m.armR.add(g); this.tool = g;
  }
  say(text, cls = '') { this.rw.say(this.root, `${this.name}「${text}」`, cls); }

  // ---------- 手順（async） ----------
  wait(sec) { return new Promise((res) => this.waiters.push({ t: sec, res })); }
  async act(sec, pose) { this.pose = pose; this.poseT = 0; await this.wait(sec); this.pose = 'idle'; }
  /** 目的地へ歩く。西の線路を越えるときは、横断歩道（列車を待つ）か歩道橋を通る */
  async walkTo(target, run = 1) {
    const rw = this.rw;
    const pts = rw.routeFor(this, target);
    for (const p of pts) {
      if (p.isCrossing) await this.crossTrack(p);
      else await this.walkStraight(p, run);
    }
  }
  walkStraight(p, run = 1) {
    return new Promise((res) => { this.goal = { x: p.x, z: p.z, run, res, bridge: p.bridge || null }; });
  }
  async crossTrack(p) {
    const rw = this.rw;
    await this.walkStraight(p.entry);
    if (p.bridge) { await this.walkStraight(p.exit, 0.95); return; } // 歩道橋：階段だが、待たずに渡れる
    // 横断歩道：列車が近ければ待つ
    let waited = 0;
    while (rw.movingTrainNear(p.mid, 9)) {
      if (waited === 0) { this.say('電車が来る…待とう'); rw.metrics.crossWaitCount++; }
      this.pose = 'idle'; await this.wait(0.25); waited += 0.25; rw.metrics.crossWait += 0.25;
    }
    await this.walkStraight(p.exit, 1.25);
  }

  update(dt) {
    this.poseT += dt;
    for (const w of [...this.waiters]) { w.t -= dt; if (w.t <= 0) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(); } }
    const g = this.goal;
    let walking = false;
    if (g) {
      const dx = g.x - this.pos.x, dz = g.z - this.pos.z, d = Math.hypot(dx, dz);
      const st = this.speed * g.run * dt;
      if (d <= st) { this.pos.x = g.x; this.pos.z = g.z; this.goal = null; g.res(); }
      else { this.pos.x += (dx / d) * st; this.pos.z += (dz / d) * st; this.yaw = Math.atan2(dx, dz); walking = true; }
    }
    this.pos.y = this.rw.groundHeight(this.pos.x, this.pos.z);
    this.animate(dt, walking);
  }
  animate(dt, walking) {
    const m = this.m;
    this.phase += dt * (walking ? 11 : 3);
    const s = Math.sin(this.phase);
    let legA = 0, armL = 0, armR = 0, lean = 0, bob = 0, spread = 0;
    const carrying = this.carry.children.length > 0;
    if (walking) { legA = s * 0.7; armL = carrying ? -1.2 : -s * 0.6; armR = carrying ? -1.2 : s * 0.6; bob = Math.abs(s) * 0.05; }
    else switch (this.pose) {
      case 'kneel': lean = 0.6; bob = -0.12; legA = 0.9; armL = armR = -1.0; break;
      case 'pry': { const k = Math.sin(this.poseT * 5); lean = 0.5 + k * 0.15; armR = -1.0 - k * 0.6; armL = -0.8; bob = -0.05; break; }
      case 'drill': lean = 0.55; armL = armR = -1.1; bob = -0.1 + Math.sin(this.poseT * 40) * 0.015; break;
      case 'place': { const k = Math.sin(Math.min(1, this.poseT * 2) * Math.PI); lean = 0.7 * k; armL = armR = -1.2 + 0.6 * k; break; }
      case 'read': armL = armR = -1.3; lean = 0.1; break;
      case 'point': armR = -2.2; armL = 0; break;
      case 'cheer': armL = armR = -2.7; spread = 0.2; bob = Math.abs(Math.sin(this.poseT * 9)) * 0.25; break;
      case 'protest': armL = -2.6 + Math.sin(this.poseT * 12) * 0.5; armR = -2.6 - Math.sin(this.poseT * 12) * 0.5; spread = 0.3; bob = Math.abs(Math.sin(this.poseT * 10)) * 0.08; break;
      case 'salute': armR = -2.5; armL = 0.05; break;
      case 'wave': armR = -2.4 + Math.sin(this.poseT * 8) * 0.4; break;
      default: armL = armR = Math.sin(this.phase * 0.7) * 0.06;
    }
    m.legL.rotation.x = legA; m.legR.rotation.x = this.pose === 'kneel' && !walking ? -0.2 : -legA;
    m.armL.rotation.x = armL; m.armR.rotation.x = armR; m.armL.rotation.z = -spread; m.armR.rotation.z = spread;
    m.pivot.rotation.x = lean; m.pivot.position.y = bob;
    this.root.rotation.y = this.yaw;
    for (const st of m.stack) st.visible = false;
  }
  face(p) { this.yaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }
  dispose() { this.rw.scene.remove(this.root); }
}
