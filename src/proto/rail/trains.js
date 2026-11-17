import * as THREE from 'three';
import { R } from '../../core/physics.js';
import { MAT, rbox, shadow } from '../../world/props.js';
import { BED_H } from './track.js';

/**
 * 試作：おもちゃ鉄道の列車。
 * 「区間（leg）」をつなげた道のりの上を、先頭車の位置 s で走る（後ろの車両は s から一定間隔）。
 * 後退は s を減らすだけ（車両は線路の上に残ったまま）。消えたりワープしたりしない。
 */
const GAP = 1.95; // 車両の間隔
const FACES = {};
function faceTex(mood, color) {
  const key = mood + color;
  if (FACES[key]) return FACES[key];
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#fff8e8'; x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
  x.strokeStyle = color; x.lineWidth = 8; x.stroke();
  x.fillStyle = '#222';
  const eye = (ex) => { x.beginPath(); x.ellipse(ex, 56, 9, mood === 'happy' ? 11 : 9, 0, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(ex + 3, 52, 3, 0, Math.PI * 2); x.fill(); x.fillStyle = '#222'; };
  eye(44); eye(84);
  x.strokeStyle = '#222'; x.lineWidth = 5; x.lineCap = 'round';
  if (mood === 'angry') { x.beginPath(); x.moveTo(30, 36); x.lineTo(54, 44); x.moveTo(98, 36); x.lineTo(74, 44); x.stroke(); x.beginPath(); x.arc(64, 98, 14, Math.PI * 1.1, Math.PI * 1.9); x.stroke(); }
  else if (mood === 'worried') { x.beginPath(); x.moveTo(32, 42); x.lineTo(54, 36); x.moveTo(96, 42); x.lineTo(74, 36); x.stroke(); x.beginPath(); x.ellipse(64, 92, 8, 6, 0, 0, Math.PI * 2); x.stroke(); }
  else { x.beginPath(); x.arc(64, 80, 20, Math.PI * 0.15, Math.PI * 0.85); x.stroke(); x.fillStyle = '#ffa8a8'; x.beginPath(); x.arc(28, 78, 8, 0, Math.PI * 2); x.arc(100, 78, 8, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (FACES[key] = t);
}

function engineMesh(color, roof) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(rbox(1.2, 0.95, 1.75, 0.3), MAT.plastic(color)); body.position.y = 0.75; g.add(body);
  const cab = new THREE.Mesh(rbox(1.15, 0.45, 0.9, 0.18), MAT.plastic(roof)); cab.position.set(0, 1.35, -0.3); g.add(cab);
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.28, 0.6), MAT.plastic('#a5d8ff')); win.position.set(0, 1.0, -0.35); g.add(win);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.42, 28), new THREE.MeshStandardMaterial({ map: faceTex('happy', roof), roughness: 0.5 }));
  face.position.set(0, 0.78, 0.885); g.add(face);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff3bf', emissive: '#ffd43b', emissiveIntensity: 0.6 })); light.position.set(0, 1.28, 0.62); g.add(light);
  for (const sx of [-0.62, 0.62]) for (const sz of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 14), MAT.plastic('#343a40')); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.32, sz); g.add(w); }
  shadow(g);
  g.userData.face = face;
  return g;
}
function carMesh(color, roof, cargo) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(rbox(1.15, 0.85, 1.7, 0.22), MAT.plastic(color)); body.position.y = 0.72; g.add(body);
  const r = new THREE.Mesh(rbox(1.2, 0.12, 1.72, 0.06), MAT.plastic(roof)); r.position.y = 1.2; g.add(r);
  for (const sz of [-0.45, 0, 0.45]) for (const sx of [-0.585, 0.585]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.24, 0.3), MAT.plastic('#a5d8ff')); w.position.set(sx, 0.85, sz); g.add(w); }
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), MAT.plastic('#343a40')); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.3, sz); g.add(w); }
  if (cargo) { const box = new THREE.Group(); for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, 0.1), MAT.plastic(['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c'][i % 4])); d.position.set(-0.3 + (i % 3) * 0.3, 1.5, -0.2 + Math.floor(i / 3) * 0.4); box.add(d); } box.visible = false; g.add(box); g.userData.cargo = box; }
  shadow(g);
  return g;
}

