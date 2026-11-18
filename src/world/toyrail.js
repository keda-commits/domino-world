import * as THREE from 'three';
import { R } from '../core/physics.js';
import { MAT, rbox, shadow } from './props.js';

/**
 * Ver.0.6 ステージ2：おもちゃの鉄道（青いプラスチックの組み立て式レール）。
 * - 環状線（角の丸い長方形）。レールは長さ約2の「1本ずつ」に分かれ、外す・戻すができる。
 * - 北側の一部は黄色い橋脚の高架。駅（ホーム）と車庫（小屋）がある。
 * - 列車（白と青の新幹線・黄色いローカル線）は自分で走り、駅に停まる。
 *   線路が切れていると折り返し運転、線路の上にドミノや人がいると止まって汽笛で抗議する。
 * ゲームの主役はドミノ。鉄道はドミノの世界に入り込んでくる別のおもちゃたち。
 */
export const BED_H = 0.16; // レールの厚み（ドミノはこの上には立てない）
export const BED_HW = 0.6; // レールの半幅（Ver.0.6：幅6cm。実物のおもちゃのレールに近い太さ）
const BLUE = '#1c7ed6', BLUE_D = '#1864ab', YELLOW = '#fcc419';
const PIECE = 2.0;

const blueMat = () => new THREE.MeshPhysicalMaterial({ color: BLUE, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 });
const blueDMat = () => new THREE.MeshPhysicalMaterial({ color: BLUE_D, roughness: 0.35, clearcoat: 0.5 });
const yellowMat = () => new THREE.MeshPhysicalMaterial({ color: YELLOW, roughness: 0.35, clearcoat: 0.6 });

/** 折れ線（角は半径2で丸める）を0.25ごとの点列にする */
function polyPoints(poly, step = 0.25, r = 2) {
  const out = [];
  const P = poly;
  const seg = (a, b) => { const n = Math.max(1, Math.ceil(a.distanceTo(b) / step)); for (let i = 0; i < n; i++) out.push(a.clone().lerp(b, i / n)); };
  let prev = P[0].clone();
  for (let k = 1; k < P.length; k++) {
    const b = P[k];
    if (k < P.length - 1) {
      const c = P[k + 1];
      const d1 = b.clone().sub(prev).normalize(), d2 = c.clone().sub(b).normalize();
      const rr = Math.min(r, b.distanceTo(prev) / 2, c.distanceTo(b) / 2);
      const p1 = b.clone().addScaledVector(d1, -rr), p2 = b.clone().addScaledVector(d2, rr);
      seg(prev, p1);
      // 2次ベジェで角を丸める
      const n = Math.ceil((rr * 1.6) / step);
      for (let i = 0; i < n; i++) { const t = i / n; out.push(p1.clone().multiplyScalar((1 - t) ** 2).addScaledVector(b, 2 * (1 - t) * t).addScaledVector(p2, t * t)); }
      prev = p2;
    } else { seg(prev, b); out.push(b.clone()); }
  }
  return out;
}

/** 角の丸い長方形の点列（時計回り：西の辺を北へ → 北の辺を東へ → 東の辺を南へ → 南の辺を西へ） */
function loopPoints(d, step = 0.25) {
  const { x0, x1, z0, z1, r } = d;
  const pts = [];
  const line = (ax, az, bx, bz) => { const n = Math.ceil(Math.hypot(bx - ax, bz - az) / step); for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n)); };
  const arc = (cx, cz, a0, a1) => { const n = Math.ceil((Math.abs(a1 - a0) * r) / step); for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push(new THREE.Vector3(cx + r * Math.cos(a), 0, cz + r * Math.sin(a))); } };
  line(x0, z1 - r, x0, z0 + r); arc(x0 + r, z0 + r, Math.PI, 1.5 * Math.PI);
  line(x0 + r, z0, x1 - r, z0); arc(x1 - r, z0 + r, -0.5 * Math.PI, 0);
  line(x1, z0 + r, x1, z1 - r); arc(x1 - r, z1 - r, 0, 0.5 * Math.PI);
  line(x1 - r, z1, x0 + r, z1); arc(x0 + r, z1 - r, 0.5 * Math.PI, Math.PI);
  return pts;
}

