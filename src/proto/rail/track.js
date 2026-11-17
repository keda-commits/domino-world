import * as THREE from 'three';
import { R } from '../../core/physics.js';
import { MAT, rbox, shadow } from '../../world/props.js';

/**
 * 試作：おもちゃ鉄道の線路網。
 * 線路は「区間（Segment）」の集まり。区間は細かい点列で、長さ2の「レール1本（piece）」に分かれている。
 * レールは外せる（撤去）・砕ける（破砕）・戻せる（修理）。外れたレールの上は走れない。
 */
export const PIECE = 2.0;
export const BED_H = 0.1; // 線路の路盤の高さ（ドミノはこの上に立てられる）
export const BED_HW = 0.9; // 路盤の半幅

const v3 = (x, z) => new THREE.Vector3(x, 0, z);

/** 円弧の点列（x = cx + r cos a, z = cz + r sin a） */
export function arcPts(cx, cz, r, a0, a1, step = 0.25) {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push(v3(cx + r * Math.cos(a), cz + r * Math.sin(a))); }
  return out;
}
export function linePts(ax, az, bx, bz, step = 0.25) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(v3(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n));
  return out;
}
/** なめらかな曲線（両端の向きを指定。端の向きに沿って出入りする） */
export function splinePts(pts, t0, t1, step = 0.25) {
  const a = pts[0], b = pts[pts.length - 1];
  const ctrl = [a.clone().addScaledVector(t0, -3), ...pts, b.clone().addScaledVector(t1, 3)];
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const dense = curve.getSpacedPoints(800);
  // 端点に一番近い所で切る
  const near = (p) => { let bi = 0, bd = Infinity; dense.forEach((q, i) => { const d = q.distanceToSquared(p); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const i0 = near(a), i1 = near(b);
  const part = dense.slice(i0, i1 + 1);
  part[0] = a.clone(); part[part.length - 1] = b.clone();
  // 等間隔に並べ直す
  const out = [part[0].clone()];
  let acc = 0;
  for (let i = 1; i < part.length; i++) {
    acc += part[i].distanceTo(part[i - 1]);
    if (acc >= step) { out.push(part[i].clone()); acc = 0; }
  }
  if (out[out.length - 1].distanceTo(b) > 1e-3) out.push(b.clone());
  return out;
}
const join = (...lists) => { const out = []; for (const l of lists) for (const p of l) if (!out.length || out[out.length - 1].distanceTo(p) > 1e-4) out.push(p); return out; };

export class Segment {
  constructor(id, pts, label) {
    this.id = id; this.label = label; this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    this.len = this.cum[this.cum.length - 1];
    this.pieces = [];
  }
  index(s) {
    s = Math.max(0, Math.min(this.len, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= s) lo = m; else hi = m; }
    return lo;
  }
  pointAt(s, out = new THREE.Vector3()) {
    const i = this.index(s), a = this.pts[i], b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    const L = this.cum[Math.min(i + 1, this.cum.length - 1)] - this.cum[i] || 1;
    return out.copy(a).lerp(b, Math.max(0, Math.min(1, (s - this.cum[i]) / L)));
  }
  tangentAt(s, out = new THREE.Vector3()) {
    const i = Math.min(this.index(s), this.pts.length - 2);
    return out.subVectors(this.pts[i + 1], this.pts[i]).normalize();
  }
  /** 点 p に一番近い位置 {s, d} */
  closest(p) {
    let bs = 0, bd = Infinity;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / L2));
      const x = a.x + abx * t, z = a.z + abz * t, d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; bs = this.cum[i] + Math.sqrt(L2) * t; }
    }
    return { s: bs, d: Math.sqrt(bd) };
  }
  pieceAt(s) { return this.pieces[Math.min(this.pieces.length - 1, Math.max(0, Math.floor(s / PIECE)))]; }
}

/**
 * 線路網（試作のレイアウト）。進行方向は時計回り：
 *   A  … 分岐S → 西の直線（駅A・ドミノとの交差地点）→ 合流N
 *   BP … 分岐S → 外まわりの迂回線（ドミノのスタート地点の外側をまわる）→ 合流N
 *   B1 … N → 東の直線の手前 D1
 *   B2 … D1 → D2（本線・駅B）／ DS … D1 → 車庫の中を通る側線 → D2
 *   B3 … D2 → S
 */
