import * as THREE from 'three';
import { ToyBranch, trainCar, BED_HW } from '../world/toyrail.js';
import { MAT, rbox, shadow } from '../world/props.js';

/**
 * ぽっぽ線の路線計画（Ver.0.6）
 * 鉄道の側にも「この駅まで線路をつなげたい」という目的がある。保線主任が計画を調べ、保線係が工事用トロッコから
 * 青いレールを1本ずつ運んで敷いていく。ドミノのコースとぶつかる所で、ドミノ建設隊と押し引きになる。
 *   ・廊下線（dominoFirst）：同じ場所を工事しようとしてけんか → 設計主任が撤去班を呼び、ドミノを優先 → ぽっぽ線は手前に駅を作って迂回
 *   ・手前線（bridge・複線）：大きな交差。エリート建築士 Lv.2 なら立体交差（階段）→ 下を線路が通って奥の駅まで開業。
 *     まだ作れなければ、線路はコースの手前で終点（短く開業）
 * 計画は決まった数だけ（無限に延ばして邪魔し続けることはない）。どちらも最後は開業し、支線を小さな列車が往復する。
 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const LAY_TIME = 1.1; // 1本を敷く時間（しゃがんではめる）

function signTexture(lines, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 512, 200); x.fillStyle = color; x.fillRect(0, 0, 512, 30);
  x.fillStyle = '#212529'; x.textAlign = 'center';
  x.font = 'bold 56px "M PLUS Rounded 1c", sans-serif'; x.fillText(lines[0], 256, 96);
  x.font = 'bold 36px "M PLUS Rounded 1c", sans-serif'; x.fillText(lines[1] || '', 256, 160);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** 支線を往復する小さな列車 */
class Shuttle {
  constructor(plan, line, endS) {
    this.plan = plan; this.line = line; this.game = plan.game;
    this.name = plan.def.train || '支線ぽっぽ';
    this.n = 2; this.gap = 2.85;
    this.s = 1.5 + this.gap * (this.n - 1); this.dir = 1; this.v = 0; this.endS = endS; this.wait = 2; this.state = 'dwell';
    this.cars = []; for (let i = 0; i < this.n; i++) { const m = trainCar('local', i, this.n); this.game.scene.add(m); this.cars.push(m); }
    this.pos = this.cars[0].position;
    this.place();
  }
  positions() { return this.cars.map((m) => m.position); }
  carS(i) { return this.dir > 0 ? this.s - i * this.gap : this.s + i * this.gap; }
  place() {
    for (let i = 0; i < this.n; i++) {
      const s = Math.max(0.2, Math.min(this.endS, this.carS(i)));
      const p = this.line.pointAt(s), q = this.line.pointAt(Math.min(this.line.len, s + 0.3));
      const yaw = Math.atan2(q.x - p.x, q.z - p.z) + (this.dir > 0 ? 0 : Math.PI);
      this.cars[i].position.set(p.x, 0.16, p.z); this.cars[i].rotation.set(0, yaw, 0);
    }
  }
  /** 前の線路が切れている・ドミノや人が線路の上にいる */
  blocked() {
    const g = this.game, ahead = this.s + this.dir * 2.2;
    if (ahead < 0 || ahead > this.endS + 0.1) return false;
    const pc = this.line.pieceAt(ahead); if (!pc || pc.state !== 'ok') return 'gap';
    const p = this.line.pointAt(ahead);
    for (const d of g.dominoes.near(p.x, p.z)) { const t = d.body.translation(); if (t.y < 1.6 && (t.x - p.x) ** 2 + (t.z - p.z) ** 2 < 1.0) return 'domino'; }
    for (const w of g.workers.list) if (w.pos.y < 0.5 && (w.pos.x - p.x) ** 2 + (w.pos.z - p.z) ** 2 < 0.8) return 'person';
    return false;
  }
  update(dt) {
    if (this.state === 'dwell') {
      this.v = 0; this.wait -= dt;
      if (this.wait <= 0) { this.state = 'run'; if (Math.random() < 0.5) this.plan.say(this.dir > 0 ? `${this.plan.def.goal}行き、発車〜！` : '本線のりかえ口行き、発車〜！'); }
    } else {
      const b = this.blocked();
      const target = b ? 0 : 2.6;
      this.v += Math.sign(target - this.v) * Math.min(Math.abs(target - this.v), 4 * dt);
      if (b && !this.saidBlock) { this.saidBlock = true; this.plan.say(b === 'domino' ? '線路の上にドミノが…止まります' : b === 'person' ? 'あぶないですよ〜' : '線路が切れてる！', 'warn'); }
      if (!b) this.saidBlock = false;
      this.s += this.v * this.dir * dt;
      const lo = 1.5 + this.gap * (this.n - 1);
      if (this.dir > 0 && this.s >= this.endS) { this.s = this.endS; this.dir = -1; this.state = 'dwell'; this.wait = 3.5; this.s = this.endS - this.gap * (this.n - 1); }
      else if (this.dir < 0 && this.s <= 1.5) { this.s = lo; this.dir = 1; this.state = 'dwell'; this.wait = 3.5; }
    }
    this.place();
  }
  dispose() { this.cars.forEach((m) => this.game.scene.remove(m)); }
}