export class ToyTrack {
  constructor(game, def, poly = null) {
    this.game = game; this.def = def;
    // 支線（poly）は折れ線を0.25ごとの点にする（閉じない）
    this.pts = poly ? polyPoints(poly) : loopPoints(def);
    this.cum = [0];
    const N = poly ? this.pts.length - 1 : this.pts.length;
    for (let i = 1; i <= N; i++) this.cum.push(this.cum[i - 1] + this.pts[i % this.pts.length].distanceTo(this.pts[i - 1]));
    this.len = this.cum[this.cum.length - 1];
    this.group = new THREE.Group(); game.scene.add(this.group);
    this.mats = { blue: blueMat(), blueD: blueDMat(), yellow: yellowMat() };
    this.pieces = [];
    const n = Math.round(this.len / PIECE), L = this.len / n;
    this.pieceLen = L;
    for (let i = 0; i < n; i++) this.addPiece(i, i * L, (i + 1) * L, !!poly);
  }
  wrap(s) { return ((s % this.len) + this.len) % this.len; }
  index(s) {
    s = this.wrap(s);
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  pointAt(s, out = new THREE.Vector3()) {
    s = this.wrap(s);
    const i = this.index(s), a = this.pts[i], b = this.pts[(i + 1) % this.pts.length];
    const L = this.cum[i + 1] - this.cum[i] || 1;
    out.copy(a).lerp(b, (s - this.cum[i]) / L);
    out.y = this.heightAt(out.x, out.z);
    return out;
  }
  /** 高架の高さ（北側の辺の一部。両端は坂） */
  heightAt(x, z) {
    const e = this.def.elevated;
    if (!e || Math.abs(z - this.def.z0) > 1.5) return 0;
    const ramp = 6;
    if (x < e.x0 - ramp || x > e.x1 + ramp) return 0;
    const k = x < e.x0 ? (x - (e.x0 - ramp)) / ramp : x > e.x1 ? ((e.x1 + ramp) - x) / ramp : 1;
    const t = Math.max(0, Math.min(1, k));
    return e.h * t * t * (3 - 2 * t);
  }
  /** 線路の近くのマス（1単位）→ 近くにある線路の点の番号（何度も呼ばれる判定を速くする） */
  buildIndex() {
    this.cellIdx = new Map();
    const R2 = 3;
    this.pts.forEach((p, i) => {
      for (let dx = -R2; dx <= R2; dx++) for (let dz = -R2; dz <= R2; dz++) {
        const k = (Math.floor(p.x) + dx) * 4096 + (Math.floor(p.z) + dz);
        let a = this.cellIdx.get(k); if (!a) this.cellIdx.set(k, (a = [])); if (a[a.length - 1] !== i) a.push(i);
      }
    });
  }
  /** 点 p に一番近い線路上の位置 {s, d}（遠い所は d = Infinity） */
  closest(p, far = false) {
    if (!this.cellIdx) this.buildIndex();
    const near = far ? null : this.cellIdx.get(Math.floor(p.x) * 4096 + Math.floor(p.z));
    if (!far && !near) return { s: 0, d: Infinity };
    let bs = 0, bd = Infinity;
    for (const i of near || this.pts.keys()) {
      const a = this.pts[i], b = this.pts[(i + 1) % this.pts.length];
      const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2));
      const x = a.x + abx * t, z = a.z + abz * t, d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; bs = this.cum[i] + Math.sqrt(L2) * t; }
    }
    return { s: bs, d: Math.sqrt(bd) };
  }
  /** 床の高さの線路の上か（高架の下はちがう） */
  onTrack(x, z, m = 0) {
    if (Math.abs(x - (this.def.x0 + this.def.x1) / 2) > (this.def.x1 - this.def.x0) / 2 + BED_HW + m + 0.5) return false;
    if (Math.abs(z - (this.def.z0 + this.def.z1) / 2) > (this.def.z1 - this.def.z0) / 2 + BED_HW + m + 0.5) return false;
    const c = this.closest({ x, z });
    return c.d < BED_HW + m && this.heightAt(x, z) < 0.5;
  }
  pieceAt(s) { return this.pieces[Math.floor(this.wrap(s) / this.pieceLen) % this.pieces.length]; }

  // ---------- 見た目：青いプラスチックのレール（1本ずつ） ----------
  addPiece(i, s0, s1, planOnly = false) {
    const a = this.pointAt(s0), b = this.pointAt(s1), mid = this.pointAt((s0 + s1) / 2);
    if (planOnly) { const yaw = Math.atan2(b.x - a.x, b.z - a.z); this.pieces.push({ i, s0, s1, mid, yaw, pitch: 0, chord: a.distanceTo(b), state: 'plan', mesh: null, collider: null, elevated: false }); return; }
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
    const chord = a.distanceTo(b);
    const p = { i, s0, s1, mid, yaw, pitch, chord, state: 'ok', mesh: null, collider: null, elevated: mid.y > 0.05 };
    p.mesh = this.pieceMesh(chord);
    this.placeMesh(p);
    this.group.add(p.mesh);
    if (!p.elevated) p.collider = this.makeCollider(p);
    else this.addPier(p);
    this.pieces.push(p);
  }
  placeMesh(p) { p.mesh.position.set(p.mid.x, p.mid.y, p.mid.z); p.mesh.rotation.set(0, 0, 0); p.mesh.rotation.y = p.yaw; p.mesh.rotateX(-p.pitch); }
  pieceMesh(chord) {
    const g = new THREE.Group(), M = this.mats;
    const L = chord - 0.05; // つなぎ目のすき間（組み立て式だと分かるように）
    const base = new THREE.Mesh(rbox(1.9, 0.1, L, 0.04), M.blue); base.position.y = 0.05; g.add(base);
    // 外側の太いふち（車輪の溝の外側）と、まん中の山
    for (const sx of [-0.8, 0.8]) { const r = new THREE.Mesh(rbox(0.3, 0.12, L, 0.05), M.blue); r.position.set(sx, 0.1, 0); g.add(r); }
    const c = new THREE.Mesh(rbox(0.5, 0.08, L, 0.04), M.blue); c.position.set(0, 0.08, 0); g.add(c);
    // 溝の底（少し濃い青）
    for (const sx of [-0.43, 0.43]) { const gr = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, L), M.blueD); gr.position.set(sx, 0.105, 0); g.add(gr); }
    // つなぎ目：片側は丸いツメ、反対側はくぼみ（濃い青）
    const tab = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), M.blue); tab.position.set(0, 0.05, L / 2 + 0.1); g.add(tab);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.14), M.blue); neck.position.set(0, 0.05, L / 2 + 0.02); g.add(neck);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14), M.blueD); hole.position.set(0, 0.105, -L / 2 + 0.16); g.add(hole);
    g.scale.x = BED_HW / 0.95; // 形は同じまま、幅だけ実物の比率に
    return shadow(g);
  }
  makeCollider(p) {
    const w = this.game.physics.world;
    const d = R.ColliderDesc.cuboid(BED_HW, BED_H / 2, p.chord / 2).setTranslation(p.mid.x, BED_H / 2, p.mid.z).setRotation(this.game.physics.quatYaw(p.yaw)).setFriction(0.6);
    return w.createCollider(d);
  }
  /** 黄色い橋脚（積み重ねたブロック） */
  addPier(p) {
    const g = new THREE.Group();
    const h = p.mid.y;
    const blocks = Math.max(1, Math.round(h / 0.55));
    for (let k = 0; k < blocks; k++) {
      const b = new THREE.Mesh(rbox(1.3, h / blocks - 0.04, 0.7, 0.08), this.mats.yellow);
      b.position.y = (k + 0.5) * (h / blocks); g.add(b);
    }
    const cap = new THREE.Mesh(rbox(1.9, 0.12, 0.9, 0.05), this.mats.yellow); cap.position.y = h - 0.02; g.add(cap);
    g.position.set(p.mid.x, 0, p.mid.z); g.rotation.y = p.yaw;
    shadow(g); this.group.add(g);
  }

  // ---------- 外す・戻す ----------
  detach(p) {
    if (p.state !== 'ok') return null;
    p.state = 'removed';
    if (p.collider) { this.game.physics.remove(p.collider); p.collider = null; }
    return p.mesh;
  }
  restore(p) {
    if (p.state === 'ok') return;
    p.state = 'ok';
    p.mesh = this.pieceMesh(p.chord); this.placeMesh(p); this.group.add(p.mesh);
    if (!p.elevated) p.collider = this.makeCollider(p);
  }
  dispose() {
    for (const p of this.pieces) if (p.collider) this.game.physics.remove(p.collider);
    this.game.scene.remove(this.group);
  }
}

