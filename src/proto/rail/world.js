import * as THREE from 'three';
import { Physics } from '../../core/physics.js';
import { Dominoes } from '../../core/dominoes.js';
import { MAT, rbox, shadow, woodTex } from '../../world/props.js';
import { footbridgeMesh } from '../../world/devices.js';
import { TrackNet, BED_H, BED_HW } from './track.js';
import { Train } from './trains.js';
import { Person } from './people.js';

/**
 * 試作「鉄道勢力との共存と衝突」の世界。
 * - 鉄道（ぽっぽ鉄道）：2本の列車が時刻表どおりに駅A・駅Bに停まり、ときどき車庫で点検する。
 *   駅Aのお客さん・駅長・修理班がいて、邪魔されると抗議し、壊されると修理する。
 * - ドミノ建設隊：建設担当・エリート建築士・レールはがし隊。
 * - 交差地点：ドミノのコース（z=0）が西の線路（x=-10）を横切る。ここをどう越えるかを選ぶ。
 */
const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;

// ---- コース ----
const FLAT_START = -30, ZONE_START = -17.4, GOAL_X = 1.4;
function outerSlots() { const out = []; for (let x = FLAT_START; x < ZONE_START - 0.3; x += 0.6) out.push({ x: +x.toFixed(2), y: 0, z: 0 }); return out; }
function flatZoneSlots(track) { const out = []; for (let i = 0; ; i++) { const x = ZONE_START + i * 0.6; if (x > GOAL_X + 0.01) break; out.push({ x: +x.toFixed(2), z: 0, flat: true }); } out.forEach((s) => (s.y = track.bedHeightAt(s.x, 0))); return out; }
/** ドミノ階段：上り8段（段差0.25）→ 線路の上の床（高さ2.0）→ 下り10段（段差0.2・間隔0.8）→ ゴール */
export const STAIRS = (() => {
  const parts = [], slots = [];
  for (let i = 1; i <= 8; i++) { const x = ZONE_START + (i - 1) * 0.6, y = 0.25 * i; parts.push({ kind: 'step', x, y, hx: 0.3 }); slots.push({ x, y, z: 0 }); }
  for (let k = 0; k < 4; k++) parts.push({ kind: 'deck', x: -12.3 + k * 1.2, y: 2.0, hx: 0.6 });
  parts.push({ kind: 'pillar', x: -8.3, y: 1.75, hx: 0.15 });
  for (let x = -12.6; x <= -8.39; x += 0.6) slots.push({ x: +x.toFixed(2), y: 2.0, z: 0 });
  for (let j = 1; j <= 10; j++) { const x = -7.6 + (j - 1) * 0.8, y = +(2.0 - 0.2 * j).toFixed(2); if (y > 0) parts.push({ kind: 'step', x, y, hx: 0.4 }); slots.push({ x, y, z: 0 }); }
  for (const x of [0.2, 0.8, 1.4]) slots.push({ x, y: 0, z: 0 });
  return { parts, slots };
})();

export class RailWorld {
  constructor(scene, fx, audio) {
    this.scene = scene; this.fx = fx; this.audio = audio;
    this.physics = new Physics();
    this.dominoes = new Dominoes(scene, this.physics);
    this.time = 0; this.epoch = 0;
    this.relation = 70; // 鉄道との友好度（0〜100）。やり直しても残る
    this.newsLog = [];
    this.metrics = { crossWait: 0, crossWaitCount: 0 };
    this.buildRoom();
    this.track = new TrackNet(scene, this.physics);
    this.stations = [
      { name: '駅A', seg: 'A', s: 15.2, dwell: 4 },
      { name: '駅B', seg: 'B2', s: 6.6, dwell: 4 },
      { name: '車庫', seg: 'DS', s: this.track.segs.DS.len * 0.5, dwell: 8, depot: true },
    ];
    this.buildStations();
    this.trains = [
      new Train(this, { name: 'あおば号', color: '#2fb380', roof: '#1b6e4f', startLegs: ['B1', 'B2'], startS: 6.6, dwell: 2 }),
      new Train(this, { name: 'ひばり号', color: '#f06548', roof: '#a83a24', startLegs: ['B3', 'A'], startS: 4, cars: 3 }),
    ];
    this.paxA = 3; this.paxT = 0;
    this.signalRed = false; this.holdT = 0;
    this.archLv = 0; this.footbridge = null; this.stairs = null;
    this.planks = 40;
    this.reset(true);
  }