export class TrackNet {
  constructor(scene, physics) {
    this.scene = scene; this.physics = physics;
    this.group = new THREE.Group(); scene.add(this.group);
    const aS = 2.2, aN = 2 * Math.PI - 2.2;
    const S = v3(10 * Math.cos(aS), 8 + 10 * Math.sin(aS)), N = v3(10 * Math.cos(aN), -8 + 10 * Math.sin(aN));
    const tS = v3(-Math.sin(aS), Math.cos(aS)).normalize(), tN = v3(-Math.sin(aN), Math.cos(aN)).normalize();
    this.S = S; this.N = N;
    const seg = (id, pts, label) => (this.segs[id] = new Segment(id, pts, label));
    this.segs = {};
    seg('A', join(arcPts(0, 8, 10, aS, Math.PI), linePts(-10, 8, -10, -8), arcPts(0, -8, 10, Math.PI, aN)), '本線（駅A経由）');
    seg('BP', splinePts([S, v3(-13, 20), v3(-26, 21), v3(-36, 13), v3(-38.5, 0), v3(-36, -13), v3(-26, -21), v3(-13, -20), N], tS, tN), '外まわり迂回線');
    seg('B1', join(arcPts(0, -8, 10, aN, 2 * Math.PI), linePts(10, -8, 10, -3)), '本線（北）');
    seg('B2', linePts(10, -3, 10, 5), '本線（駅B）');
    seg('DS', splinePts([v3(10, -3), v3(11.6, -0.5), v3(12.4, 1), v3(11.6, 2.5), v3(10, 5)], v3(0, 0, 1), v3(0, 0, 1)), '車庫線');
    seg('B3', join(linePts(10, 5, 10, 8), arcPts(0, 8, 10, 0, aS)), '本線（南）');
    // 分岐：S（本線A／迂回線BP）、D1（本線B2／車庫線DS）
    this.switches = {
      S: { id: 'S', pos: S, state: 'A', options: { A: 'A', BP: 'BP' }, label: 'ポイントS', setBy: 'rail', changedAt: 0 },
      D: { id: 'D', pos: v3(10, -3), state: 'B2', options: { B2: 'B2', DS: 'DS' }, label: 'ポイントD（車庫）', setBy: 'rail', changedAt: 0 },
    };
    this.next = { A: () => 'B1', BP: () => 'B1', B1: () => this.switches.D.state, B2: () => 'B3', DS: () => 'B3', B3: () => this.switches.S.state };
    for (const s of Object.values(this.segs)) this.buildPieces(s);
    this.debris = [];
    this.makeSwitchMarkers();
  }