// ---------- 列車 ----------
export function trainCar(kind, idx, n) {
  const g = new THREE.Group();
  const white = MAT.plastic('#f8f9fa'), blue = MAT.plastic('#1971c2'), glass = MAT.plastic('#343a40');
  const yel = MAT.plastic('#ffd43b'), orange = MAT.plastic('#f76707');
  const head = idx === 0, tail = idx === n - 1;
  if (kind === 'shinkansen') {
    const body = new THREE.Mesh(rbox(0.95, 0.75, 1.55, 0.3), white); body.position.set(0, 0.55, head ? -0.15 : 0); g.add(body);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.12, head ? 1.3 : 1.56), blue); band.position.set(0, 0.42, head ? -0.15 : 0); g.add(band);
    for (const sx of [-0.48, 0.48]) for (let k = 0; k < (head ? 2 : 4); k++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.22), glass); w.position.set(sx, 0.72, (head ? -0.55 : -0.55) + k * 0.36); g.add(w); }
    if (head || tail) {
      // とがった鼻（ころんとしたおもちゃの形）
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.47, 18, 12), white); nose.scale.set(1, 0.78, 1.7); nose.position.set(0, 0.5, head ? 0.75 : -0.75); g.add(nose);
      const win = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass); win.scale.set(1, 0.6, 1.4); win.position.set(0, 0.72, head ? 0.55 : -0.55); g.add(win);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff3bf', emissive: '#ffe066', emissiveIntensity: 0.8 })); lamp.position.set(0, 0.42, head ? 1.48 : -1.48); g.add(lamp);
    }
  } else {
    // 黄色いローカル線（四角くて丸い）
    const body = new THREE.Mesh(rbox(0.95, 0.85, 1.6, 0.25), yel); body.position.y = 0.58; g.add(body);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.1, 1.61), orange); band.position.y = 0.36; g.add(band);
    for (const sx of [-0.48, 0.48]) for (let k = 0; k < 3; k++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.3), glass); w.position.set(sx, 0.75, -0.45 + k * 0.45); g.add(w); }
    if (head || tail) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.02), glass); f.position.set(0, 0.78, head ? 0.81 : -0.81); g.add(f); }
    const roof = new THREE.Mesh(rbox(0.85, 0.08, 1.4, 0.04), MAT.plastic('#adb5bd')); roof.position.y = 1.03; g.add(roof);
  }
  // Ver.0.6：車体は幅3.6cm・長さ12.5cm（実物のおもちゃの比率）に。車輪と連結器は伸ばさずに付ける
  g.scale.set(0.75, 1, 1.6);
  const outer = new THREE.Group(); outer.add(g);
  for (const sx of [-0.31, 0.31]) for (const sz of [-0.85, 0.85]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), MAT.plastic('#212529')); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.17, sz); outer.add(w); }
  if (!tail) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.3), MAT.plastic('#495057')); c.position.set(0, 0.25, -1.42); outer.add(c); }
  return shadow(outer);
}