class Plan {
  constructor(mgr, def) {
    this.mgr = mgr; this.game = mgr.game; this.def = def;
    this.mode = def.mode; // 'dominoFirst' | 'bridge'
    this.lines = def.lines.map((pts, i) => new ToyBranch(this.game, pts, { name: `${def.name}${i ? '（2番線）' : ''}` }));
    this.state = 'idle'; this.laid = this.lines.map(() => 0); this.endK = this.lines.map((l) => l.pieces.length); this.site = null; this.shuttle = null;
    this.events = [];
    // コースとぶつかる部品（計画線の上にマスがある）
    const slots = this.game.course.segments[0] ? this.game.course.segments[0].slots : [];
    this.crossK = this.lines.map((ln) => { let k = -1; ln.pieces.forEach((p, i) => { if (k < 0 && slots.some((s) => Math.hypot(s.x - p.mid.x, s.z - p.mid.z) < BED_HW + 0.45 + p.chord / 2)) k = i; }); return k; });
    this.crossSlot = (() => { const k = this.crossK[0]; if (k < 0) return -1; const p = this.lines[0].pieces[k]; let best = -1, bd = 1e9; slots.forEach((s, i) => { const d = Math.hypot(s.x - p.mid.x, s.z - p.mid.z); if (d < bd) { bd = d; best = i; } }); return best; })();
    // 予定線（床の青い点線）と、終点の看板
    this.dash = new THREE.Group(); this.game.scene.add(this.dash);
    for (const ln of this.lines) for (const p of ln.pieces) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.9), new THREE.MeshBasicMaterial({ color: '#4dabf7', transparent: true, opacity: 0.75 })); m.position.set(p.mid.x, 0.03, p.mid.z); m.rotation.y = p.yaw; m.userData.p = p; this.dash.add(m); }
    const end = this.lines[0].pointAt(this.lines[0].len);
    this.sign = this.makeSign(end, def.goal);
    this.trolley = this.makeTrolley(); this.trolleyS = 0.8;
    this.dash.visible = false; this.sign.visible = false; this.trolley.visible = false;
  }
  say(text, cls = '') { const t = this.shuttle && this.shuttle.cars[0]; if (t) this.game.fx.floatObj(t, `${this.shuttle.name}「${text}」`, cls, 2.2, 0.4); }
  makeSign(p, goal) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), MAT.metal()); post.position.y = 1.3; g.add(post);
    this.signTex = signTexture([goal, '線路を敷いています'], '#1c7ed6');
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.25), new THREE.MeshStandardMaterial({ map: this.signTex, roughness: 0.7 })); board.position.y = 2.9; g.add(board);
    const back = board.clone(); back.rotation.y = Math.PI; back.position.z = -0.01; g.add(back);
    g.position.set(p.x + 1.6, 0, p.z + 1.6);
    shadow(g); this.game.scene.add(g); return g;
  }
  drawSign(sub) {
    const img = signTexture([this.def.goal, sub], this.state === 'open' ? '#2f9e44' : '#1c7ed6').image;
    this.signTex.image = img; this.signTex.needsUpdate = true;
  }
  /** 工事用トロッコ（予備の青いレールを積んで、敷いた線路の先までついていく） */
  makeTrolley() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(rbox(0.9, 0.3, 1.6, 0.08), MAT.plastic('#fab005')).translateY(0.35));
    for (let i = 0; i < 4; i++) g.add(new THREE.Mesh(rbox(0.7, 0.07, 1.4, 0.03), MAT.plastic('#1c7ed6')).translateY(0.55 + i * 0.08));
    for (const sx of [-0.35, 0.35]) for (const sz of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10), MAT.plastic('#212529')); w.rotation.z = Math.PI / 2; w.position.set(sx, 0.18, sz); g.add(w); }
    shadow(g); this.game.scene.add(g); return g;
  }
  placeTrolley() {
    const ln = this.lines[0], p = ln.pointAt(Math.max(0.8, this.trolleyS)), q = ln.pointAt(Math.max(0.8, this.trolleyS) + 0.3);
    this.trolley.position.set(p.x, 0.16, p.z); this.trolley.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
  }
  /** 敷いた本数（全部の線） */
  laidCount() { return this.laid.reduce((a, b) => a + b, 0); }
  totalCount() { return this.endK.reduce((a, b) => a + b, 0); }
  /** 次に敷く部品：{line, k}（なければ null）。ぶつかる所の手前で止まる（決着がつくまで） */
  nextPiece() {
    let best = null;
    this.lines.forEach((ln, li) => {
      const k = this.laid[li]; if (k >= this.endK[li]) return;
      if (this.crossK[li] >= 0 && k >= this.crossK[li] - 1 && !this.crossOk) return; // 交差の手前（1本前）で待つ
      if (!best || k < this.laid[best.li]) best = { ln, li, k };
    });
    return best;
  }
  /** コースのマスに、もうドミノが立っている（交差の所） */
  dominoAtCross() {
    if (this.crossSlot < 0) return false;
    const sl = this.game.course.segments[0].slots;
    for (let i = Math.max(0, this.crossSlot - 3); i <= Math.min(sl.length - 1, this.crossSlot + 3); i++) if (sl[i].domino) return true;
    return false;
  }
  start() {
    this.state = 'survey'; this.dash.visible = true; this.sign.visible = true; this.trolley.visible = true; this.placeTrolley();
    this.drawSign(`線路 0/${this.totalCount()}本`);
    const g = this.game;
    g.stats.railPlans = (g.stats.railPlans || 0) + 1;
    if (this.mode === 'bridge' && this.crossSlot >= 0 && !this.site) this.site = g.crossings.addBranchSite(this, this.lines[0], this.crossSlot);
  }
  /** 交差に着いた：コースより先に敷けるか、もめるか */
  reachCross() {
    const g = this.game;
    if (this.mode === 'dominoFirst') {
      if (this.dominoAtCross()) { this.state = 'quarrel'; this.quarrelT = 0; return; }
      // まだドミノが来ていない：コースの上を横切って先へ。あとでドミノが来たら、交差地点で決着
      this.crossOk = true;
      if (!this.site) this.site = g.crossings.addBranchSite(this, this.lines[0], this.crossSlot);
      this.mgr.chiefSay(this, 'ドミノの線はまだ空いてる。先に通らせてもらうよ！');
    } else {
      // 手前線：交差地点の決着（階段ができる／ゆずる）を待つ
      if (!this.site) this.site = g.crossings.addBranchSite(this, this.lines[0], this.crossSlot);
      this.state = 'waitCross';
    }
  }
  /** 設計主任の決定を受ける */
  onChiefDecision(site, what) {
    const L = this.game.campLife;
    if (what === 'stairs') { this.mgr.chiefSay(this, 'えっ、階段で上を越えてくれるのかい？ それなら下を通れる！', 'coin', 1.2); this.waitStairs = true; }
    if (what === 'yield') { this.mgr.chiefSay(this, 'そうか…ここで終点にしよう。駅は手前に作る', 'warn', 1.2); this.shorten(); }
    if (what === 'remove') {
      this.mgr.chiefSay(this, 'そんな！ せっかく敷いたのに…', 'warn', 1.0);
      this.mgr.crewSay(this, 'ひどいよ〜！', 1.8);
    }
    if (L) L.after(0.1, () => {});
  }
  /** 交差のレールが外された：迂回（コースの手前に駅を作り、その先は片付ける） */
  onCut() {
    this.mgr.chiefSay(this, 'しかたない、迂回だ！ 駅はドミノの手前に作り直そう', 'warn', 1.5);
    this.shorten();
  }
  shorten() {
    this.short = true;
    this.lines.forEach((ln, li) => { const end = Math.max(2, this.crossK[li] - 2); this.endK[li] = end; this.clearFrom = this.clearFrom || []; this.clearFrom[li] = end; });
    this.state = this.laidCount() > this.totalCount() ? 'dismantle' : 'laying';
    this.crossOk = false;
    for (const m of this.dash.children) { const p = m.userData.p; const li = this.lines.findIndex((ln) => ln.pieces.includes(p)); if (ln_index(this.lines[li], p) >= this.endK[li]) m.visible = false; }
    const ln0 = this.lines[0], endS = ln0.pieces[this.endK[0] - 1].s1;
    const p = ln0.pointAt(endS); this.sign.position.set(p.x + 1.6, 0, p.z + 1.6);
    this.def.goal = this.def.shortGoal || this.def.goal;
  }
  /** 終点の駅を建てて開業 */
  open() {
    const g = this.game, ln = this.lines[0];
    this.state = 'open';
    const endS = ln.pieces[this.endK[0] - 1].s1;
    const p = ln.pointAt(endS), q = ln.pointAt(endS - 1);
    const st = new THREE.Group();
    st.add(new THREE.Mesh(rbox(1.6, 0.45, 5, 0.06), MAT.plastic('#f8f9fa')).translateY(0.22).translateX(1.4));
    st.add(new THREE.Mesh(rbox(1.8, 0.12, 5.4, 0.04), MAT.plastic('#1c7ed6')).translateY(2.2).translateX(1.4));
    for (const z of [-2, 2]) st.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.8, 8), MAT.plastic('#fcc419')).translateY(1.3).translateX(2).translateZ(z));
    const stop = new THREE.Mesh(rbox(1.2, 0.5, 0.3, 0.08), MAT.plastic('#e03131')); stop.position.set(0, 0.25, 0.9); st.add(stop);
    st.position.set(p.x, 0, p.z); st.rotation.y = Math.atan2(p.x - q.x, p.z - q.z) - Math.PI;
    shadow(st); g.scene.add(st); this.station = st;
    this.drawSign(this.short ? '開業！（手前に駅を作りました）' : '開業！ 線路がつながった');
    this.trolley.visible = false; this.dash.visible = false;
    this.shuttle = new Shuttle(this, ln, endS - 0.5);
    (g.railway.extraTrains ||= []).push(this.shuttle);
    this.mgr.chiefSay(this, this.short ? `${this.def.goal}、開業です！ ドミノさんとも仲良くね` : `${this.def.goal}まで、線路がつながった！ 開業です！`, 'coin', 0.5);
    g.audio.toot && g.audio.toot();
    g.stats.railOpened = (g.stats.railOpened || 0) + 1;
  }
  update(dt) {
    if (this.shuttle) this.shuttle.update(dt);
    // 立体交差（階段）ができたら、下を通して先へ
    if (this.waitStairs && this.site && this.site.state === 'open') { this.waitStairs = false; this.crossOk = true; this.state = 'laying'; this.mgr.chiefSay(this, '階段の下を通るぞ！ 工事再開！', 'coin', 0.3); }
    // 手前線：交差を待っている間にドミノ側が「ゆずって」と言ったら（yield）→ shorten 済み
    if (this.state === 'laying' && !this.nextPiece() && this.laidCount() >= this.totalCount()) this.open();
    if (this.state === 'laying' && !this.nextPiece() && this.laidCount() < this.totalCount()) {
      // 交差の1本前まで来た
      if (!this.crossOk && this.crossK[0] >= 0) this.reachCross();
    }
    if (this.state === 'quarrel') this.mgr.updateQuarrel(this, dt);
    // 敷いた線路の先までトロッコがついていく
    if (this.trolley.visible) {
      const ln = this.lines[0], k = Math.max(0, this.laid[0] - 2);
      const want = k > 0 ? ln.pieces[k - 1].s1 - 1 : 0.8;
      this.trolleyS += Math.sign(want - this.trolleyS) * Math.min(Math.abs(want - this.trolleyS), 2.5 * dt);
      this.placeTrolley();
    }
  }
  /** 1本敷いた */
  laidOne(li) {
    const ln = this.lines[li], p = ln.pieces[this.laid[li]];
    ln.lay(p); this.laid[li]++;
    for (const m of this.dash.children) if (m.userData.p === p) m.visible = false;
    this.drawSign(`線路 ${this.laidCount()}/${this.totalCount()}本`);
    this.game.audio.clunk && this.game.audio.clunk();
  }
  serialize() { return { id: this.def.id, state: this.state, laid: this.laid, short: !!this.short, crossOk: !!this.crossOk, site: this.site ? { state: this.site.state === 'open' ? 'open' : 'wait', plan: this.site.state === 'open' ? this.site.plan : null } : null }; }
  dispose() {
    for (const ln of this.lines) ln.dispose();
    const sc = this.game.scene; sc.remove(this.dash); sc.remove(this.sign); sc.remove(this.trolley); if (this.station) sc.remove(this.station);
    if (this.shuttle) this.shuttle.dispose();
  }
}
const ln_index = (ln, p) => ln.pieces.indexOf(p);