export class Train {
  constructor(rw, opts) {
    this.rw = rw; this.name = opts.name; this.color = opts.color; this.roof = opts.roof;
    this.nCars = opts.cars || 3;
    this.meshes = [engineMesh(opts.color, opts.roof)];
    for (let i = 1; i < this.nCars; i++) this.meshes.push(carMesh('#fff4e0', opts.roof, i === this.nCars - 1));
    this.meshes.forEach((m) => rw.scene.add(m));
    this.bodies = this.meshes.map(() => {
      const b = rw.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -10, 0));
      rw.physics.world.createCollider(R.ColliderDesc.cuboid(0.6, 0.55, 0.86).setTranslation(0, 0.72, 0), b);
      return b;
    });
    // 道のり
    const segs = rw.track.segs;
    this.legs = [];
    let off = 0;
    for (const id of opts.startLegs) { this.legs.push({ seg: segs[id], off }); off += segs[id].len; }
    this.s = this.legs[this.legs.length - 1].off + opts.startS;
    this.v = 0; this.vmax = 3.4;
    this.state = opts.dwell ? 'dwell' : 'run'; this.timer = opts.dwell || 0;
    this.mood = 'happy'; this.laps = 0;
    this.blockT = 0; this.blockKind = null; this.blockSaid = false;
    this.wantDepot = false; this.lapsSinceDepot = 0;
    this.stairsThanked = new WeakSet();
    this.delay = 0; this.stops = 0;
    this._p = new THREE.Vector3(); this._t = new THREE.Vector3();
    this.place();
  }

  // ---------- 道のり ----------
  legAt(s) { let L = this.legs[0]; for (const l of this.legs) { if (l.off <= s + 1e-6) L = l; else break; } return L; }
  pointAt(s, out = this._p) { const l = this.legAt(s); return l.seg.pointAt(s - l.off, out); }
  tangentAt(s, out = this._t) { const l = this.legAt(s); return l.seg.tangentAt(s - l.off, out); }
  endS() { const l = this.legs[this.legs.length - 1]; return l.off + l.seg.len; }
  ensureAhead(need) {
    let guard = 0;
    while (this.endS() < need && guard++ < 6) {
      const last = this.legs[this.legs.length - 1];
      let nextId = this.rw.track.next[last.seg.id]();
      // 車庫線は、点検に入りたい列車だけ（ポイントDは鉄道が自分で切り替える）
      if (last.seg.id === 'B1') { nextId = this.wantDepot ? 'DS' : 'B2'; this.rw.track.setSwitch('D', nextId, 'rail', this.rw.time); }
      this.legs.push({ seg: this.rw.track.segs[nextId], off: this.endS() });
      this.rw.onLegCommitted(this, nextId);
    }
  }
  trim() { while (this.legs.length > 1 && this.legs[0].off + this.legs[0].seg.len < this.s - (this.nCars * GAP + 8)) this.legs.shift(); }
  /** 後退して戻ってきたあと：いまいる区間より先の予定を消す（分岐の切り替えをやり直すため） */
  /** 分岐が切り替わったので、まだ通っていない分岐の先の予定を作り直す */
  replanAt(segIdAfterJunction) {
    const i = this.legs.findIndex((l) => l.seg.id === segIdAfterJunction && l.off > this.s + 0.5);
    if (i > 0) this.legs = this.legs.slice(0, i);
  }
  truncateAhead() { const cur = this.legAt(this.s); this.legs = this.legs.slice(0, this.legs.indexOf(cur) + 1); }
  tailS() { return this.s - (this.nCars - 1) * GAP; }
  carPositions() { const out = []; for (let i = 0; i < this.nCars; i++) out.push(this.pointAt(this.s - i * GAP, new THREE.Vector3())); return out; }

  // ---------- 見た目 ----------
  setMood(m) {
    if (this.mood === m) return;
    this.mood = m;
    this.meshes[0].userData.face.material.map = faceTex(m, this.roof);
    this.meshes[0].userData.face.material.needsUpdate = true;
  }
  place(dt = 0) {
    for (let i = 0; i < this.nCars; i++) {
      const s = this.s - i * GAP;
      const p = this.pointAt(s, new THREE.Vector3());
      const a = this.pointAt(s - 0.7, new THREE.Vector3()), b = this.pointAt(s + 0.7, new THREE.Vector3());
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const m = this.meshes[i];
      const hop = i === 0 && this.hop > 0 ? Math.sin(this.hop * Math.PI) * 0.35 : 0;
      m.position.set(p.x, BED_H + hop, p.z); m.rotation.y = yaw;
      this.bodies[i].setNextKinematicTranslation({ x: p.x, y: BED_H, z: p.z });
      this.bodies[i].setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    }
    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt * 1.6);
  }

  // ---------- 前方の確認（線路・ドミノ・人・ほかの列車・駅） ----------
  scan(dir) {
    const rw = this.rw;
    const from = dir > 0 ? this.s + 1.0 : this.tailS() - 1.0;
    if (dir > 0) this.ensureAhead(from + 10);
    const others = rw.trains.filter((t) => t !== this).flatMap((t) => t.carPositions());
    for (let d = 0; d <= 8.5; d += 0.35) {
      const s = from + dir * d;
      if (dir < 0 && s < this.legs[0].off) return { kind: 'end', dist: d };
      const leg = this.legAt(s);
      const p = leg.seg.pointAt(s - leg.off, new THREE.Vector3());
      if (!rw.track.usable(leg.seg, s - leg.off)) return { kind: 'gap', dist: d, p };
      if (rw.debrisNear(p, 0.9)) return { kind: 'debris', dist: d, p };
      if (rw.hammerOnTrack(p, 2.2)) return { kind: 'hammer', dist: d, p };
      if (others.some((q) => q.distanceToSquared(p) < 1.8 * 1.8)) return { kind: 'train', dist: d, p };
      if (rw.dominoOnTrack(p, 0.95)) return { kind: 'domino', dist: d, p };
      if (rw.personOnTrack(p, 0.9)) return { kind: 'person', dist: d, p };
    }
    return null;
  }
  /** 前方の駅・車庫の停車位置（まだ停まっていないもの） */
  nextStop() {
    const rw = this.rw;
    for (const st of rw.stations) {
      for (const l of this.legs) {
        if (l.seg !== rw.track.segs[st.seg] || l.served && l.served.has(st.name)) continue;
        const s = l.off + st.s;
        if (s >= this.s - 0.2 && s - this.s < 10) return { st, leg: l, dist: s - this.s };
      }
    }
    return null;
  }

  update(dt) {
    const rw = this.rw;
    this.trim();
    let target = this.vmax, dir = 1;
    if (this.state === 'dwell' || this.state === 'hold' || this.state === 'depot') {
      this.v = 0; this.timer -= dt;
      if (this.state === 'hold' && !rw.signalRed) { this.state = 'dwell'; this.timer = Math.min(this.timer, 1.0); }
      if (this.state === 'hold') { rw.onHoldTick(this, dt); }
      else if (this.timer <= 0) this.depart();
      this.place(dt); return;
    }
    if (this.state === 'reverse') {
      dir = -1;
      // 後退中に線路が直った：前進に戻る
      const ahead = this.scan(1);
      if (!ahead || ahead.kind !== 'gap') { this.state = 'run'; this.v = 0; this.rw.say(this.meshes[0], `${this.name}「線路が直った！ 前進します」`, 'coin'); this.place(dt); return; }
      // 分岐Sの手前（本線Bの上）まで下がったら、迂回の準備
      const legA = this.legs.find((l) => l.seg.id === 'A' || l.seg.id === 'BP');
      if (!legA || this.s < legA.off - 0.6) { this.v = 0; this.truncateAhead(); rw.onBackedOff(this); this.state = 'run'; this.place(dt); return; }
    }
    // 前方の障害物
    const ob = this.scan(dir);
    let stopDist = Infinity;
    if (ob && ob.kind !== 'end') stopDist = Math.max(0, ob.dist - 0.4);
    if (ob && ob.kind === 'end') stopDist = ob.dist;
    if (dir > 0) {
      const ns = this.nextStop();
      if (ns && ns.dist < stopDist) { stopDist = ns.dist; this.pendingStop = ns; } else this.pendingStop = null;
    }
    // 止まれる速さ（なめらかに減速）
    const brake = 5;
    target = Math.min(this.vmax * (dir < 0 ? 0.55 : 1), Math.sqrt(Math.max(0, 2 * brake * stopDist)));
    const sp = Math.abs(this.v);
    let nv = sp < target ? Math.min(target, sp + 2.4 * dt) : Math.max(target, sp - brake * 1.4 * dt);
    if (stopDist < 0.05) nv = 0;
    this.v = nv * dir;
    this.s += this.v * dt;
    // 停車
    if (dir > 0 && this.pendingStop && this.pendingStop.dist < 0.12 && nv < 0.3) { this.arrive(this.pendingStop); this.place(dt); return; }
    // 障害物で止まっている
    if (ob && nv < 0.05 && stopDist < 0.3 && ob.kind !== 'end') this.blocked(ob, dt);
    else { this.blockT = 0; this.blockSaid = false; if (this.state === 'run' && this.mood !== 'happy' && rw.relation > 30) this.setMood('happy'); }
    if (this.state === 'reverse' && nv < 0.05 && ob) {
      this.blockT += dt; this.delay += dt;
      if (ob.kind === 'train' && this.blockT > 3 && !this.waitSaid) { this.waitSaid = true; rw.say(this.meshes[0], `${this.name}「後ろがつかえて下がれない…ここで修理を待ちます」`, 'warn'); }
    }
    rw.onTrainMoved(this, dt);
    this.place(dt);
  }
  blocked(ob, dt) {
    const rw = this.rw;
    this.blockT += dt; this.delay += dt;
    if (this.blockKind !== ob.kind) { this.blockKind = ob.kind; this.blockSaid = false; this.stops++; }
    if (ob.kind === 'train') return; // 先行列車の後ろ：静かに待つ
    this.setMood(ob.kind === 'gap' || this.blockT > 12 ? 'angry' : 'worried');
    if (!this.blockSaid && this.blockT > (ob.kind === 'gap' ? 0.8 : 2)) {
      this.blockSaid = true;
      rw.onBlocked(this, ob);
    }
    if (ob.kind === 'gap' && this.state === 'run' && this.blockT > 2.5) {
      // 線路が無い：分岐まで後退して、迂回する
      this.state = 'reverse'; this.blockT = 0; this.waitSaid = false;
      rw.say(this.meshes[0], `${this.name}「後退します！ 迂回線へまわります」`, 'warn');
      rw.news(`${this.name}：線路が外されていたため、分岐Sまで後退して迂回`);
    }
    if ((ob.kind === 'domino' || ob.kind === 'debris') && this.blockT > 16 && !this.clearAsked) { this.clearAsked = true; rw.requestClear(ob.p, this); }
  }
  arrive(ns) {
    (ns.leg.served ||= new Set()).add(ns.st.name);
    this.v = 0;
    const rw = this.rw;
    if (ns.st.depot) {
      this.state = 'depot'; this.timer = 8; this.wantDepot = false; this.lapsSinceDepot = 0;
      rw.say(this.meshes[0], `${this.name}「車庫で点検、ひと休み」`, '');
      rw.news(`${this.name}：車庫に入って点検中`);
      return;
    }
    this.state = 'dwell'; this.timer = ns.st.dwell;
    rw.onStation(this, ns.st);
    if (ns.st.name === '駅A' && rw.signalRed) { this.state = 'hold'; rw.say(this.meshes[0], `${this.name}「信号が赤…ここで待ちます」`, 'warn'); }
  }
  depart() {
    this.state = 'run'; this.clearAsked = false; this.waitSaid = false;
    this.rw.audio.toot();
    this.rw.say(this.meshes[0], `${this.name}「出発進行！」`, 'coin');
    this.lapsSinceDepot++;
    if (this.lapsSinceDepot >= 5) this.wantDepot = true;
  }
  dispose() { this.meshes.forEach((m) => this.rw.scene.remove(m)); this.bodies.forEach((b) => this.rw.physics.world.removeRigidBody(b)); }
}