export class ToyTrain {
  constructor(rail, opts) {
    this.rail = rail; this.game = rail.game; this.name = opts.name; this.kind = opts.kind;
    this.n = opts.cars; this.gap = 2.85; // 車両の長さ約12.5cm（実物のおもちゃの比率）
    this.cars = []; this.bodies = [];
    for (let i = 0; i < this.n; i++) {
      const m = trainCar(opts.kind, i, this.n); this.game.scene.add(m); this.cars.push(m);
      const b = this.game.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -10, 0));
      this.game.physics.world.createCollider(R.ColliderDesc.cuboid(0.5, 0.45, 0.85).setTranslation(0, 0.55, 0), b);
      this.bodies.push(b);
    }
    this.s = opts.s; this.dir = 1; this.v = 0; this.vmax = opts.speed;
    this.state = 'run'; this.timer = 0; this.blockT = 0; this.blockKind = null; this.said = false;
    this._p = new THREE.Vector3();
    this.place();
  }
  carS(i) { return this.s - i * this.gap; }
  positions() { const out = []; for (let i = 0; i < this.n; i++) out.push(this.rail.track.pointAt(this.carS(i), new THREE.Vector3())); return out; }
  get pos() { return this.cars[0].position; }
  /** 進む向きの先頭の位置 */
  leadS() { return this.dir > 0 ? this.s + 1.0 : this.carS(this.n - 1) - 1.0; }
  scan() {
    const tr = this.rail.track, g = this.game;
    const others = this.rail.trains.filter((t) => t !== this).flatMap((t) => t.positions());
    for (let d = 0; d <= 8; d += 0.35) {
      const s = this.leadS() + this.dir * d;
      const pc = tr.pieceAt(s);
      if (pc.state !== 'ok') return { kind: 'gap', dist: d };
      const p = tr.pointAt(s, this._p);
      if (others.some((q) => q.distanceToSquared(p) < 1.8 * 1.8)) return { kind: 'train', dist: d };
      if (p.y > 0.5) continue; // 高架の上：床の物は関係ない
      for (const dm of g.dominoes.near(p.x, p.z)) { const t = dm.body.translation(); if (t.y < 1.6 && (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < 0.9 * 0.9) return { kind: 'domino', dist: d, p: p.clone() }; }
      for (const w of g.workers.list) if (w.pos.y < 0.5 && (w.pos.x - p.x) ** 2 + (w.pos.z - p.z) ** 2 < 0.85 * 0.85) return { kind: 'person', dist: d, who: w };
      if (g.crate && !g.crate.carried && Math.abs(g.crate.pos.x - p.x) < 1.6 && Math.abs(g.crate.pos.z - p.z) < 1.6) return { kind: 'crate', dist: d };
    }
    return null;
  }
  update(dt) {
    const rail = this.rail;
    if (this.state === 'dwell') {
      this.v = 0; this.timer -= dt;
      if (this.timer <= 0) { this.state = 'run'; rail.say(this, '出発進行！', 'coin'); this.game.audio.toot(); this.served = rail.station.s; }
      this.place(); return;
    }
    const ob = this.scan();
    let stop = ob ? Math.max(0, ob.dist - 0.35) : Infinity;
    // 駅（どちらの向きでも停まる）
    const st = rail.station;
    if (st && this.served == null) {
      const ds = this.dir > 0 ? rail.track.wrap(st.s - this.s) : rail.track.wrap(this.s - st.s);
      if (ds < 9 && ds < stop) { stop = ds; this.toStation = ds; } else this.toStation = null;
    } else this.toStation = null;
    if (this.served != null && Math.abs(rail.track.wrap(this.s - this.served + rail.track.len / 2) - rail.track.len / 2) > 12) this.served = null;
    const brake = 6;
    const target = Math.min(this.vmax, Math.sqrt(Math.max(0, 2 * brake * stop)));
    const sp = Math.abs(this.v);
    let nv = sp < target ? Math.min(target, sp + 3 * dt) : Math.max(target, sp - brake * 1.5 * dt);
    if (stop < 0.04) nv = 0;
    this.v = nv * this.dir;
    this.s = rail.track.wrap(this.s + this.v * dt);
    if (this.toStation != null && this.toStation < 0.15 && nv < 0.3) { this.state = 'dwell'; this.timer = 3.5; this.served = st.s; rail.onStation(this); this.place(); return; }
    if (ob && nv < 0.05 && stop < 0.3) this.blocked(ob, dt);
    else { this.blockT = 0; this.blockKind = null; this.said = false; }
    this.place();
  }
  blocked(ob, dt) {
    const rail = this.rail;
    if (this.blockKind !== ob.kind) { this.blockKind = ob.kind; this.blockT = 0; this.said = false; }
    this.blockT += dt;
    if (ob.kind === 'gap') {
      if (!this.said && this.blockT > 0.6) { this.said = true; rail.say(this, '線路が切れてる！ 折り返し運転します', 'warn'); this.game.audio.toot(); }
      if (this.blockT > 2.0) this.reverse();
      return;
    }
    if (ob.kind === 'train') { if (this.blockT > 3.5) this.reverse(); return; }
    if (!this.said && this.blockT > 1.2) {
      this.said = true; this.game.audio.toot();
      rail.say(this, ob.kind === 'domino' ? '線路にドミノが！ どかしてください〜' : ob.kind === 'person' ? 'あぶないですよ〜！' : '線路の上に箱が…！', 'warn');
      rail.stats.protests++;
    }
    if (this.blockT > 6) this.reverse(); // いつまでも待たずに、来た道を戻る
  }
  reverse() { this.dir = -this.dir; this.blockT = 0; this.said = false; this.blockKind = null; this.served = null; }
  place() {
    const tr = this.rail.track;
    for (let i = 0; i < this.n; i++) {
      const s = this.carS(i);
      const p = tr.pointAt(s, this._p);
      const a = tr.pointAt(s - 0.7, new THREE.Vector3()), b = tr.pointAt(s + 0.7, new THREE.Vector3());
      const yaw = Math.atan2(b.x - a.x, b.z - a.z), pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
      const m = this.cars[i];
      m.position.set(p.x, p.y + BED_H, p.z); m.rotation.set(0, 0, 0); m.rotation.y = yaw; m.rotateX(-pitch);
      const y = p.y > 0.5 ? -10 : BED_H; // 高架の上の列車は床のドミノに当たらない
      this.bodies[i].setNextKinematicTranslation({ x: p.x, y, z: p.z });
      this.bodies[i].setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    }
  }
  describe() {
    const st = this.state === 'dwell' ? '駅に停車中' : Math.abs(this.v) < 0.05 ? ({ gap: '線路が切れて止まっている', domino: '線路の上のドミノで止まっている', person: '人が線路にいて止まっている', train: '前の列車を待っている', crate: '資材箱で止まっている' }[this.blockKind] || '停車中') : this.dir > 0 ? '走行中' : '折り返し運転中';
    return { title: `🚄 ${this.name}`, rows: [['いま', st], ['鉄道', 'ぽっぽ線（おもちゃの鉄道）']], note: '青い線路を走るおもちゃの鉄道。線路の上にドミノは並べられない。設計主任が立体交差や線路の撤去で解決する' };
  }
  dispose() { this.cars.forEach((m) => this.game.scene.remove(m)); this.bodies.forEach((b) => this.game.physics.world.removeRigidBody(b)); }
}