  // ================= 部屋・駅・設備の見た目 =================
  buildRoom() {
    const s = this.scene;
    const tex = woodTex('#d9ae7a', '#b5835a', 'protoFloor'); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(10, 8);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 100), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    floor.rotation.x = -PI / 2; floor.receiveShadow = true; s.add(floor);
    const hemi = new THREE.HemisphereLight('#fff4e0', '#6b5040', 0.9); s.add(hemi);
    const sun = new THREE.DirectionalLight('#fff1d6', 2.6); sun.position.set(-30, 60, 25); sun.castShadow = true; sun.target.position.set(-8, 0, 0); s.add(sun, sun.target);
    this.sun = sun;
    // 横断歩道（人の踏切）
    for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 1.6), new THREE.MeshStandardMaterial({ color: '#ffffff' })); m.position.set(-11.6 + k * 0.8, BED_H + 0.02, -6); s.add(m); }
    // 資材箱・材木置き場・スクラップ置き場・待機所の看板
    this.crate = { pos: V(-26, -6), count: 0, mesh: this.boxMesh('#c08a4e') }; this.crate.mesh.position.copy(this.crate.pos); s.add(this.crate.mesh);
    this.lumber = new THREE.Group(); this.lumber.position.set(-20, 0, -10);
    for (let i = 0; i < 20; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 1.3), MAT.wood('#d4a373')); p.position.set((i % 5) * 0.26 - 0.52, 0.06 + Math.floor(i / 5) * 0.13, 0); this.lumber.add(p); }
    shadow(this.lumber); s.add(this.lumber);
    this.scrap = V(-14.5, -3.5);
    this.sign(V(-26, -8.4), '📦 ドミノ資材箱', '#ffd8a8');
    this.sign(V(-20, -11.6), '🪵 材木置き場', '#e9d8a6');
    this.sign(V(-14.5, -5.2), '🗑 外したレール', '#dee2e6');
    // ゴールのベル
    const bell = new THREE.Group();
    bell.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8), MAT.metal()).translateY(1.0));
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.45, 0.55, 18, 1, true), Object.assign(MAT.metal('#f2c14e'), { side: THREE.DoubleSide })); cup.position.y = 1.7; bell.add(cup);
    bell.position.set(GOAL_X + 0.9, 0, 0.7); shadow(bell); s.add(bell); this.bellCup = cup;
    // スタート台
    const pad = new THREE.Mesh(rbox(1.4, 0.1, 1.4, 0.05), MAT.plastic('#4dabf7')); pad.position.set(FLAT_START - 1, 0.05, 0); s.add(pad);
  }
  boxMesh(color) {
    const g = new THREE.Group(); const wood = MAT.wood(color);
    g.add(new THREE.Mesh(rbox(2.4, 0.25, 1.8, 0.05), wood).translateY(0.12));
    for (const [x, z, w, d] of [[0, 0.85, 2.4, 0.12], [0, -0.85, 2.4, 0.12], [1.15, 0, 0.12, 1.8], [-1.15, 0, 0.12, 1.8]]) g.add(new THREE.Mesh(rbox(w, 0.5, d, 0.04), wood).translateX(x).translateY(0.5).translateZ(z));
    g.userData.minis = [];
    for (let i = 0; i < 24; i++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.68, 0.12), MAT.plastic(['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#b197fc'][i % 5])); d.position.set(-0.85 + (i % 6) * 0.34, 0.6, -0.35 + (Math.floor(i / 6) % 4) * 0.23); d.visible = false; g.add(d); g.userData.minis.push(d); }
    return shadow(g);
  }
  sign(pos, text, color) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 512, 128); x.fillStyle = '#2b2b2b'; x.font = 'bold 56px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide }));
    m.position.copy(pos).setY(1.4); m.rotation.y = 0.0; this.scene.add(m);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), MAT.metal()); pole.position.copy(pos).setY(0.7); this.scene.add(pole);
    return m;
  }
  buildStations() {
    const s = this.scene;
    const platform = (x, z0, z1, side, name, color) => {
      const g = new THREE.Group();
      const len = z1 - z0;
      g.add(new THREE.Mesh(rbox(1.6, 0.45, len, 0.06), MAT.plastic('#ced4da')).translateY(0.22));
      const roof = new THREE.Mesh(rbox(1.9, 0.12, len * 0.8, 0.05), MAT.plastic(color)); roof.position.set(side * 0.2, 2.6, 0); g.add(roof);
      for (const zz of [-len * 0.3, len * 0.3]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), MAT.metal()).translateX(side * 0.6).translateY(1.5).translateZ(zz));
      g.position.set(x, 0, (z0 + z1) / 2);
      shadow(g); s.add(g);
      this.sign(V(x + side * 0.3, (z0 + z1) / 2, 0).setY(0), `🚉 ${name}`, '#d0ebff').position.y = 3.1;
      return g;
    };
    platform(-11.9, 1.6, 8, -1, '駅A（こまわり駅）', '#1c7ed6');
    platform(8.1, -0.2, 6.6, 1, '駅B（みなと駅）', '#1c7ed6');
    // 車庫（側線の上の小屋）
    const shed = new THREE.Group();
    const wallM = MAT.plastic('#e8590c');
    shed.add(new THREE.Mesh(rbox(0.2, 2.4, 6.5, 0.04), wallM).translateX(1.2).translateY(1.2));
    shed.add(new THREE.Mesh(rbox(3.2, 0.2, 6.8, 0.05), MAT.plastic('#c92a2a')).translateY(2.5));
    shed.position.set(12.0, 0, 1); shadow(shed); s.add(shed);
    this.sign(V(14.6, 1.5), '🛠 ぽっぽ鉄道 車庫', '#ffe8cc');
    // 信号機（駅Aの出口）
    const sig = new THREE.Group();
    sig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), MAT.metal('#495057')).translateY(1.3));
    const head = new THREE.Mesh(rbox(0.4, 0.8, 0.3, 0.06), MAT.plastic('#212529')); head.position.y = 2.7; sig.add(head);
    this.sigRed = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff0000', emissiveIntensity: 0.05 })); this.sigRed.position.set(0, 2.9, 0.16); sig.add(this.sigRed);
    this.sigGreen = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: '#40c057', emissive: '#00ff40', emissiveIntensity: 1.2 })); this.sigGreen.position.set(0, 2.5, 0.16); sig.add(this.sigGreen);
    sig.position.set(-11.3, 0, 1.2); sig.rotation.y = PI; shadow(sig); s.add(sig);
    // 駅Aで待つお客さん（小さな人形）
    this.paxMeshes = [];
    for (let i = 0; i < 14; i++) { const p = new THREE.Group(); p.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.25, 4, 8), MAT.plastic(['#fcc2d7', '#a5d8ff', '#b2f2bb', '#ffec99'][i % 4])).translateY(0.75)); p.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), MAT.plastic('#ffd8b0')).translateY(1.05)); p.position.set(-12.2 + (i % 2) * 0.35, 0, 2.2 + Math.floor(i / 2) * 0.8); p.visible = false; s.add(shadow(p)); this.paxMeshes.push(p); }
  }

  // ================= 人・ドミノ・設備の初期化（やり直し） =================
  reset(first = false) {
    this.epoch++;
    this.tweens = [];
    for (const p of this.people || []) p.dispose();
    this.dominoes.clear();
    this.track.reset();
    this.signalRed = false; this.holdT = 0;
    this.crate.count = 140;
    if (!this.keepStructures || !(this.stairs || this.footbridge)) this.planks = 40; // 翌日：材木が届く
    this.people = [];
    const P = (role, x, z, name) => { const p = new Person(this, role, V(x, z), name); this.people.push(p); return p; };
    this.builders = [P('builder', -24, -10, '建設担当A'), P('builder', -23, -11, '建設担当B')];
    this.architect = this.archLv > 0 ? P('architect', -21.5, -12.5, 'エリート建築士') : null;
    this.wreckers = [P('wrecker', -27, -12, 'レールはがし隊A'), P('wrecker', -28, -11, 'レールはがし隊B')];
    this.wreckers.forEach((w) => w.setTool('bar'));
    this.railcrew = [P('railcrew', 14.5, 6.5, '修理班・ナット'), P('railcrew', 15.2, 7.5, '修理班・ボルト')];
    this.railcrew.forEach((w) => { w.home = w.pos.clone(); w.setTool('wrench'); w.face(V(10, 6)); });
    this.master = P('stationmaster', -12.4, 0.8, '駅長'); this.master.setTool('flag'); this.master.face(V(-10, 0));
    this.slots = outerSlots();
    for (const sl of this.slots) { sl.domino = this.dominoes.create({ x: sl.x, y: sl.y, z: 0, yaw: PI / 2 }, { slot: sl }); }
    this.zone = null; this.zoneSlots = [];
    this.chain = null; this.repairing = null; this.clearing = false;
    this.attempt = null;
    this.hammer && (this.scene.remove(this.hammer), (this.hammer = null));
    if (this.stairs && !this.keepStructures) this.removeStairs();
    if (this.footbridge && !this.keepStructures) this.removeFootbridge();
    if (this.stairs) this.stairs.parts.forEach((pp) => { pp.mesh.scale.y = 1; });
    this.wreckTarget = null;
    if (!first) this.news('（翌日）ドミノ建設隊が新しい挑戦を始めます。線路は夜のうちに鉄道が直しました');
  }

  // ================= 鉄道側の暮らし・反応 =================
  news(text) { this.newsLog.unshift({ t: this.time, text }); this.newsLog.length = Math.min(this.newsLog.length, 8); }
  say(obj, text, cls = '') { this.fx.floatObj(obj, text, cls, 2.6, 0.6); }
  rel(d, why) {
    const before = this.relation;
    this.relation = Math.max(0, Math.min(100, this.relation + d));
    if (this.attempt) this.attempt.rel += this.relation - before;
    if (why && d <= -5) this.news(`友好度 ${d}：${why}`);
  }
  onLegCommitted(train, segId) {
    if (segId === 'BP') this.news(`${train.name}：外まわりの迂回線へ（駅Aは通過）`);
  }
  onBackedOff(train) {
    // 本線に使えないレールがあれば、鉄道が自分で分岐を迂回線に切り替える
    const A = this.track.segs.A;
    if (A.pieces.some((p) => p.state !== 'ok')) {
      if (this.track.setSwitch('S', 'BP', 'rail', this.time)) this.news('鉄道：分岐Sを迂回線に切り替えました（本線は工事中）');
    }
  }
  onBlocked(train, ob) {
    const t = train.name;
    if (this.attempt) this.attempt.stops++;
    if (ob.kind === 'domino') { this.say(train.meshes[0], `${t}「線路にドミノが！ どかしてくださ〜い」`, 'warn'); this.rel(-2); this.audio.toot(); if (this.attempt) this.attempt.protests++; this.news(`${t}：線路の上のドミノで停車。抗議中`); }
    if (ob.kind === 'person') { this.say(train.meshes[0], `${t}「あぶないですよ〜！」`, 'warn'); this.rel(-1); this.audio.toot(); if (this.attempt) this.attempt.protests++; }
    if (ob.kind === 'gap') { this.say(train.meshes[0], `${t}「線路が…ない！？」`, 'warn'); this.audio.toot(); }
    if (ob.kind === 'debris') { this.say(train.meshes[0], `${t}「破片が散らばってる…進めません」`, 'warn'); }
    if (ob.kind === 'hammer') { this.say(train.meshes[0], `${t}「線路の上に大きなハンマーが！？」`, 'warn'); this.audio.toot(); this.rel(-2); if (this.attempt) this.attempt.protests++; }
  }
  onStation(train, st) {
    if (st.name === '駅A') {
      const n = this.paxA; this.paxA = 0;
      if (n) this.say(this.paxMeshes[0], `お客さん${n}人「やっと来た〜」`, n > 8 ? 'warn' : '');
      this.master.act(2, 'wave');
      // 友好度が高いと、鉄道からドミノの差し入れ（共存の長期的なメリット）
      if (this.relation >= 85 && this.time - (train.lastGift || -999) > 60) {
        train.lastGift = this.time; this.crate.count += 6;
        this.say(train.meshes[0], `${train.name}「いつも線路を大事にしてくれてありがとう！ ドミノを6枚どうぞ」`, 'coin');
        this.news(`${train.name}：お礼にドミノ6枚を運んでくれた（友好度${Math.round(this.relation)}）`);
      }
    }
  }
  onHoldTick(train, dt) {
    this.holdT += dt;
    if (this.attempt) this.attempt.delay += dt;
    const holdMax = Math.max(18, (this.trafficWindow || 50) - 10);
    if (this.holdT > holdMax * 0.55 && !this.holdSaid) { this.holdSaid = true; this.master.say('お客さんが待っています…そろそろ発車させてください'); this.master.act(2.5, 'protest'); this.rel(-2); }
    if (this.holdT > holdMax) {
      this.signalRed = false; this.holdT = 0; this.holdSaid = false;
      this.master.say('時刻表があるので発車します！'); this.rel(-4, '信号で長く止められた');
      this.news('駅長：信号を青に戻しました（待ち時間の限界）');
    }
  }
  onTrainMoved(train, dt) {
    // ドミノ階段の下をくぐると、うれしそうに汽笛を鳴らす
    if (this.stairs && this.stairs.done) {
      const p = train.pointAt(train.s, new THREE.Vector3());
      const leg = train.legAt(train.s);
      if (Math.abs(p.x + 10) < 0.6 && Math.abs(p.z) < 0.6 && !train.stairsThanked.has(leg)) {
        train.stairsThanked.add(leg); train.hop = 1; this.audio.toot();
        this.say(train.meshes[0], `${train.name}「立体交差だ！ 気持ちよく走れる〜♪」`, 'coin');
        if ((this.stairsGood || 0) < 15) { this.stairsGood = (this.stairsGood || 0) + 1; this.rel(+1); }
        if (this.attempt) this.attempt.thanks++;
      }
    }
    if (this.attempt && Math.abs(train.v) < 0.05 && train.state === 'run') this.attempt.delay += dt;
  }
  /** 列車の前のドミノ・破片がどかない：修理班が来てどかす（ドミノの列は欠ける） */
  async requestClear(p, train) {
    const crew = this.railcrew.find((c) => !c.busy);
    if (!crew) return;
    const ep = this.epoch;
    crew.busy = true;
    this.news(`鉄道：${train.name}の前の障害物をどかしに修理班が出動`);
    await crew.walkTo(V(p.x - 1.4, p.z));
    if (ep !== this.epoch) return;
    crew.face(p); crew.say('すみません、線路の上の物をどかしますね'); await crew.act(1.5, 'protest');
    const items = [...this.dominoes.list].filter((d) => { const t = d.body.translation(); return t.y < 1.5 && Math.hypot(t.x - p.x, t.z - p.z) < 2.0 && this.track.onTrack(t.x, t.z, 0.15); });
    for (const d of items) { if (ep !== this.epoch) return; await crew.act(0.5, 'place'); this.layAside(d); }
    for (const deb of [...this.track.debris]) { const t = deb.b.translation(); if (Math.hypot(t.x - p.x, t.z - p.z) < 2.5) { await crew.act(0.5, 'place'); this.track.removeDebris(deb); } }
    await crew.walkTo(crew.home); crew.busy = false;
  }
  /** ドミノを線路の脇に寝かせる（鉄道の人がどかした） */
  layAside(d) {
    if (!d || d.removed) return; // ほかの人が先に片付けた
    const t = d.body.translation();
    const n = this.track.nearest(V(t.x, t.z));
    const away = V(t.x, t.z).sub(n.seg.pointAt(n.s)).setY(0);
    if (away.lengthSq() < 1e-4) away.set(-1, 0, 0.3);
    away.normalize();
    const x = t.x + away.x * (BED_HW + 0.9 - n.d), z = t.z + away.z * (BED_HW + 0.9 - n.d);
    const color = d.color;
    if (d.slot) d.slot.domino = null;
    this.dominoes.remove(d);
    this.dominoes.create({ x, y: 0, z, yaw: Math.random() * PI }, { lying: true, color });
    this.metrics.removedByRail = (this.metrics.removedByRail || 0) + 1;
    if (this.attempt) this.attempt.removedByRail++;
  }

  // ================= 線路の撤去・破砕・修理 =================
  crossingPiece() { const A = this.track.segs.A; const n = A.closest(V(-10, 0)); return A.pieceAt(n.s); }
  /** レールはがし隊：指定したレールを外して、スクラップ置き場へ運ぶ */
  async wreck(piece) {
    if (!piece || piece.state !== 'ok' || this.wreckBusy) return false;
    const ep = this.epoch; this.wreckBusy = true; this.wreckTarget = piece;
    const [a, b] = this.wreckers;
    a.say('レールはがし隊、出動！'); this.news('ドミノ建設隊：レールはがし隊が線路の撤去に向かいました');
    if (this.attempt) this.attempt.markPrep('撤去開始');
    const along = V(Math.sin(piece.yaw), Math.cos(piece.yaw)).multiplyScalar(1.3); // レールの前後（ドミノの列の上に立たない）
    const p1 = piece.mid.clone().add(along), p2 = piece.mid.clone().sub(along);
    // まず線路の脇（レールの外・ドミノの列の外）で待機し、列車がいないときに線路へ入る（安全第一）
    const perp = V(Math.cos(piece.yaw), -Math.sin(piece.yaw)).multiplyScalar(-2.4);
    const s1 = p1.clone().add(perp), s2 = p2.clone().add(perp);
    await Promise.all([a.walkTo(s1), b.walkTo(s2)]);
    if (ep !== this.epoch) return false;
    let said = false;
    while (this.movingTrainNear(piece.mid, 10)) { if (!said) { said = true; a.say('列車が通過するまで線路の脇で待機'); } await a.wait(0.5); if (ep !== this.epoch) return false; }
    await Promise.all([a.walkTo(p1), b.walkTo(p2)]);
    if (ep !== this.epoch) return false;
    a.face(piece.mid); b.face(piece.mid);
    a.say('せーの！ ギギギ…'); this.audio.clunk();
    await Promise.all([a.act(3.0, 'pry'), b.act(3.0, 'drill')]);
    if (ep !== this.epoch) return false;
    // 外れた：本当に持ち上がり、ふたりで運んでいく
    const mesh = this.track.detach(piece);
    if (!mesh) { this.wreckBusy = false; return false; }
    piece.scrapped = true;
    this.audio.punch();
    this.onBreak([piece], 'removed');
    mesh.removeFromParent(); this.scene.add(mesh);
    const lift = { mesh, carriers: [a, b], t: 0 };
    this.carried = lift;
    a.setTool(null); b.setTool(null);
    await Promise.all([a.walkTo(this.scrap.clone().add(V(-0.8, 0))), b.walkTo(this.scrap.clone().add(V(0.8, 0)))]);
    if (ep !== this.epoch) return false;
    this.carried = null;
    const k = (this.scrapCount = (this.scrapCount || 0) + 1);
    mesh.position.set(this.scrap.x, 0.05 + k * 0.12, this.scrap.z); mesh.rotation.set(0, 0.3 * k, 0);
    a.setTool('bar'); b.setTool('bar');
    a.say('撤去完了！ 今のうちにドミノを通そう');
    if (this.attempt) this.attempt.markPrep('撤去完了');
    await Promise.all([a.walkTo(V(-27, -12)), b.walkTo(V(-28, -11))]);
    this.wreckBusy = false;
    return true;
  }
  /** 破砕ハンマー：落ちてきて、ひと振りでレールを砕く（衝撃と破片でまわりのドミノも倒れることがある） */
  async smash(piece) {
    if (!piece || piece.state !== 'ok' || this.hammerBusy) return false;
    const ep = this.epoch; this.hammerBusy = true;
    if (this.attempt) this.attempt.markPrep('ハンマー');
    const g = new THREE.Group();
    const frame = new THREE.Mesh(rbox(0.3, 3.4, 0.3, 0.05), MAT.plastic('#f08c00')); frame.position.set(-1.6, 1.7, 0); g.add(frame);
    const arm = new THREE.Group(); arm.position.set(-1.6, 3.2, 0); g.add(arm);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 8), MAT.wood('#8a5a30')); stick.rotation.z = PI / 2; stick.position.x = 0.9; arm.add(stick);
    const head = new THREE.Mesh(rbox(0.9, 0.7, 0.7, 0.1), MAT.metal('#495057')); head.position.x = 1.8; arm.add(head);
    g.position.set(piece.mid.x, 12, piece.mid.z); shadow(g); this.scene.add(g); this.hammer = g;
    this.news('ドミノ建設隊：破砕ハンマーを投入！');
    // 落ちてくる → 振り上げ → 振り下ろし（シミュレーション時間で動く）
    await this.tween(1.0, (k) => { g.position.y = 12 * (1 - k) * (1 - k); });
    if (ep !== this.epoch) return false;
    g.position.y = 0; this.audio.clunk();
    while (this.movingTrainNear(piece.mid, 6)) { await this.tween(0.5, () => {}); if (ep !== this.epoch) return false; }
    await this.tween(0.8, (k) => { arm.rotation.z = k * 1.2; });
    await this.tween(0.15, (k) => { arm.rotation.z = 1.2 - k * 2.3; });
    this.audio.punch(); this.audio.bonk();
    this.fx.floatAt(piece.mid.clone().setY(2.5), 'ドガーン！', 'big', 1.4);
    this.track.shatter(piece, 1);
    // 衝撃：近くのドミノを揺らす
    let shaken = 0;
    for (const d of this.dominoes.list) { const t = d.body.translation(); const r = Math.hypot(t.x - piece.mid.x, t.z - piece.mid.z); if (r < 3.2 && !d.toppled) { const sz = Math.random() < 0.5 ? 1 : -1; d.body.wakeUp(); this.dominoes.push(d, (Math.random() - 0.5) * 0.3, sz, 0.08 + (3.2 - r) * 0.03); shaken++; } } // 衝撃は横向き（1枚ずつ倒れる）。飛び散る破片が当たると連鎖することも
    if (shaken && this.attempt) this.attempt.shaken += shaken;
    this.onBreak([piece], 'broken');
    await this.tween(1.5, () => {});
    // 衝撃で倒れたドミノがあれば、建設担当が立て直す（時間がかかる）
    this.restandFallen();
    await this.tween(1.0, (k) => { g.position.y = k * 14; });
    this.scene.remove(g); this.hammer = null; this.hammerBusy = false;
    if (this.attempt) this.attempt.markPrep('破砕完了');
    return true;
  }
  onBreak(pieces, how) {
    this.rel(how === 'broken' ? -18 : -10, how === 'broken' ? 'レールを砕かれた' : 'レールを外された');
    this.news(how === 'broken' ? '鉄道：レールが砕かれた！ 修理班が新しいレールを取りに行きます' : '鉄道：レールが外された！ 修理班を出動させます');
    this.master.say(how === 'broken' ? 'なんてことを…！ 修理班、急いで！' : '線路が外されている！ 修理班を呼びます'); this.master.act(2, 'protest');
    for (const t of this.trains) t.setMood('worried');
    // 本線が使えない：鉄道が分岐Sを迂回線へ。まだ分岐の手前にいる列車は迂回線へ予定を変える
    if (this.track.setSwitch('S', 'BP', 'rail', this.time)) { this.news('鉄道：分岐Sを迂回線に切り替えました（本線は工事中）'); for (const t of this.trains) t.replanAt('A'); }
    if (!this.repairing) this.repair();
  }
  /** 鉄道の修理班：新しいレールを運び、破片を片付け、（ドミノがあれば頼んでからどかして）元に戻す */
  async repair() {
    const ep = this.epoch; this.repairing = { t0: this.time, stage: '出動準備' };
    const crew = this.railcrew;
    await crew[0].wait(9); // 車庫で新しいレールと工具を準備
    while (true) {
      if (ep !== this.epoch) return;
      const broken = Object.values(this.track.segs).flatMap((s) => s.pieces).filter((p) => p.state !== 'ok');
      if (!broken.length) break;
      const p = broken[0];
      this.repairing.stage = '新しいレールを運搬中';
      crew.forEach((c) => { c.busy = true; c.hold('rail'); });
      crew[0].say('修理班、出動！ 線路を守るぞ');
      const along = V(Math.sin(p.yaw), Math.cos(p.yaw)).multiplyScalar(1.6);
      await Promise.all([crew[0].walkTo(p.mid.clone().add(along), 1.2), crew[1].walkTo(p.mid.clone().sub(along), 1.2)]);
      if (ep !== this.epoch) return;
      crew.forEach((c) => c.face(p.mid));
      // 破片の片付け
      const debris = this.track.debris.filter((d) => { const t = d.b.translation(); return Math.hypot(t.x - p.mid.x, t.z - p.mid.z) < 4.5; });
      if (debris.length) { this.repairing.stage = '破片を片付け中'; crew[1].say('まず破片を片付けます'); }
      for (const d of debris) { await crew[1].act(0.9, 'place'); this.track.removeDebris(d); if (ep !== this.epoch) return; }
      if (p.state === 'broken') {
        // 砕けたレールは部品が足りない：ひとりが車庫へ取りに戻る
        this.repairing.stage = '砕けたレールの部品を車庫へ取りに戻っています';
        crew[1].say('部品が足りない…車庫へ取ってきます！', 'warn');
        await crew[1].walkTo(crew[1].home, 1.2); if (ep !== this.epoch) return;
        await crew[1].act(2, 'place');
        await crew[1].walkTo(p.mid.clone().sub(V(Math.sin(p.yaw), Math.cos(p.yaw)).multiplyScalar(1.6)), 1.2); if (ep !== this.epoch) return;
      }
      // レールの上にドミノがある：まずお願いする → 待つ → どかす
      const onGap = () => [...this.dominoes.list].filter((d) => { const t = d.body.translation(); return t.y < 1.5 && Math.hypot(t.x - p.mid.x, t.z - p.mid.z) < p.chord / 2 + 0.3 && this.distToPieceLine(p, t) < BED_HW + 0.15; });
      if (onGap().length) {
        this.repairing.stage = 'ドミノをどけてほしいとお願い中';
        crew[0].say('ここに線路を戻したいんです…ドミノをどけてもらえますか？', 'warn'); crew[0].act(3, 'protest');
        for (let k = 0; k < 14 && onGap().length; k++) { await crew[0].wait(1); if (ep !== this.epoch) return; }
        if (onGap().length) { this.repairing.stage = 'ドミノをどかしています'; crew[0].say('すみません、どかしますね'); for (const d of onGap()) { await crew[0].act(0.6, 'place'); if (ep !== this.epoch) return; this.layAside(d); } }
      }
      this.repairing.stage = 'レールを取り付け中';
      crew.forEach((c) => c.hold(null));
      crew[0].say('トン、トン…'); this.audio.clunk();
      await Promise.all([crew[0].act(4, 'kneel'), crew[1].act(4, 'kneel')]);
      if (ep !== this.epoch) return;
      this.track.restore(p, true);
      this.audio.place();
    }
    this.repairing.stage = '運行再開';
    if (this.track.switches.S.state === 'BP' && this.track.switches.S.setBy === 'rail') this.track.setSwitch('S', 'A', 'rail', this.time);
    crew[0].say('修理完了！ 運行再開です', 'coin');
    this.news(`鉄道：線路の修理が完了（${Math.round(this.time - this.repairing.t0)}秒）。本線の運行を再開`);
    if (this.attempt) this.attempt.repairAt = this.time;
    this.repairing = null;
    await Promise.all(crew.map((c) => c.walkTo(c.home)));
    crew.forEach((c) => (c.busy = false));
  }
  distToPieceLine(p, t) { const dx = t.x - p.mid.x, dz = t.z - p.mid.z; const ax = Math.sin(p.yaw), az = Math.cos(p.yaw); return Math.abs(-dx * az + dz * ax); }

  // ================= 建築（エリート建築士） =================
  footbridgeSite() { return { a: V(-13.75, -6), b: V(-6.25, -6), mid: V(-10, -6) }; }
  async buildFootbridge() {
    if (this.archLv < 1 || this.footbridge || this.planks < 10) return false;
    const ep = this.epoch;
    const mesh = footbridgeMesh(7.5, 2.0); mesh.position.set(-10, 0, -6);
    const parts = []; mesh.traverse((o) => { if (o.isMesh) { parts.push(o); o.visible = false; } });
    this.scene.add(mesh);
    this.footbridge = { mesh, parts, done: false, progress: 0 };
    this.news('エリート建築士：歩道橋の建設を始めます（材木10本）');
    this.architect.say('歩道橋を架けます！ みんな材木を運んで');
    await this.haul(10, (k) => { const n = Math.round((parts.length * k) / 10); parts.forEach((o, i) => (o.visible = i < n)); }, this.footbridgeSite().mid, ep);
    if (ep !== this.epoch) return false;
    parts.forEach((o) => (o.visible = true));
    this.footbridge.done = true;
    this.architect.say('歩道橋、完成！ もう列車を待たずに渡れます', 'coin');
    this.news('エリート建築士：歩道橋が完成。人は列車を待たずに線路を越えられる');
    return true;
  }
  /** 材木を n 回運ぶ（建築士＋建設担当が協力）。1本届くごとに onProgress(k) */
  async haul(n, onProgress, site, ep) {
    let delivered = 0, next = 0;
    const crew = [this.architect, ...this.builders];
    const worker = async (w, i) => {
      while (next < n) {
        if (ep !== this.epoch) return;
        next++; this.planks--;
        await w.walkTo(this.lumber.position.clone().add(V((i - 1) * 0.8, 1.2)));
        w.hold('plank'); await w.act(0.4, 'place');
        await w.walkTo(site.clone().add(V((i - 1) * 0.9, -1.4)));
        if (ep !== this.epoch) return;
        w.face(site); await w.act(1.0, 'place'); w.hold(null);
        delivered++; onProgress(delivered);
        if (w === this.architect && delivered % 4 === 0) { w.hold('blueprint'); await w.act(1.0, 'read'); w.hold(null); }
      }
    };
    await Promise.all(crew.map((w, i) => worker(w, i)));
  }
  async buildStairs() {
    if (this.archLv < 2 || this.stairs || this.planks < STAIRS.parts.length) return false;
    const ep = this.epoch;
    const group = new THREE.Group(); this.scene.add(group);
    const wood = MAT.wood('#e0b07a'), dark = MAT.wood('#b07a48'), deckM = MAT.plastic('#ffd43b');
    const parts = STAIRS.parts.map((p) => {
      let geo, y;
      if (p.kind === 'step') { geo = rbox(p.hx * 2, p.y, 1.2, 0.04); y = p.y / 2; }
      if (p.kind === 'deck') { geo = rbox(p.hx * 2, 0.25, 1.2, 0.04); y = p.y - 0.125; }
      if (p.kind === 'pillar') { geo = rbox(0.3, p.y, 0.9, 0.04); y = p.y / 2; }
      const m = new THREE.Mesh(geo, p.kind === 'deck' ? deckM : p.kind === 'pillar' ? dark : wood);
      m.position.set(p.x, y, 0); m.castShadow = m.receiveShadow = true; m.visible = false;
      group.add(m);
      return { ...p, mesh: m, y0: y, collider: null };
    });
    // 線路の上の床に手すり（見た目）
    this.stairs = { group, parts, done: false };
    this.news(`エリート建築士：ドミノ階段（立体交差）の建設を始めます（材木${parts.length}本）`);
    this.architect.say('線路の上を越えるドミノ階段を建てます！');
    await this.haul(parts.length, (k) => {
      const p = parts[k - 1];
      p.mesh.visible = true; p.mesh.scale.y = 0.05; p.grow = 0;
      // 当たり判定（ドミノが乗る段）
      if (p.kind === 'step') p.collider = this.physics.staticBox(p.x, p.y / 2, 0, p.hx, p.y / 2, 0.6);
      if (p.kind === 'deck') p.collider = this.physics.staticBox(p.x, p.y - 0.125, 0, p.hx, 0.125, 0.6);
      if (p.kind === 'pillar') p.collider = this.physics.staticBox(p.x, p.y / 2, 0, 0.15, p.y / 2, 0.45);
    }, V(-13, 0), ep);
    if (ep !== this.epoch) return false;
    this.stairs.done = true;
    this.architect.say('ドミノ階段、完成！ 列車はこの下をくぐれます', 'coin');
    this.news('エリート建築士：ドミノ階段が完成。列車は下を通り、ドミノは上を越える');
    if (this.attempt) this.attempt.markPrep('階段完成');
    return true;
  }
  removeStairs() { for (const p of this.stairs.parts) this.physics.remove(p.collider); this.scene.remove(this.stairs.group); this.stairs = null; this.stairsGood = 0; }
  removeFootbridge() { this.scene.remove(this.footbridge.mesh); this.footbridge = null; }

  // ================= ドミノ（交差区間）を並べる =================
  /** method：'flat'（線路の上・または外したすき間に直接）/'stairs'（ドミノ階段の上） */
  async buildZone(method) {
    // 同じ方法でもう一度：欠けたマス（鉄道にどかされた等）を埋め直す
    if (this.zone && this.zone.method === method && !this.zone.working) return this.fillZone();
    if (this.zone) return false;
    if (method === 'stairs' && !(this.stairs && this.stairs.done)) return false;
    const ep = this.epoch;
    const slots = method === 'stairs' ? STAIRS.slots.map((s) => ({ ...s })) : flatZoneSlots(this.track);
    this.zone = { method, slots, done: false };
    this.zoneSlots = slots;
    this.news(method === 'stairs' ? 'ドミノ建設隊：ドミノ階段にドミノを並べます' : 'ドミノ建設隊：交差区間にドミノを並べます');
    return this.fillZone();
  }
  async fillZone() {
    const ep = this.epoch, slots = this.zone.slots;
    this.zone.working = true; this.zone.done = false;
    const worker = async (w) => {
      while (true) {
        if (ep !== this.epoch) return;
        // 空いたマスと、連鎖の前に倒れてしまったドミノ（外側のコースも）
        const fallen = this.chain ? [] : this.slots.filter((s) => s.domino && s.domino.toppled && !s.claim);
        const todo = [...fallen, ...slots.filter((s) => (!s.domino || (!this.chain && s.domino.toppled)) && !s.claim)];
        if (!todo.length) return;
        // 線路の上（路盤・外したすき間）は、交差地点を空けたとき（撤去・迂回・信号）だけ。列車が近いときも置かない
        const placeable = (s) => !(this.onRails(s) && (!this.crossingOpen() || this.movingTrainNear(V(s.x, s.z), 7)));
        // 交差地点が空いている間（いつか閉じる）は、線路の上を先に
        const railFirst = this.crossingOpen() ? -1 : 1;
        const cand = todo.filter(placeable).sort((a, b) => ((this.onRails(a) ? 1 : 0) - (this.onRails(b) ? 1 : 0)) * railFirst);
        const ok = cand[0];
        if (!ok) { if (!w._railSaid || this.time - w._railSaid > 12) { w._railSaid = this.time; w.say(this.crossingOpen() ? '列車が通りすぎるのを待とう' : '線路の上は、交差地点を空けないと置けません'); } await w.wait(0.5); continue; }
        const batch = [ok]; for (const s of cand) { if (batch.length >= 4) break; if (s !== ok && Math.abs(s.x - ok.x) < 2.5 && !!s.domino === !!ok.domino) batch.push(s); }
        batch.forEach((s) => (s.claim = w));
        if (ok.domino) {
          // 倒れたドミノの立て直し（資材は使わない）
          for (const s of batch) {
            await w.walkTo(V(s.x, -1.0)); if (ep !== this.epoch) return;
            w.face(V(s.x, 0)); await w.act(0.7, 'place'); if (ep !== this.epoch) return;
            if (s.domino && s.domino.toppled && !this.chain) { this.dominoes.remove(s.domino); s.domino = this.dominoes.create({ x: s.x, y: s.flat ? this.track.bedHeightAt(s.x, 0) : s.y, z: 0, yaw: PI / 2 }, { slot: s }); }
            s.claim = null;
          }
          continue;
        }
        await w.walkTo(this.crate.pos.clone().add(V(1.6, -0.6)));
        if (this.crate.count < batch.length) { w.say('資材箱が空…'); batch.forEach((s) => (s.claim = null)); await w.wait(2); continue; }
        this.crate.count -= batch.length; w.hold('domino');
        if (this.attempt) this.attempt.dominoes += batch.length;
        for (const s of batch) {
          await w.walkTo(V(s.x, -1.0));
          if (ep !== this.epoch) return;
          // 破片が落ちていたら片付けてから
          const deb = this.track.debris.find((d) => { const t = d.b.translation(); return Math.hypot(t.x - s.x, t.z - s.z) < 0.7; });
          if (deb) { w.say('破片を片付けて…'); await w.act(0.6, 'place'); this.track.removeDebris(deb); }
          w.face(V(s.x, 0)); await w.act(0.45, 'place');
          if (ep !== this.epoch) return;
          const y = s.flat ? this.track.bedHeightAt(s.x, 0) : s.y;
          s.domino = this.dominoes.create({ x: s.x, y, z: 0, yaw: PI / 2 }, { slot: s });
          s.claim = null; this.audio.place();
        }
        w.hold(null);
      }
    };
    await Promise.all(this.builders.map(worker));
    if (ep !== this.epoch) return false;
    this.zone.working = false;
    this.zone.done = true;
    if (this.attempt) this.attempt.markPrep('並べ終わり', true);
    this.news('ドミノ建設隊：交差区間が並びました。「▶ 倒す」で連鎖！');
    return true;
  }

  /** その場所が線路の上（ドミノ階段の上は除く） */
  onRails(s) { return s.y < 1.5 && this.track.onTrack(s.x, s.z, 0.35); }
  /** 交差地点が空いているか：レールが無い・迂回線に切り替え中・駅Aの信号が赤 */
  crossingOpen() { return this.crossingPiece().state !== 'ok' || this.track.switches.S.state === 'BP' || this.signalRed; }

  /** 連鎖の前に倒れてしまったコースのドミノを、建設担当が立て直す（並べる作業と同じ係がまとめて行う） */
  restandFallen() {
    if (this.chain || !this.zone) return;
    const n = this.allSlots().filter((s) => s.domino && s.domino.toppled).length;
    if (n) { this.builders[0].say(`${n}枚倒れてしまった…立て直します`, 'warn'); if (this.attempt) this.attempt.restood = (this.attempt.restood || 0) + n; }
    this.zone.done = false;
    if (!this.zone.working) this.fillZone();
  }
  /** 連鎖のあと、線路の上に倒れたドミノを建設担当が片付ける（資材箱に戻す） */
  async cleanupRails() {
    if (this.cleaning) return;
    if (this.zone && this.zone.working) { this.news('（並べている途中なので、片付けはあとで）'); return; }
    const ep = this.epoch; this.cleaning = true;
    const onRail = () => [...this.dominoes.list].filter((d) => { const t = d.body.translation(); return t.y < 1.5 && this.track.onTrack(t.x, t.z, 0.25) && !d.claimC; });
    const n0 = onRail().length;
    this.news(n0 ? `ドミノ建設隊：線路の上のドミノ${n0}枚を片付けます` : 'ドミノ建設隊：線路の上は片付いています');
    if (this.attempt) this.attempt.markPrep('片付け開始');
    const worker = async (w) => {
      while (true) {
        if (ep !== this.epoch) return;
        const d = onRail()[0]; if (!d) return;
        d.claimC = true;
        const t = d.body.translation();
        await w.walkTo(V(t.x, t.z - 1.1));
        if (ep !== this.epoch) return;
        await w.act(0.5, 'place');
        if (d.removed) continue;
        if (d.slot) d.slot.domino = null;
        this.dominoes.remove(d); this.crate.count++;
      }
    };
    await Promise.all(this.builders.map(worker));
    if (ep === this.epoch && n0) { this.builders[0].say('線路の上、片付け完了！', 'coin'); this.news('ドミノ建設隊：線路の上の片付けが完了'); if (this.attempt) this.attempt.markPrep('片付け完了'); }
    this.cleaning = false;
  }

  // ================= 連鎖 =================
  allSlots() { return [...this.slots, ...this.zoneSlots]; }
  startChain() {
    if (this.chain) return false;
    const first = this.slots[0].domino;
    if (!first) return false;
    this.chain = { t0: this.time, last: this.time, toppled: new Set(), done: false };
    this.dominoes.onTopple = (d) => { if (this.chain && !this.chain.done) { this.chain.toppled.add(d); this.chain.last = this.time; this.chain.front = d; } };
    this.dominoes.push(first, 1, 0, 0.06);
    this.audio.start && this.audio.start();
    return true;
  }
  updateChain() {
    const c = this.chain;
    if (!c || c.done) return;
    const slots = this.allSlots();
    const goal = slots[slots.length - 1];
    // ゴールは交差区間を並べ終えたコースの最後（交差区間がないとゴールに届かない）
    const goalHit = !!(this.zone && this.zone.done && goal && goal.domino && goal.domino.toppled);
    if (goalHit && !c.rang) { c.rang = true; this.audio.bell(); this.fx.confetti(V(GOAL_X, 0, 0).setY(1), 60, 6); this.fx.floatAt(V(GOAL_X, 0, 0).setY(2.6), '🔔 ゴール！', 'big', 2); }
    if (this.time - c.last > 3) {
      c.done = true;
      const n = slots.filter((s) => s.domino && s.domino.toppled).length;
      c.result = { ok: !!goalHit, n, total: slots.length };
      if (goalHit) this.audio.grandClear && this.audio.grandClear(); else this.audio.success && this.audio.success();
      if (this.attempt) this.attempt.finish(c.result);
      this.news(goalHit ? `連鎖成功！ ${n}/${slots.length}枚でゴールのベルが鳴った` : `連鎖は${n}/${slots.length}枚で止まった`);
    }
  }

  // ================= 交通整理 =================
  setSwitchByPlayer(state) {
    const sw = this.track.switches.S;
    if (this.trains.some((t) => t.pointAt(t.s, new THREE.Vector3()).distanceTo(sw.pos) < 6)) { this.fx.floatAt(sw.pos.clone().setY(2.5), '列車が近いので切り替えられません', 'warn', 1.5); return false; }
    if (state === 'A' && this.track.segs.A.pieces.some((p) => p.state !== 'ok')) { this.fx.floatAt(sw.pos.clone().setY(2.5), '本線は工事中です', 'warn', 1.5); return false; }
    if (state === 'BP' && !this.askDetour()) return false;
    this.track.setSwitch('S', state, 'player', this.time);
    if (this.attempt && state === 'BP') this.attempt.markPrep('ポイント切替');
    this.news(state === 'BP' ? 'ドミノ建設隊：ポイントSを迂回線に切り替え（駅Aは通過になる）' : 'ドミノ建設隊：ポイントSを本線に戻した');
    this.master.say(state === 'BP' ? '迂回線…？ 駅Aのお客さんが乗れませんよ！' : 'ありがとう、本線に戻りますね');
    if (state === 'BP') this.master.act(2, 'protest');
    return true;
  }
  /**
   * 交通整理のお願い（迂回・信号）：鉄道は協力してくれるが、回数を重ねるほど待てる時間が短くなり、不満も大きくなる。
   * 3回目のあとはしばらく断られる（そのときは建築や撤去で解決するしかない）
   */
  askDetour() {
    if (this.time < (this.refuseUntil || 0)) {
      this.master.say(`今日はもう運行を変えられません！（あと${Math.ceil(this.refuseUntil - this.time)}秒）`, 'warn'); this.master.act(2, 'protest');
      this.news('駅長：交通整理のお願いを断りました（続けて頼みすぎ）');
      return false;
    }
    this.trafficUses = (this.trafficUses || 0) + 1;
    this.trafficWindow = Math.max(20, 50 - 12 * (this.trafficUses - 1));
    if (this.trafficUses >= 3) { this.refuseUntil = this.time + 150; this.trafficUses = 0; this.news('駅長：「これで最後ですよ。しばらくは時刻表どおりに走らせます」'); }
    return true;
  }
  setSignal(red) {
    if (red && !this.askDetour()) return false;
    this.signalRed = red; this.holdT = 0; this.holdSaid = false;
    if (red && this.attempt) this.attempt.markPrep('信号');
    this.news(red ? 'ドミノ建設隊：駅Aの信号を赤に（列車は駅Aで待機）' : 'ドミノ建設隊：駅Aの信号を青に戻した');
    this.master.say(red ? 'しばらく待ちますが、時刻表がありますからね…' : '発車します！');
  }

  // ================= 問い合わせ（列車・人から） =================
  /** シミュレーション時間で進むアニメーション（終わると resolve） */
  tween(dur, fn) { return new Promise((res) => (this.tweens ||= []).push({ t: 0, dur, fn, res })); }
  movingTrainNear(p, r) { return this.trains.some((t) => Math.abs(t.v) > 0.1 && t.carPositions().some((q) => q.distanceToSquared(p) < r * r)); }
  trainNear(p, r) { return this.trains.some((t) => t.carPositions().some((q) => q.distanceToSquared(p) < r * r)); }
  dominoOnTrack(p, r) {
    for (const d of this.dominoes.near(p.x, p.z)) { const t = d.body.translation(); if (t.y < 1.5 && (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < r * r) return d; }
    return null;
  }
  personOnTrack(p, r) { return this.people.some((q) => q.pos.y < 0.5 && (q.pos.x - p.x) ** 2 + (q.pos.z - p.z) ** 2 < r * r); }
  hammerOnTrack(p, r) { return !!this.hammer && this.hammer.position.y < 1 && (this.hammer.position.x - p.x) ** 2 + (this.hammer.position.z - p.z) ** 2 < r * r; }
  debrisNear(p, r) { return this.track.debris.some((d) => { const t = d.b.translation(); return t.y < 1 && (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < r * r; }); }
  groundHeight(x, z) {
    const fb = this.footbridge;
    if (fb && fb.done && Math.abs(z + 6) < 0.7 && x > -13.75 && x < -6.25) return Math.sin(((x + 13.75) / 7.5) * PI) * 2.0;
    return this.track.onTrack(x, z) ? BED_H : 0;
  }
  /** 人の道順：西の線路（駅Aの直線）をまたぐときは横断歩道か歩道橋を通る（鉄道の人はそのまま） */
  routeFor(person, target) {
    const side = (p) => (p.x < -10 ? -1 : 1);
    const crossesWest = (a, b) => side(a) !== side(b) && Math.max(a.z, b.z) > -9 && Math.min(a.z, b.z) < 9;
    if (person.role === 'railcrew' || person.role === 'stationmaster' || !crossesWest(person.pos, target)) return [target];
    const fb = this.footbridge && this.footbridge.done;
    const L = side(person.pos) < 0;
    const entry = fb ? V(L ? -13.9 : -6.1, -6) : V(L ? -11.6 : -8.4, -6);
    const exit = fb ? V(L ? -6.1 : -13.9, -6) : V(L ? -8.4 : -11.6, -6);
    return [{ isCrossing: true, entry, exit, mid: V(-10, -6), bridge: fb }, target];
  }

  // ================= 毎フレーム =================
  update(dt) {
    this.time += dt;
    for (const tw of [...(this.tweens || [])]) { tw.t += dt; const k = Math.min(1, tw.t / tw.dur); tw.fn(k); if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.res(); } }
    this.physics.update(dt);
    this.dominoes.update(dt);
    this.track.update();
    for (const t of this.trains) t.update(dt);
    for (const p of this.people) p.update(dt);
    // 外したレールを運んでいる
    if (this.carried) { const [a, b] = this.carried.carriers; const m = this.carried.mesh; m.position.set((a.pos.x + b.pos.x) / 2, 0.75, (a.pos.z + b.pos.z) / 2); m.rotation.set(0.15, Math.atan2(b.pos.x - a.pos.x, b.pos.z - a.pos.z) + PI / 2, 0.1); }
    // 階段が下から伸びて組み上がる
    if (this.stairs) for (const p of this.stairs.parts) if (p.mesh.visible && p.mesh.scale.y < 1) { p.grow = Math.min(1, (p.grow || 0) + dt * 2.5); p.mesh.scale.y = Math.max(0.05, p.grow); p.mesh.position.y = p.kind === 'deck' ? p.y0 : p.y0 * p.mesh.scale.y; }
    // 駅Aのお客さん（迂回線のあいだは増えていく）
    this.paxT += dt;
    if (this.paxT > 5) { this.paxT = 0; this.paxA = Math.min(14, this.paxA + 1); if (this.paxA === 10) { this.master.say('駅Aにお客さんがたくさん待っています！'); this.master.act(2, 'protest'); this.rel(-2); } }
    this.paxMeshes.forEach((m, i) => { m.visible = i < this.paxA; m.position.y = this.paxA > 9 ? Math.abs(Math.sin(this.time * 6 + i)) * 0.08 : 0; });
    if (this.attempt) this.attempt.paxMax = Math.max(this.attempt.paxMax, this.paxA);
    // プレイヤーが切り替えた迂回線は、しばらくすると鉄道が本線に戻す（駅Aのお客さんのため）
    const S = this.track.switches.S;
    if (S.state === 'BP' && S.setBy === 'player' && this.time - S.changedAt > (this.trafficWindow || 50) && this.track.segs.A.pieces.every((p) => p.state === 'ok')) {
      if (!this.trains.some((t) => t.pointAt(t.s, new THREE.Vector3()).distanceTo(S.pos) < 6)) {
        this.track.setSwitch('S', 'A', 'rail', this.time); this.rel(-3 - 2 * (this.trafficUses || 0), '駅Aを通過させた');
        this.master.say('時刻表を守るため、本線に戻します！', 'warn'); this.news(`鉄道：分岐Sを本線に戻しました（今回の迂回は${this.trafficWindow || 50}秒まで）`);
      }
    }
    // 信号の見た目
    this.sigRed.material.emissiveIntensity = this.signalRed ? 1.4 : 0.05; this.sigGreen.material.emissiveIntensity = this.signalRed ? 0.05 : 1.2;
    // 資材箱の中身
    this.crate.mesh.userData.minis.forEach((m, i) => (m.visible = i < Math.ceil(this.crate.count / 6)));
    this.lumber.children.forEach((m, i) => (m.visible = i < Math.min(20, this.planks / 2)));
    // 列車の表情（友好度が低いと不機嫌）
    if (this.relation < 30) for (const t of this.trains) if (t.state === 'run' || t.state === 'dwell') t.setMood('angry');
    this.updateChain();
    if (this.bellCup && this.chain && this.chain.rang) this.bellCup.rotation.x = Math.sin(this.time * 14) * 0.5 * Math.max(0, 1 - (this.time - this.chain.last));
  }
}