  // ---------- 見た目と当たり判定（レール1本ずつ） ----------
  buildPieces(seg) {
    const n = Math.max(1, Math.round(seg.len / PIECE));
    const len = seg.len / n;
    for (let i = 0; i < n; i++) {
      const s0 = i * len, s1 = (i + 1) * len;
      const a = seg.pointAt(s0), b = seg.pointAt(s1), mid = seg.pointAt((s0 + s1) / 2);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const chord = a.distanceTo(b);
      const p = { seg, i, s0, s1, mid, yaw, chord, state: 'ok', mesh: this.pieceMesh(chord), collider: null };
      p.mesh.position.set(mid.x, 0, mid.z); p.mesh.rotation.y = yaw;
      this.group.add(p.mesh);
      p.collider = this.pieceCollider(p);
      seg.pieces.push(p);
    }
    // 区間の長さと、レール1本ごとの区切り（s で引けるように）
    seg.pieceLen = len;
    seg.pieceAt = (s) => seg.pieces[Math.min(seg.pieces.length - 1, Math.max(0, Math.floor(s / len)))];
  }
  pieceMesh(chord) {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(rbox(BED_HW * 2, BED_H, chord + 0.03, 0.03), MAT.plastic('#9aa7b8'));
    bed.position.y = BED_H / 2; g.add(bed);
    for (const sx of [-0.45, 0.45]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, chord + 0.03), MAT.metal('#e9ecef')); r.position.set(sx, BED_H + 0.045, 0); g.add(r); }
    for (let k = 0; k < 3; k++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.03, 0.22), MAT.plastic('#6c7a8c')); sl.position.set(0, BED_H + 0.015, -chord / 2 + (chord / 3) * (k + 0.5)); g.add(sl); }
    // つなぎ目のツメ（おもちゃのレールらしく）
    const tab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.2), MAT.plastic('#7b8899')); tab.position.set(0, BED_H * 0.5, chord / 2); g.add(tab);
    return shadow(g);
  }
  pieceCollider(p) {
    const d = R.ColliderDesc.cuboid(BED_HW, BED_H / 2, p.chord / 2).setTranslation(p.mid.x, BED_H / 2, p.mid.z).setRotation(this.physics.quatYaw(p.yaw)).setFriction(0.6);
    return this.physics.world.createCollider(d);
  }
  makeSwitchMarkers() {
    this.markers = {};
    for (const sw of Object.values(this.switches)) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(rbox(0.8, 0.5, 0.8, 0.08), MAT.plastic('#343a40')); base.position.y = 0.25; g.add(base);
      const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), MAT.plastic('#fab005')); lever.position.y = 0.9; g.add(lever);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), MAT.plastic('#e03131')); knob.position.y = 1.4; g.add(knob);
      const off = sw.id === 'S' ? v3(0.5, 2.8) : v3(-2.2, 0);
      g.position.copy(sw.pos).add(off);
      g.userData = { lever, knob, sw };
      shadow(g); this.group.add(g);
      this.markers[sw.id] = g;
    }
    this.updateMarkers();
  }
  updateMarkers() {
    for (const [id, g] of Object.entries(this.markers)) {
      const sw = this.switches[id];
      const main = sw.state === 'A' || sw.state === 'B2';
      g.userData.lever.rotation.z = main ? 0.45 : -0.45; g.userData.lever.position.x = main ? -0.2 : 0.2;
      g.userData.knob.position.x = main ? -0.42 : 0.42;
      g.userData.knob.material.color.set(main ? '#2f9e44' : '#f08c00');
    }
  }
  setSwitch(id, state, by = 'rail', time = 0) {
    const sw = this.switches[id];
    if (!sw || sw.state === state) return false;
    sw.state = state; sw.setBy = by; sw.changedAt = time;
    this.updateMarkers();
    return true;
  }

  // ---------- 問い合わせ ----------
  /** 点の近くの線路（全区間）：{seg, s, d} */
  nearest(p) {
    let best = null;
    for (const seg of Object.values(this.segs)) { const c = seg.closest(p); if (!best || c.d < best.d) best = { seg, s: c.s, d: c.d }; }
    return best;
  }
  /** ドミノを立てる床の高さ：使えるレールの路盤の上なら BED_H */
  bedHeightAt(x, z) {
    const n = this.nearest(v3(x, z));
    if (!n || n.d > BED_HW - 0.08) return 0;
    const p = n.seg.pieceAt(n.s);
    return p && p.state === 'ok' ? BED_H : 0;
  }
  /** 線路の上（路盤の幅）か */
  onTrack(x, z, m = 0) { const n = this.nearest(v3(x, z)); return n && n.d < BED_HW + m; }
  /** 区間の s 付近のレールが使えるか */
  usable(seg, s) { const p = seg.pieceAt(s); return !p || p.state === 'ok'; }

  // ---------- 撤去・破砕・修理 ----------
  /** レールを外す（当たり判定を消し、見た目は呼び出し側が運ぶ） */
  detach(p) {
    if (p.state !== 'ok') return null;
    p.state = 'removed';
    this.physics.remove(p.collider); p.collider = null;
    return p.mesh;
  }
  /** レールを砕く：本体は消え、破片（物理）が飛び散る */
  shatter(p, power = 1) {
    if (p.state !== 'ok' && p.state !== 'removed') return [];
    p.state = 'broken';
    if (p.collider) { this.physics.remove(p.collider); p.collider = null; }
    p.mesh.visible = false;
    const out = [];
    const mats = [MAT.plastic('#9aa7b8'), MAT.metal('#e9ecef'), MAT.plastic('#6c7a8c')];
    for (let k = 0; k < 7; k++) {
      const w = 0.25 + Math.random() * 0.4, h = 0.08 + Math.random() * 0.05, d = 0.25 + Math.random() * 0.5;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[k % 3]); m.castShadow = true;
      const x = p.mid.x + (Math.random() - 0.5) * 1.2, z = p.mid.z + (Math.random() - 0.5) * 1.6;
      const b = this.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, 0.3, z).setLinearDamping(0.6).setAngularDamping(0.5));
      this.physics.world.createCollider(R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setDensity(0.4).setFriction(0.7), b);
      const a = Math.random() * Math.PI * 2;
      b.setLinvel({ x: Math.cos(a) * 6 * power, y: 7 + Math.random() * 5, z: Math.sin(a) * 6 * power }, true);
      b.setAngvel({ x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 }, true);
      this.scene.add(m);
      const deb = { m, b, piece: p };
      this.debris.push(deb); out.push(deb);
    }
    return out;
  }
  removeDebris(deb) {
    // 修理班と建設担当が同じ破片を拾うことがある：2回目は何もしない（剛体の二重削除は物理エンジンを壊す）
    if (!deb || deb.gone || !this.debris.includes(deb)) return;
    deb.gone = true;
    this.scene.remove(deb.m); this.physics.world.removeRigidBody(deb.b);
    this.debris.splice(this.debris.indexOf(deb), 1);
  }
  /** レールを元の位置に戻す（新品） */
  restore(p, fresh = false) {
    if (p.state === 'ok') return;
    p.state = 'ok';
    // 外されて運ばれたレールはスクラップ置き場に残る：新品のレールを作って置く
    if (fresh) { p.mesh = this.pieceMesh(p.chord); this.group.add(p.mesh); }
    p.mesh.visible = true;
    if (p.mesh.parent !== this.group) { p.mesh.removeFromParent(); this.group.add(p.mesh); }
    p.mesh.position.set(p.mid.x, 0, p.mid.z); p.mesh.rotation.set(0, p.yaw, 0);
    p.collider = this.pieceCollider(p);
  }
  update() {
    for (const d of this.debris) { const t = d.b.translation(), q = d.b.rotation(); d.m.position.set(t.x, t.y, t.z); d.m.quaternion.set(q.x, q.y, q.z, q.w); }
  }
  /** 試作のやり直し用 */
  reset() {
    for (const s of Object.values(this.segs)) for (const p of s.pieces) { this.restore(p, !!p.scrapped); p.scrapped = false; }
    for (const d of [...this.debris]) this.removeDebris(d);
    this.setSwitch('S', 'A'); this.setSwitch('D', 'B2');
  }
}