/** 鉄道の世界：線路・駅・車庫・列車・音・修理 */
export class ToyRailway {
  constructor(game, def) {
    this.game = game; this.def = def;
    this.track = new ToyTrack(game, def);
    this.stats = { protests: 0, removed: 0, repaired: 0 };
    this.buildStation();
    this.buildDepot();
    this.trains = [
      new ToyTrain(this, { name: 'ドミノ新幹線ひかり', kind: 'shinkansen', cars: 3, s: 20, speed: 5.2 }),
      new ToyTrain(this, { name: 'ぽっぽローカル', kind: 'local', cars: 2, s: this.track.len * 0.55, speed: 3.6 }),
    ];
    this.scrapPile = [];
  }
  buildStation() {
    const d = this.def, g = new THREE.Group(), M = this.track.mats;
    const z = d.z1 + 2.0, x = d.station.x;
    g.add(new THREE.Mesh(rbox(10, 0.5, 2.2, 0.08), MAT.plastic('#f8f9fa')).translateY(0.25));
    g.add(new THREE.Mesh(rbox(10, 0.08, 0.4, 0.03), M.yellow).translateY(0.52).translateZ(-0.9));
    const roof = new THREE.Mesh(rbox(9, 0.15, 2.6, 0.06), M.blue); roof.position.set(0, 2.6, 0.2); g.add(roof);
    for (const xx of [-3.5, 0, 3.5]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.1, 10), M.yellow).translateX(xx).translateY(1.55).translateZ(0.7));
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x2 = c.getContext('2d');
    x2.fillStyle = '#fff'; x2.fillRect(0, 0, 512, 128); x2.fillStyle = BLUE; x2.fillRect(0, 0, 512, 22); x2.fillStyle = '#212529'; x2.font = 'bold 60px sans-serif'; x2.textAlign = 'center'; x2.fillText('ぽっぽ線 リビング駅', 256, 92);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sm = new THREE.MeshStandardMaterial({ map: t }), sgeo = new THREE.PlaneGeometry(4, 1);
    for (const [ry, dz] of [[0, 0.205], [Math.PI, 0.195]]) { const sign = new THREE.Mesh(sgeo, sm); sign.position.set(0, 3.2, dz); sign.rotation.y = ry; g.add(sign); } // 表裏とも正しく読める
    g.position.set(x, 0, z); shadow(g); this.game.scene.add(g); this.stationMesh = g;
    this.station = { s: this.track.closest({ x, z: d.z1 }).s, x, z };
    this.game.stage.obstacles.push({ x, z, hw: 5, hd: 1.1, yaw: 0, roomba: true, build: true });
  }
  buildDepot() {
    const d = this.def, g = new THREE.Group();
    const x = d.x0, z = d.depot.z;
    for (const sx of [-1.4, 1.4]) g.add(new THREE.Mesh(rbox(0.2, 2.2, 5, 0.04), MAT.plastic('#e8590c')).translateX(sx).translateY(1.1));
    g.add(new THREE.Mesh(rbox(3.2, 0.2, 5.4, 0.05), MAT.plastic('#c92a2a')).translateY(2.3));
    g.position.set(x, 0, z); shadow(g); this.game.scene.add(g); this.depotMesh = g;
    this.depot = new THREE.Vector3(x - 3.5, 0, z);
  }
  say(train, text, cls = '') { this.game.fx.floatObj(train.cars[0], `${train.name}「${text}」`, cls, 2.4, 0.4); }
  onStation(train) { if (Math.random() < 0.5) this.say(train, 'リビング駅〜、リビング駅〜', ''); }
  trainNear(p, r, movingOnly = false) { return [...this.trains, ...(this.extraTrains || [])].some((t) => (!movingOnly || Math.abs(t.v) > 0.1) && t.positions().some((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < r * r && q.y < 0.5)); }
  /** 線路を外した：列車の人がちょっと抗議する */
  onRemoved(pieces) {
    this.stats.removed += pieces.length;
    const p = pieces[0].mid;
    let best = null, bd = Infinity;
    for (const t of this.trains) { const d = t.pos.distanceToSquared(p); if (d < bd) { bd = d; best = t; } }
    if (best) this.say(best, 'えっ、線路が外された！？ ぼくたちの線路が〜', 'warn');
  }
  update(dt) {
    for (const t of this.trains) t.update(dt);
    // 走行音：カメラに近い列車ほど聞こえる（電動おもちゃのモーター音）
    const cam = this.game.cameraTarget;
    if (cam && this.game.audio.toyTrainHum) {
      let best = 0;
      for (const t of this.trains) { if (Math.abs(t.v) < 0.1) continue; const d = t.pos.distanceTo(cam); best = Math.max(best, Math.max(0, 1 - d / 30) * Math.min(1, Math.abs(t.v) / 3)); }
      this.game.audio.toyTrainHum(best);
    }
  }
  dispose() {
    this.trains.forEach((t) => t.dispose());
    this.track.dispose();
    this.game.scene.remove(this.stationMesh, this.depotMesh);
    for (const m of this.scrapPile) this.game.scene.remove(m);
    if (this.game.audio.toyTrainHum) this.game.audio.toyTrainHum(0);
  }
}