export class RailPlans {
  constructor(game, railway, defs) {
    this.game = game; this.railway = railway;
    this.plans = (defs || []).map((d) => new Plan(this, d));
  }
  /** 保線主任・保線係のせりふ（返事つき） */
  chiefSay(plan, text, cls = '', delay = 0) {
    const g = this.game, c = g.workers.list.find((w) => w.role === 'railchief');
    const go = () => { if (c) c.say(text, cls); else plan.say(text, cls); };
    if (delay && g.campLife) g.campLife.after(delay, go); else go();
  }
  crewSay(plan, text, delay = 0) {
    const g = this.game, c = g.workers.list.find((w) => w.role === 'railcrew');
    if (!c) return;
    if (delay && g.campLife) g.campLife.after(delay, () => c.say(text, 'warn')); else c.say(text, 'warn');
  }
  active() { return this.plans.find((p) => ['survey', 'laying', 'quarrel', 'waitCross', 'dismantle'].includes(p.state)); }
  update(dt) {
    const g = this.game;
    if (g.mode === 'build') {
      // 計画の開始：ドミノの建設がある所まで進んだら（ひとつずつ）
      const head = g.buildHead ? g.buildHead() : null, order = head ? head.order : 0;
      if (!this.active()) { const nx = this.plans.find((p) => p.state === 'idle' && order >= p.def.startOrder); if (nx) nx.start(); }
    }
    for (const p of this.plans) p.update(dt);
  }
  /** けんか：保線係と建設担当が交差の所で言い合い → 設計主任が来て決める（交差地点を作って、いつもの流れへ） */
  updateQuarrel(plan, dt) {
    const g = this.game;
    plan.quarrelT += dt;
    if (!plan.quarrelStarted) {
      plan.quarrelStarted = true;
      const sl = g.course.segments[0].slots[plan.crossSlot];
      const at = V(sl.x, 0, sl.z);
      const crew = g.workers.list.filter((w) => w.role === 'railcrew' && !w.atSite).slice(0, 2);
      const b = g.workers.list.filter((w) => w.role === 'builder').sort((a, c) => a.pos.distanceToSquared(at) - c.pos.distanceToSquared(at)).slice(0, 2);
      [...crew, ...b].forEach((w, i) => {
        w.releaseJob && w.releaseJob();
        const p = at.clone().add(V((i % 2 ? 1 : -1) * 1.3, 0, (i < 2 ? -1 : 1) * 1.6));
        w.goto(() => p, () => { w.face2(at); w.act(3.0, 'squabble', () => w.think()); }, 1.3);
      });
      if (crew[0]) crew[0].say('ここはぽっぽ線の線路を通すんだ！', 'warn');
      if (b[0]) g.campLife.after(1.0, () => b[0].say('ドミノが先に並べてるんだよ！', 'warn'));
      g.stats.railQuarrels = (g.stats.railQuarrels || 0) + 1;
    }
    // 設計主任が来て決める：ドミノ優先。ぽっぽ線は手前に駅を作る
    if (plan.quarrelT > 3.5 && !plan.quarrelDone) {
      plan.quarrelDone = true;
      const chief = g.workers.list.find((w) => w.role === 'chief');
      const sl = g.course.segments[0].slots[plan.crossSlot];
      const go = () => { if (plan.resolved) return; plan.resolved = true; if (chief) chief.say('ドミノの建設を優先させてもらう！ ぽっぽ線さんは手前で駅を作ってくれ', 'warn'); this.chiefSay(plan, 'うう…わかった。迂回しよう', 'warn', 1.4); plan.shorten(); };
      plan.dispatchT = g.time;
      if (chief) { chief.goto(() => V(sl.x + 2, 0, sl.z + 2), () => { chief.face2(V(sl.x, 0, sl.z)); chief.act(1.5, 'point', () => chief.think()); go(); }, 1.5); }
      else go();
      plan.resolveNow = go;
    }
    // 設計主任が別の用事で遅れても、10秒たったら決着（いつまでもけんかを続けない）
    if (plan.quarrelDone && !plan.resolved && g.time - plan.dispatchT > 10) plan.resolveNow();
  }
  // ---------- 保線係（ぽっぽ線）：トロッコからレールを運んで1本ずつ敷く。迂回で要らなくなった所は片付ける ----------
  thinkCrew(w) {
    const g = this.game;
    if (g.mode !== 'build') return false;
    const plan = this.plans.find((p) => p.state === 'laying' || p.state === 'survey' || p.state === 'dismantle');
    if (!plan || plan.state === 'survey') return false;
    // 片付け：終点より先に敷いてしまったレールを外して、トロッコへ戻す
    if (plan.state === 'dismantle') {
      for (let li = 0; li < plan.lines.length; li++) {
        if (plan.laid[li] > plan.endK[li]) {
          const ln = plan.lines[li], p = ln.pieces[plan.laid[li] - 1];
          if (p.claim && p.claim !== w.id) continue;
          p.claim = w.id;
          const at = V(p.mid.x, 0, p.mid.z).add(V(Math.cos(p.yaw) * 1.2, 0, -Math.sin(p.yaw) * 1.2));
          w.goto(() => at, () => { w.face2(p.mid); w.act(LAY_TIME, 'kneel', () => { p.claim = 0; if (plan.laid[li] - 1 === ln.pieces.indexOf(p)) { ln.clear(p); plan.laid[li]--; } w.think(); }); });
          return true;
        }
      }
      plan.state = 'laying';
      return false;
    }
    const nx = plan.nextPiece();
    if (!nx) return false;
    const { ln, li } = nx, k = plan.laid[li], p = ln.pieces[k];
    if (p.claim && p.claim !== w.id) {
      // もう一人は、もう一方の線か、次の1本の準備（トロッコのそばで待つ）
      return w.act(0.6, 'idle', () => w.think()) || true;
    }
    p.claim = w.id;
    const tro = plan.trolley.position.clone().add(V(0.9, 0, 0.6)); tro.y = 0;
    const at = V(p.mid.x, 0, p.mid.z).add(V(Math.cos(p.yaw) * 1.2, 0, -Math.sin(p.yaw) * 1.2));
    w.goto(() => tro, () => {
      w.hold && w.hold('rail');
      w.goto(() => at, () => {
        w.face2(p.mid);
        w.act(LAY_TIME, 'kneel', () => {
          p.claim = 0; w.hold && w.hold(null);
          if (plan.laid[li] === k && plan.state === 'laying') plan.laidOne(li);
          w.think();
        });
      });
    });
    return true;
  }
  // ---------- 保線主任：計画を調べ、工事の先頭で指示する ----------
  thinkRailChief(w) {
    const g = this.game, plan = this.active();
    if (!plan || g.mode !== 'build') return false;
    if (plan.state === 'survey') {
      // 予定線を歩いて調べ、終点を指さす
      const ln = plan.lines[0], mid = ln.pointAt(ln.len * 0.5), end = ln.pointAt(ln.len - 0.5);
      w.say(`ぽっぽ線は${plan.def.goal}まで線路を延ばすぞ！`, 'coin');
      w.goto(() => mid.clone().setY(0).add(V(1.5, 0, 1.5)), () => {
        w.face2(end); w.act(1.6, 'read', () => {
          w.act(1.2, 'point', () => { plan.state = 'laying'; this.crewSay(plan, 'レール、運びます！', 0.4); w.think(); });
        });
      }, 1.2);
      return true;
    }
    // 工事の先頭のそばで、図面を見て指さす
    const k = Math.min(plan.laid[0], plan.lines[0].pieces.length - 1);
    const p = plan.lines[0].pieces[k];
    const at = V(p.mid.x, 0, p.mid.z).add(V(-Math.cos(p.yaw) * 2.4, 0, Math.sin(p.yaw) * 2.4));
    w.goto(() => at, () => { w.face2(p.mid); w.act(1.8, Math.random() < 0.5 ? 'read' : 'point', () => w.act(1.0, 'idle', () => w.think())); });
    return true;
  }
  serialize() { return { v: 1, plans: this.plans.map((p) => p.serialize()) }; }
  /** 読み込み：敷いた線路・迂回・開業・交差地点（階段）を元に戻す */
  load(d) {
    if (!d || !d.plans) return;
    for (const s of d.plans) {
      const p = this.plans.find((q) => q.def.id === s.id); if (!p || s.state === 'idle') continue;
      p.start();
      if (s.short) p.shorten();
      p.crossOk = !!s.crossOk;
      s.laid.forEach((n, li) => { for (let k = 0; k < Math.min(n, p.endK[li]); k++) p.laidOne(li); });
      if (s.site) {
        if (!p.site) p.site = this.game.crossings.addBranchSite(p, p.lines[0], p.crossSlot);
        const site = p.site;
        if (s.site.plan === 'stairs') { site.plan = 'stairs'; this.game.crossings.prepareStairs(site); for (const q of site.parts) this.game.crossings.buildPart(site, q, true); }
        else if (s.site.state === 'open') { site.plan = s.site.plan; this.game.crossings.setState(site, 'open'); }
      }
      if (s.state === 'open') p.open(); else if (['laying', 'waitCross', 'quarrel', 'dismantle'].includes(s.state)) p.state = s.state === 'quarrel' ? 'laying' : s.state;
    }
  }
  dispose() { for (const p of this.plans) p.dispose(); }
}