/**
 * 支線（Ver.0.6）：ぽっぽ線が自分たちで延ばす線路。折れ線にそって1本ずつ「敷く」。
 * 本線と同じ部品の形（見た目・当たり判定）で、まだ敷いていない部品は見えない（state: 'plan'）。
 */
export class ToyBranch extends ToyTrack {
  constructor(game, pts, opts = {}) {
    const def = { open: true };
    super(game, def, pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    this.name = opts.name || '支線';
  }
  wrap(s) { return Math.max(0, Math.min(this.len - 1e-4, s)); }
  heightAt() { return 0; }
  closest(p, far = false) {
    if (!this.cellIdx) this.buildIndex();
    const near = far ? null : this.cellIdx.get(Math.floor(p.x) * 4096 + Math.floor(p.z));
    if (!far && !near) return { s: 0, d: Infinity };
    let bs = 0, bd = Infinity;
    for (const i of near || this.pts.keys()) {
      if (i >= this.pts.length - 1) continue;
      const a = this.pts[i], b = this.pts[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2));
      const x = a.x + abx * t, z = a.z + abz * t, d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; bs = this.cum[i] + Math.sqrt(L2) * t; }
    }
    return { s: bs, d: Math.sqrt(bd) };
  }
  /** 計画上の線路の上か（敷いたかどうかは問わない） */
  onPlan(x, z, m = 0) { return this.closest({ x, z }).d < BED_HW + m; }
  /** 敷いてある線路の上か */
  onTrack(x, z, m = 0) {
    const c = this.closest({ x, z });
    if (c.d >= BED_HW + m) return false;
    const p = this.pieceAt(c.s); return !!p && p.state === 'ok';
  }
  pieceAt(s) { return this.pieces[Math.min(this.pieces.length - 1, Math.floor(this.wrap(s) / this.pieceLen))]; }
  /** 1本敷く */
  lay(p) { if (p.state === 'ok') return; p.state = 'removed'; this.restore(p); }
  /** 片付ける（迂回で使わなくなった区間）：見た目も当たり判定も消す */
  clear(p) { if (p.state === 'ok') { this.detach(p); this.group.remove(p.mesh); } p.state = 'plan'; }
}
