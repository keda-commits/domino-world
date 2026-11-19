import * as THREE from 'three';
import { PathFollower } from '../game/nav.js';
const REACH = 1.6; // 復旧係のマジックハンドが届く距離
import { CFG } from '../config.js';
import { buildGnome, looseMats } from './gnomeModel.js';
import { chiefRoutine, thinkWalkway } from '../game/chief.js';

const tmp = new THREE.Vector3();
const looseGeo = new THREE.BoxGeometry(CFG.dominoW, CFG.dominoT, CFG.dominoH);

const SAY = {
  builder: ['がんばるぞ！', 'まかせて！', 'ならべるよ〜'],
  carrier: ['はこぶよ！', 'よいしょ！'],
  collector: ['ひろうよ！', 'おかたづけ〜'],
  stopperCrew: ['ストッパーズ、着任！', '安全第一！', '事故ゼロ宣言！'],
  restorer: ['復旧はおまかせ！', '出動準備よし！'],
  guard: ['警備開始！', 'ルンバは通さない！'],
  soldier: ['気をつけ！', '持ち場につきます！', 'ドミノは守ります！'],
  chief: ['設計主任です。現場の段取りはお任せを'], architect: ['エリート建築士、参上！', '設計図はできています'], wrecker: ['撤去班、待機します'], railcrew: ['ぽっぽ線の保線係です'], railchief: ['ぽっぽ線の保線主任です。路線を延ばしますよ']
};

/**
 * 小人1人。役割ごとの思考と、歩く・作業・転ぶ・逃げる・敬礼などの状態機械。
 */
export class Gnome {
  constructor(role, id, game, spawn) {
    this.role = role; this.id = id; this.game = game;
    this.isStopper = role === 'stopperCrew' || role === 'restorer' || role === 'guard';
    this.m = buildGnome(role);
    this.root = this.m.root;
    this.pos = this.root.position;
    this.pos.copy(spawn);
    this.yaw = Math.random() * Math.PI * 2;
    this.speedVar = 0.9 + Math.random() * 0.2;
    this.phase = Math.random() * 10;
    this.load = 0;
    this.job = null;
    this.pose = 'cheer'; this.poseT = 0;
    this.state = 'act'; this.timer = 1.0; this.onDone = () => this.think();
    this.targetFn = null; this.onArrive = null;
    this.loose = [];
    this.walking = false;
    this.side = id % 2 ? 0.75 : -0.75;
    this.home = spawn.clone();
    // 性格（Ver.0.5）：なまけ・体育会系・遊び好き。手が空いたときの過ごし方とサボりやすさが変わる
    this.trait = { lazy: Math.random(), sporty: Math.random(), playful: Math.random() };
    this.slackCool = 10 + Math.random() * 20; this.slacks = 0;
    game.scene.add(this.root);
    this.applyLooks();
  }

  get capacity() { return this.game.capacity(this.role); }
  get speed() { return this.game.workMult(this.role) * this.speedVar; }

  applyLooks() {
    const g = this.game, m = this.m;
    const boots = g.level('boots') > 0;
    m.boots.forEach((b) => (b.visible = boots));
    const mass = this.role === 'builder' && g.evolved('massBuild');
    m.gold.visible = mass;
    m.pack.visible = mass;
    m.antenna.visible = this.isStopper && (g.evolved('autoSafety') || g.evolved('stopperHQ'));
    // 運搬カゴ：背中のかご（中のドミノが見える）。ブーツは赤いブーツ。水平器は建設担当が置くときに当てる
    if (m.basket) m.basket.visible = g.level('basket') > 0 && ['builder', 'carrier', 'collector'].includes(this.role) && !mass;
    this.levelOn = g.level('level') > 0 && this.role === 'builder';
  }

  // ---------- 基本動作 ----------
  goto(targetFn, onArrive) { this.state = 'walk'; this.targetFn = targetFn; this.onArrive = onArrive; }
  act(time, pose, onDone) { this.state = 'act'; this.timer = time; this.pose = pose; this.poseT = 0; this.onDone = onDone; }
  wait(time, pose = 'idle') {
    // 手が空いたら（長めの待ち）自分の待機所へ戻る。ガチャの前などに人が溜まらないように
    const home = time >= 1 && (pose === 'idle' || pose === 'shrug') && this.game.mode === 'build' && this.role !== 'guard' && this.role !== 'soldier' ? this.game.campPos(this.role) : null;
    if (home && Math.hypot(home.x - this.pos.x, home.z - this.pos.z) > 4) {
      let off = new THREE.Vector3(Math.cos(this.id * 2.4) * 2.6, 0, Math.sin(this.id * 2.4) * 2.6).add(home);
      // 村の家・庭・ハンモックの上には立たない（通れる所へ）
      const nv = this.game.nav; if (nv && nv.version) { const k = nv.nearestFree(off, 0, 6); if (k >= 0) off = nv.center(k); }
      return this.goto(() => off, () => (this.game.campLife && this.game.campLife.offer(this, time)) || this.idleFun(time) || this.act(time, pose, () => this.think()));
    }
    if (home && ((this.game.campLife && this.game.campLife.offer(this, time)) || this.idleFun(time))) return;
    this.act(time, pose, () => this.think());
  }

  // ---------- 手が空いたとき・サボり（Ver.0.5） ----------
  /** 役割と性格で、手が空いたときの遊びを選ぶ */
  pickFun(slack) {
    const t = this.trait;
    const W = {
      pushup: 0.4 + t.sporty, dumbbell: 0.3 + t.sporty, sit: 0.3 + t.lazy, nap: t.lazy * (slack ? 0.4 : 1), kick: 0.2 + t.playful,
      pretend: 0.2 + t.playful * 0.8, chase: t.playful * 0.9, squabble: t.playful * 0.4, fakework: slack ? 0.6 + t.lazy : 0.1, drill: 0.05,
    };
    const ROLE = {
      builder: { pushup: 1.4, fakework: 1.5 }, carrier: { dumbbell: 1.8, sit: 1.2 }, collector: { kick: 1.6, pretend: 1.5, nap: 1.3 },
      restorer: { drill: 6, pushup: 1.3 }, stopperCrew: { drill: 5, sit: 1.2 }, guard: { drill: 6 }, soldier: { drill: 8, pushup: 1.5 },
    }[this.role] || {};
    let sum = 0; const list = [];
    for (const [k, v] of Object.entries(W)) { const w = v * (ROLE[k] || 1); if (slack && (k === 'chase' || k === 'squabble')) continue; sum += w; list.push([k, w]); }
    let r = Math.random() * sum;
    for (const [k, w] of list) { r -= w; if (r <= 0) return k; }
    return 'sit';
  }
  /** 遊ぶ／休む。time 秒くらい。相手がいる遊びは近くの手の空いた仲間と */
  idleFun(time, slack = false) {
    const g = this.game;
    if (g.mode !== 'build' || this.role === 'soldier' && !slack && Math.random() < 0.5) return false;
    const kind = this.pickFun(slack);
    const dur = Math.max(2, time) + Math.random() * 2.5;
    const LINES = {
      pushup: ['いち、に！', 'ふんっ！ 腕立て〜'], dumbbell: ['ムキッ', 'もう1回！'], sit: ['ふぅ〜', 'ひと休み'], nap: ['Zzz…', 'すやぁ…'],
      kick: ['ポーン！', 'ナイスキック！'], pretend: ['ドミノ倒し、どーん！ごっこ', '巨大ドミノだぞ〜！'], fakework: ['…はたらいてる、はたらいてる', '（作業してるふり…）'],
      drill: ['気をつけ！', '敬礼！ 点検よし！'], chase: ['まて〜！', 'つかまえた！'], squabble: ['ぷんぷん！', 'そっちこそ！'],
    };
    const line = (k) => { const a = LINES[k]; if (Math.random() < 0.6) this.say(a[Math.floor(Math.random() * a.length)]); };
    this.funKind = kind;
    if (kind === 'chase' || kind === 'squabble') {
      const mate = g.workers.list.find((o) => o !== this && o.state === 'act' && o.funKind && o.funKind !== 'chase' && o.funKind !== 'squabble' && !o.slacking && Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 9);
      if (!mate) return this.idleFun(time, slack) && true;
      line(kind);
      if (kind === 'squabble') {
        for (const w of [this, mate]) { w.funKind = 'squabble'; w.face2(w === this ? mate.pos : this.pos); w.act(2.4, 'squabble', () => { w.funKind = null; w.think(); }); }
        setTimeout(() => mate.say('そっちこそ！'), 600);
        return true;
      }
      // 追いかけっこ：自分が逃げ、相手が追う（待機所のまわり）
      const c = this.pos.clone();
      const runTo = new THREE.Vector3(c.x + (Math.random() - 0.5) * 7, 0, c.z + (Math.random() - 0.5) * 7);
      g.clampToStage(runTo);
      mate.funKind = 'chase';
      this.goto(() => runTo, () => { this.funKind = null; this.act(0.8, 'cheer', () => this.think()); }, 1.4);
      mate.goto(() => this.pos, () => { mate.funKind = null; mate.say('タッチ！'); mate.act(0.8, 'cheer', () => mate.think()); }, 1.35);
      mate.arriveDist = 0.7;
      return true;
    }
    line(kind);
    const pose = { pushup: 'pushup', dumbbell: 'dumbbell', sit: 'sit', nap: 'nap', kick: 'kick', pretend: 'cheer', fakework: 'pick', drill: 'salute' }[kind];
    this.act(dur, pose, () => { this.funKind = null; this.slacking = false; this.think(); });
    return true;
  }
  /** 仕事中のサボり：役割のレベルが低いほど、なまけ者ほどサボる。短く、続けてはサボらない（止まらない） */
  maybeSlack() {
    const g = this.game;
    if (g.mode !== 'build' || this.load > 0 || g.time < this.slackCool) return false;
    const lv = Math.max(1, g.level(this.role));
    const chance = (0.03 + 0.12 * this.trait.lazy) / lv;
    this.slackCool = g.time + 6;
    if (Math.random() > chance) return false;
    this.slackCool = g.time + 25 + Math.random() * 15;
    this.slacks++; g.stats.slacks = (g.stats.slacks || 0) + 1;
    this.slacking = true;
    return this.idleFun(1.5 + Math.random() * 1.5, true);
  }
  /** 待機所へ向かう（ガチャで加わった直後など） */
  goHome() {
    const home = this.game.campPos(this.role);
    if (!home) return this.think();
    const off = new THREE.Vector3(Math.cos(this.id * 2.4) * 2, 0, Math.sin(this.id * 2.4) * 2).add(home);
    this.goto(() => off, () => this.act(0.8, 'salute', () => this.think()));
  }
  /** 手に持つ物（鉄道の修理班のレールなど） */
  hold(kind) {
    if (!this._holdG) { this._holdG = new THREE.Group(); this._holdG.position.set(0, 0.95, 0.15); this.m.pivot.add(this._holdG); }
    this._holdG.clear();
    if (kind === 'rail') { const r = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: '#1c7ed6', roughness: 0.4 })); this._holdG.add(r); }
  }
  say(text, cls = '') { this.game.fx.floatObj(this.root, text, cls, 1.4); }
  releaseJob() {
    if (!this.job) return;
    if (this.job.claim === this.id) this.job.claim = 0;
    this.job = null;
  }

  think() {
    this.releaseJob();
    this.m.held.visible = false;
    this.pose = 'idle';
    const g = this.game;
    this.funKind = null; this.slacking = false; this.forcing = false; this.stuckT = 0; this._stuckSaid = false; this._stuckRep = false;
    if (this.m.ball) this.m.ball.visible = false;
    if (this.life && g.campLife) g.campLife.leave(this);
    this.liftY = 0;
    if (this.haul) return this.thinkHaul();
    if (this.role !== 'soldier' && this.role !== 'guard' && !this.standby && this.maybeSlack()) return;
    if (g.mode === 'run' && this.role === 'restorer') {
      const rd = g.findRestandJob(this, Infinity, true);
      if (rd) return this.doRestand(rd);
      const es = g.findRunRepairSlot(this);
      if (es) {
        this.job = es;
        return this.goto(() => g.sideOf(es, this.side, tmp), () => {
          if (es.domino || es.claim !== this.id || g.mode !== 'run' || g.run.frontOrder + 8 > es.order || g.stock <= 0) { this.releaseJob(); return this.think(); }
          this.face(es);
          this.act(CFG.placeTime / (this.speed * 1.5), 'place', () => { this.releaseJob(); if (!es.domino && g.stock > 0) { g.stock--; g.placeAt(es, null); this.say('間に合え〜！'); } this.think(); });
        }, 1.6);
      }
    }
    if (g.mode === 'run' || g.mode === 'test') return this.watchRun();
    switch (this.role) {
      case 'builder': return this.thinkBuilder();
      case 'carrier': return this.thinkCarrier();
      case 'collector': return this.thinkCollector();
      case 'stopperCrew': return this.thinkStopperCrew();
      case 'restorer': return this.thinkRestorer();
      case 'guard': return this.thinkGuard();
      case 'soldier': return this.thinkSoldier();
      case 'chief': if (g.crossings && g.crossings.thinkChief(this)) return; if (chiefRoutine(this, g)) return; break;
      case 'architect': if (g.crossings && g.crossings.thinkArchitect(this)) return; if (thinkWalkway(this, g)) return; break;
      case 'wrecker': if (g.crossings && g.crossings.thinkWrecker(this)) return; break;
      case 'railcrew': if (this.atSite) return this.act(0.5, 'idle', () => {}); if (!this.busy && g.railPlans && g.railPlans.thinkCrew(this)) return; break;
      case 'railchief': if (g.railPlans && g.railPlans.thinkRailChief(this)) return; break;
    }
    this.wait(1);
  }

  /** 連鎖中：コースから少し離れて観戦・応援 */
  watchRun() {
    if (Math.random() < 0.35) this.act(1.2 + Math.random(), 'cheer', () => this.think());
    else this.wait(0.8 + Math.random() * 0.8);
  }

  // ---------- 建設小人 ----------
  thinkBuilder() {
    const g = this.game;
    // 通路（踏み板）の工事を頼まれていれば、先に組み立てる
    if (thinkWalkway(this, g)) return;
    // 大事故の立て直し中：建設より先に、倒れたドミノを手前から起こす（運んでいるドミノは持ったまま）
    if (g.recovery && g.recovery.helpers.has(this.id)) {
      const rd = g.findRestandJob(this, Infinity);
      if (rd) return this.doRestand(rd);
      const cl = g.findClearJob(this);
      if (cl) return this.doClear(cl);
    }
    // 倒れたドミノの立て直し（建設がない時も）
    if (this.load === 0) {
      const cl = g.findClearJob(this);
      if (cl) return this.doClear(cl);
      const rd = g.findRestandJob(this, 6);
      if (rd) return this.doRestand(rd);
      if (g.unbuiltCount() === 0) {
        const rd2 = g.findRestandJob(this, Infinity);
        if (rd2) return this.doRestand(rd2);
        return this.wait(1.2);
      }
      const src = g.supplyFor(this);
      if (!src) { if (Math.random() < 0.1) this.say('在庫切れ…', 'warn'); return this.wait(1.0, 'shrug'); }
      return this.goto(() => src.spot(this.id, tmp), () => {
        const take = src.take(this.capacity);
        if (take <= 0) return this.wait(0.3);
        this.load += take;
        this.act(CFG.pickTime / this.speed, 'pick', () => this.think());
      });
    }
    const slot = g.findBuildJob(this);
    if (!slot) {
      if (g.metrics && g.unbuiltCount() > 0) g.metrics.count('buildNoJob');
      if (g.unbuiltCount() === 0) { g.returnToStock(this.load); this.load = 0; }
      // 並べられるマスがない（線路待ち・列の向こう）：その間に、倒れているドミノを起こしに行く
      const rd = g.findRestandJob(this, Infinity);
      if (rd) return this.doRestand(rd);
      return this.wait(0.6);
    }
    this.job = slot;
    this.goto(() => g.sideOf(slot, this.side, tmp), () => {
      if (slot.domino || slot.claim !== this.id) { this.releaseJob(); return this.think(); }
      this.face(slot);
      // マスの上に仲間が立っている：置くとぶつかるので、どくまで待つ
      const blocker = g.workers.list.find((o) => o !== this && o.state !== 'held' && Math.hypot(o.pos.x - slot.x, o.pos.z - slot.z) < CFG.gnomeR + 0.42);
      if (blocker) {
        if (g.metrics) g.metrics.count('slotByGnome');
        if (!this._waitSay || g.time - this._waitSay > 6) { this._waitSay = g.time; this.say('ちょっとどいて〜'); }
        // どいてもらう：立ち止まっている・休んでいる・立ち往生している人は、列の横へ一歩よける
        if (!blocker.haul && !blocker.forcing && blocker.state !== 'trip' && blocker.state !== 'hauled' && (blocker.state === 'act' || (blocker.stuckT || 0) > 0.3 || !blocker.walking)) {
          const away = Math.sign((blocker.pos.x - slot.x) * Math.cos(slot.yaw) - (blocker.pos.z - slot.z) * Math.sin(slot.yaw)) || 1;
          const p = g.sideOf(slot, away * 1.5, new THREE.Vector3());
          if (blocker.life && g.campLife) g.campLife.leave(blocker);
          blocker.releaseJob(); blocker.say('あっ、ごめん！');
          blocker.goto(() => p, () => blocker.think());
        }
        this.releaseJob(); return this.act(0.6, 'idle', () => this.think());
      }
      this.act(CFG.placeTime / this.speed, 'place', () => {
        this.releaseJob();
        if (slot.domino) return this.think();
        this.load--;
        g.placeAt(slot, this);
        // 大量建設隊：もう1個続けて置く
        if (g.evolved('massBuild') && this.load > 0) {
          const nx = g.nextUnbuiltNear(slot);
          if (nx) { this.load--; g.placeAt(nx, this); }
        }
        if (this.state === 'act' && this.pose === 'oops') return;
        this.think();
      });
    });
  }

  /** マスをふさいでいるドミノを拾って片付ける（重なりの解消） */
  doClear(d) {
    const g = this.game;
    this.job = d;
    this.goto(() => { if (d.removed) return this.pos; const t = d.body.translation(); return tmp.set(t.x, 0, t.z); }, () => {
      if (d.removed || d.claim !== this.id || d.held) { this.releaseJob(); return this.think(); }
      this.act(CFG.pickTime / this.speed, 'pick', () => { this.releaseJob(); g.clearBlocker(d); this.think(); });
    });
  }
  doRestand(d) {
    const g = this.game;
    this.job = d;
    const restorer = this.role === 'restorer';
    const fast = restorer ? (g.evolved('stopperHQ') ? 3.0 : 2.0) : 1;
    const slot = d.slot;
    const jobT = g.time, jobFrom = this.pos.clone();
    const work = () => {
      if (g.metrics) { g.metrics.push(g.metrics.arrive, g.time - jobT); if (g.time - jobT > 90 && (g.metrics.longArrive ||= []).length < 12) g.metrics.longArrive.push({ t: Math.round(g.time), role: this.role, sec: Math.round(g.time - jobT), from: [+jobFrom.x.toFixed(1), +jobFrom.z.toFixed(1)], to: [+slot.x.toFixed(1), +slot.z.toFixed(1)], straight: +Math.hypot(slot.x - jobFrom.x, slot.z - jobFrom.z).toFixed(1) }); }
      if (d.removed || d.claim !== this.id || d.held || !d.slot) { this.releaseJob(); return this.think(); }
      this.face(d.slot);
      // 復旧係はマジックハンドを伸ばして起こす（回収担当はしゃがんで手で起こす）
      this.act(CFG.restandTime / (this.speed * fast), restorer ? 'reach' : 'pick', () => {
        this.releaseJob();
        if (d.removed || d.held || !d.slot) return this.think();
        if (g.restand(d, this)) { this.restored = (this.restored || 0) + 1; const st = (g.stats.restoredBy ||= {}); st[this.role] = (st[this.role] || 0) + 1; }
        if (restorer && Math.random() < 0.08) this.say('復旧完了！');
        // 復旧係：手の届く範囲に次の倒れたドミノがあれば、歩かずに続けて起こす
        if (restorer) { const nx = g.findRestandJob(this, REACH + 0.2, true); if (nx) return this.doRestand(nx); }
        this.think();
      });
    };
    if (restorer) {
      // 現場へは走る。マジックハンドが届く所（REACH）まで来たら止まる
      const far = Math.hypot(slot.x - this.pos.x, slot.z - this.pos.z);
      if (far <= REACH) return work();
      const sp = new THREE.Vector3();
      this.goto(() => { const s2 = d.slot || slot; return sp.set(s2.x, 0, s2.z); }, work, far > 5 ? 1.6 : 1);
      this.arriveDist = REACH - 0.15;
      return;
    }
    // 向かっている途中にプレイヤーがつかんだ・別の人が片付けた場合は、そのマスの横で止まって考え直す
    this.goto(() => g.sideOf(d.slot || slot, this.side, tmp), work);
  }

  // ---------- 資材箱を4人で担ぐ（Ver.0.6） ----------
  thinkHaul() {
    const g = this.game, c = this.haul;
    if (!c.haul || c.haul.phase !== 'gather') return this.act(0.3, 'idle', () => this.think());
    if (this.haulReady) return this.act(0.3, 'idle', () => { this.face2(c.pos); this.think(); });
    const v = new THREE.Vector3();
    this.goto(() => c.corner(this.haulIdx, v), () => {
      // 持っていたドミノは箱へ入れてから持ち手につく
      if (this.load > 0) { const put = Math.min(this.load, c.cap - c.count); c.count += put; this.load -= put; if (this.load > 0) { g.returnToStock(this.load); this.load = 0; } }
      this.haulReady = true; this.face2(c.pos);
      this.act(0.3, 'idle', () => this.think());
    }, 1.3);
  }

  // ---------- 運搬小人 ----------
  thinkCarrier() {
    const g = this.game;
    if (this.load === 0) {
      // 工場のドミノ箱にたまっていたら取りに行く（工場で作ったドミノが運ばれて使われるまでが見える）
      const fac = g.factory;
      if (fac && g.level('factory') > 0 && fac.box >= Math.min(6, this.capacity) && g.workers.list.filter((o) => o !== this && o.job === fac).length < Math.floor(fac.box / Math.max(1, this.capacity))) {
        this.job = fac;
        return this.goto(() => fac.boxPos(tmp), () => {
          const take = fac.take(this.capacity);
          this.job = null;
          if (take <= 0) return this.wait(0.3);
          this.load += take;
          this.act(CFG.pickTime / this.speed, 'pick', () => this.think());
        });
      }
      if (g.stock <= 0 || g.crate.count >= g.crate.cap || g.unbuiltCount() === 0) return this.wait(1.0, g.stock <= 0 ? 'shrug' : 'idle');
      const dep = g.nearestDepot(g.crate.pos);
      return this.goto(() => dep.spot(this.id, tmp), () => {
        const take = dep.take(this.capacity);
        if (take <= 0) return this.wait(0.5);
        this.load += take;
        this.act(CFG.pickTime / this.speed, 'pick', () => this.think());
      });
    }
    this.goto(() => g.crate.spot(this.id + 5, tmp), () => {
      const put = Math.min(this.load, g.crate.cap - g.crate.count);
      g.crate.count += put; this.load -= put;
      if (this.load > 0 && (g.unbuiltCount() === 0 || put === 0)) {
        // 資材箱がいっぱい：残りは倉庫へ持って帰る
        const dep = g.nearestDepot(this.pos);
        return this.goto(() => dep.spot(this.id, tmp), () => { g.returnToStock(this.load); this.load = 0; this.think(); });
      }
      g.audio.drop();
      this.act(CFG.pickTime / this.speed, 'pick', () => this.think());
    });
  }

  // ---------- 回収小人 ----------
  thinkCollector() {
    const g = this.game;
    if (this.load < this.capacity) {
      const rd = this.load === 0 ? g.findRestandJob(this, Infinity) : null;
      if (rd) return this.doRestand(rd);
      const lo = g.findCollectJob(this);
      if (lo) {
        this.job = lo;
        return this.goto(() => { if (lo.removed) return this.pos; const t = lo.body.translation(); return tmp.set(t.x, 0, t.z); }, () => {
          if (lo.removed || lo.claim !== this.id) { this.releaseJob(); return this.think(); }
          this.releaseJob();
          g.collect(lo);
          this.load++;
          g.audio.pick();
          this.act(CFG.pickTime / this.speed, 'pick', () => this.think());
        });
      }
    }
    if (this.load > 0) {
      const dep = g.nearestDepot(this.pos);
      return this.goto(() => dep.spot(this.id, tmp), () => {
        g.returnToStock(this.load); this.load = 0;
        g.audio.drop();
        this.act(0.3, 'pick', () => this.think());
      });
    }
    this.wait(1 + Math.random());
  }

  // ---------- ストッパー設置係 ----------
  thinkStopperCrew() {
    const g = this.game;
    const job = g.findStopperJob(this);
    if (job) {
      this.job = job.slot;
      this.m.held.visible = true;
      const sp = g.speedStopper();
      return this.goto(() => g.sideOf(job.slot, this.side, tmp), () => {
        if (job.slot.claim !== this.id) { this.m.held.visible = false; this.releaseJob(); return this.think(); }
        this.face(job.slot);
        this.act(0.7 / (this.speed * sp), 'kneel', () => {
          this.m.held.visible = false;
          this.releaseJob();
          g.installStopper(job.slot, job.next);
          this.act(0.5, 'salute', () => this.think());
        });
      }, sp);
    }
    // 倒れたドミノの立て直しも手伝う
    const rd = g.findRestandJob(this, 10);
    if (rd) return this.doRestand(rd);
    this.wait(1.5, Math.random() < 0.2 ? 'salute' : 'idle');
  }

  // ---------- 復旧係 ----------
  thinkRestorer() {
    const g = this.game;
    this.standby = false;
    const cl = g.findClearJob(this);
    if (cl) return this.doClear(cl);
    const rd = g.findRestandJob(this, Infinity, true);
    if (rd) return this.doRestand(rd);
    const lo = g.findCollectJob(this);
    if (lo && this.load < 4) {
      this.job = lo;
      return this.goto(() => { if (lo.removed) return this.pos; const t = lo.body.translation(); return tmp.set(t.x, 0, t.z); }, () => {
        if (lo.removed || lo.claim !== this.id) { this.releaseJob(); return this.think(); }
        this.releaseJob(); g.collect(lo); this.load++; this.think();
      });
    }
    if (this.load > 0) { const dep = g.nearestDepot(this.pos); return this.goto(() => dep.spot(this.id, tmp), () => { g.returnToStock(this.load); this.load = 0; this.think(); }); }
    // 手前で空いたマスを埋める（抜いたドミノの復旧）
    const gap = g.findGapJob(this);
    if (gap) {
      this.job = gap;
      return this.goto(() => g.sideOf(gap, this.side, tmp), () => {
        if (gap.domino || gap.claim !== this.id || g.slotBlocker(gap)) { this.releaseJob(); return this.think(); }
        this.face(gap);
        this.act(CFG.placeTime / (this.speed * 1.4), 'place', () => {
          this.releaseJob();
          if (!gap.domino) { if (g.crate.count > 0 && g.crate.pos.distanceTo(this.pos) < 10) g.crate.count--; else if (g.stock > 0) g.stock--; else return this.think(); g.placeAt(gap, null); }
          this.think();
        });
      });
    }
    // 事故の直後で、まだ起こせない（上に別のドミノが寝ている）ものが残っているなら、持ち場へ帰らず現場で待機
    const acc = g.pendingAccidentNear && g.pendingAccidentNear(this.pos);
    if (acc) {
      this.standby = true;
      const d = Math.hypot(acc.x - this.pos.x, acc.z - this.pos.z);
      if (d > 2.5) return this.goto(() => acc, () => this.wait(0.4, 'alarm'), 1.6);
      return this.wait(0.4, 'idle');
    }
    this.goto(() => this.home, () => this.wait(1.5, Math.random() < 0.3 ? 'salute' : 'idle'));
  }

  // ---------- 警備係 ----------
  thinkGuard() {
    const g = this.game;
    const threat = g.guardTask(this);
    if (threat) {
      this.say('ルンバ接近！バリケード設置！', 'warn');
      return this.goto(() => threat.pos, () => {
        this.face2(threat.face);
        this.act(0.5, 'kneel', () => { g.placeTempBarricade(threat.pos, threat.yaw); this.act(0.6, 'salute', () => this.think()); });
      }, 1.7);
    }
    this.goto(() => this.home, () => this.wait(1.2, Math.random() < 0.2 ? 'salute' : 'idle'));
  }

  // ---------- おもちゃの兵隊（Ver.0.5 防衛） ----------
  thinkSoldier() {
    const g = this.game;
    const en = g.soldierTarget(this);
    if (en) {
      if (g.defenseStyle === 'push') {
        // 押し返し型：走って行って盾で押し戻す
        if (Math.random() < 0.3) this.say('止まれー！', 'warn');
        this.goto(() => en.pos, () => {
          this.face2(en.pos);
          this.act(0.25, 'shove', () => {
            if (en.repel && en.repel(this.pos, 'shove')) { g.stats.shoves = (g.stats.shoves || 0) + 1; }
            this.act(0.5, 'salute', () => this.think());
          });
        }, 1.8);
        this.arriveDist = 1.2;
        return;
      }
      // 射撃型：射程（8）まで近づいて、スポンジ弾を撃つ
      const d = Math.hypot(en.pos.x - this.pos.x, en.pos.z - this.pos.z);
      if (d > 8) { this.goto(() => en.pos, () => this.think(), 1.5); this.arriveDist = 7.5; return; }
      this.face2(en.pos);
      return this.act(0.3 / Math.min(1.5, this.speed), 'aim', () => {
        this.face2(en.pos);
        g.darts.fire(this, en);
        this.act(0.55, 'aim', () => this.think());
      });
    }
    // 持ち場で見張る（ときどき敬礼・見回し）
    const hd = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
    if (hd > 1.2) return this.goto(() => this.home, () => this.wait(0.8));
    if (Math.random() < 0.15) return this.act(1.0, 'salute', () => this.think());
    this.yaw += (Math.random() - 0.5) * 1.5;
    this.wait(0.6);
  }

  face(slot) { this.yaw = Math.atan2(slot.x - this.pos.x, slot.z - this.pos.z); }
  face2(p) { if (p) this.yaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z); }

  // ---------- ハプニング ----------
  trip() {
    const g = this.game;
    if (this.state === 'trip' || this.loose.length) return;
    this.releaseJob();
    this.m.held.visible = false;
    this.state = 'trip'; this.timer = 1.8; this.pose = 'trip'; this.poseT = 0;
    g.stats.trips++;
    g.audio.squeak(1);
    g.fx.floatObj(this.root, '💫', 'icon', 1.6);
    if (this.load > 0) {
      g.fx.floatObj(this.root, 'ドミノを落とした！', 'warn', 1.4, 0.4);
      for (let i = 0; i < Math.min(this.load, 5); i++) {
        const d = new THREE.Mesh(looseGeo, looseMats[i % looseMats.length]);
        const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.6;
        d.position.set(this.pos.x + Math.cos(a) * r, CFG.dominoT / 2, this.pos.z + Math.sin(a) * r);
        d.rotation.y = Math.random() * Math.PI;
        d.castShadow = true;
        g.scene.add(d); this.loose.push(d);
      }
    }
  }
  /** プレイヤーにつかまれた：作業を中断して、手足をばたばた */
  grabbed() {
    this.releaseJob();
    if (this.m.held) this.m.held.visible = false;
    this.state = 'held'; this.pose = 'flee'; this.poseT = 0;
    this.say(['わわっ！', 'おろして〜！', 'たかい〜！', 'どこ行くの？'][Math.floor(Math.random() * 4)], '');
    this.game.audio.squeak && this.game.audio.squeak(1.6);
  }
  /** 離された（着地した）：少し驚いてから、自然に作業へ戻る */
  dropped(sp = 0) {
    if (this.role === 'soldier') { this.home = this.pos.clone(); this.say('ここを守ります！'); }
    if (sp > 8) { this.state = 'idle'; this.trip(); return; }
    this.state = 'act'; this.pose = 'surprised'; this.poseT = 0; this.timer = 0.7;
    this.onDone = () => this.think();
  }
  /** 投げたドミノが当たった（dx,dz：飛んできた向き、sp：速さ） */
  hitBy(dx, dz, sp) {
    const g = this.game;
    this.hitCool = 0.8;
    // 少し押される（物理的にのけぞる）
    const push = Math.min(0.6, sp * 0.04);
    this.pos.x += dx * push; this.pos.z += dz * push;
    g.stats.hitReactions = (g.stats.hitReactions || 0) + 1;
    if (sp > 9 && this.state !== 'trip') {
      // 強く当たった：転ぶ（持っていた資材を落とし、近くのドミノを巻き込むことも）
      this.trip();
      this.say(['いてて…', 'うわぁ！', 'なにするの！'][Math.floor(Math.random() * 3)], 'warn');
      const near = g.nearestSlot(this.pos.x, this.pos.z, 1.2);
      if (near && near.domino && !near.domino.toppled && Math.random() < 0.5) g.dominoes.push(near.domino, dx, dz, 0.05);
    } else {
      // 軽く当たった：驚いて飛び上がり、作業を少し中断
      this.releaseJob();
      if (this.m.held) this.m.held.visible = false;
      this.state = 'act'; this.pose = 'surprised'; this.poseT = 0; this.timer = 0.9;
      this.onDone = () => this.think();
      this.say(['いてっ！', 'わっ！', 'こら〜！', 'びっくりした！'][Math.floor(Math.random() * 4)], '');
      this.yaw = Math.atan2(-dx, -dz); // 飛んできた方を向く
    }
    g.audio.squeak && g.audio.squeak(1.3);
  }
  oops() {
    this.state = 'act'; this.pose = 'oops'; this.poseT = 0; this.timer = 1.2;
    this.onDone = () => this.think();
    this.say('あっ！', 'warn');
  }
  startFlee(from, label = '！') {
    this.releaseJob();
    this.m.held.visible = false;
    this.state = 'flee'; this.timer = 1.2; this.pose = 'flee';
    tmp.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (tmp.lengthSq() < 0.01) tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    this.fleeDir = tmp.normalize().clone();
    this.game.stats.flees++;
    this.game.fx.floatObj(this.root, label, 'big', 0.9);
    if (Math.random() < 0.5) this.game.audio.squeak(1.6);
  }

  /** 道がふさがって進めない：その場で待つ。長く続いたら仕事を手放して考え直す（同じ所に突っ込み続けない） */
  stall(dt, d) {
    this.pose = 'idle';
    this.stuckT = (this.stuckT || 0) + dt;
    // 横着な小人：しばらく待っても通れないと、無理やり横切ろうとする（体が当たったドミノは物理で倒れる）
    if (this.stuckT > 1.5 && !this.forcing && this.maybeForce(d)) { this.stuckT = 0; return; }
    if (this.stuckT > 2 && !this._stuckRep) { this._stuckRep = true; this.game.lastStuck = { w: this, pos: this.pos.clone(), t: this.game.time }; }
    if (this.stuckT > 1.2 && !this._stuckSaid) { this._stuckSaid = true; if (Math.random() < 0.5) this.say(d < 4 ? '通れない…' : 'ぐるっと回れないなあ', 'warn'); }
    if (this.stuckT > 6) {
      this.stuckT = 0; this._stuckSaid = false; this._stuckRep = false;
      this.game.stats.stuckGiveUps = (this.game.stats.stuckGiveUps || 0) + 1;
      // たどり着けなかった仕事は、しばらく別の人にまかせる（同じ人を何度も送らない）
      this.game.markJobFail(this.job, this);
      if (this.job && this.job.slot === undefined && this.job.order !== undefined) this.side = -this.side; // 建設のマス：反対側から
      this.releaseJob();
      this.act(1.0 + Math.random(), 'shrug', () => this.think());
    }
  }
  /** 倒れたドミノに囲まれて動けない：一番近い倒れたドミノを、手で起こすか拾う（実際にしゃがんで作業する） */
  selfRescue() {
    const g = this.game;
    let best = null, bd = 1.8 * 1.8;
    for (const d of g.dominoes.near(this.pos.x, this.pos.z)) {
      if (d.held || d.removed || !(d.toppled || !d.slot)) continue;
      const t = d.body.translation(), dd = (t.x - this.pos.x) ** 2 + (t.z - this.pos.z) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    if (!best) return false;
    const target = this.onArrive, tf = this.targetFn;
    g.stats.selfRescues = (g.stats.selfRescues || 0) + 1;
    if (!this._rescueSaid || g.time - this._rescueSaid > 8) { this._rescueSaid = g.time; this.say('足元を片付けないと…'); }
    const t = best.body.translation(); this.face2({ x: t.x, z: t.z });
    this.act(0.6, 'pick', () => {
      if (!best.removed && !best.held) {
        const sl = best.slot;
        if (sl && (t.x - sl.x) ** 2 + (t.z - sl.z) ** 2 <= CFG.restandDistance ** 2 && !g.slotBlocker(sl, best)) g.restand(best);
        else g.clearBlocker(best);
      }
      if (this.pf) this.pf.reset();
      g.nav && (g.nav.dynT = -1);
      this.goto(tf, target); // もとの行き先へ
    });
    return true;
  }
  /** 横着な小人：遠回りしかない・道がないとき、ときどき列を無理やり横切る（体が当たったドミノは物理で倒れる） */
  maybeForce(d) {
    const g = this.game;
    if (this.forcing || g.mode !== 'build' || d > 7 || this.trait.lazy < 0.8 || g.time < (this.forceCool || 0)) return false;
    this.forceCool = g.time + 40 + Math.random() * 40;
    if (Math.random() > 0.35) return false;
    this.forcing = true; g.stats.forcedCross = (g.stats.forcedCross || 0) + 1;
    this.say('ちょっと通るよ〜', 'warn');
    return true;
  }

  // ---------- 更新 ----------
  update(dt) {
    const g = this.game;
    this.walking = false;
    if (this.state === 'held' || this.state === 'falling') { this.poseT += dt; this.phase = (this.phase || 0) + dt * 14; this.animate(dt); return; }
    if (this.state === 'hauled') { this.poseT += dt; this.walking = (this.haulSpeed || 0) > 0.05; if (this.walking) this.phase = (this.phase || 0) + dt * 9; this.animate(dt); return; }
    if (this.state !== 'trip' && this.state !== 'flee') {
      const danger = g.dangerNear(this.pos);
      if (danger) {
        if (this.state === 'act' && (this.pose === 'place' || this.pose === 'kneel' || this.pose === 'pick')) this.fleeAfter = danger;
        else this.startFlee(danger.pos, danger.label);
      }
    }
    switch (this.state) {
      case 'walk': {
        const tgt = this.targetFn();
        let dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const step = CFG.walkSpeed * this.speed * (this.runMult || 1) * dt;
        const ad = this.arriveDist || 0;
        if (ad ? d <= Math.max(ad, step) : d <= Math.max(0.08, step)) {
          if (!ad) { this.pos.x = tgt.x; this.pos.z = tgt.z; }
          this.arriveDist = 0;
          const cb = this.onArrive; this.onArrive = null; this.runMult = 1;
          if (this.pf) this.pf.reset();
          if (cb) cb(); else this.state = 'idle';
        } else {
          // 近づけていない（その場でうろうろ・行ったり来たり）：3秒たっても0.3以上近づいていなければ、
          // 目的地まで2以内なら「手が届く所に着いた」ことにする。遠ければ立ち往生として扱う
          // （遠回りで目的地から一時的に遠ざかるのは正常。3秒でほとんど位置が変わっていない時だけ「近づけていない」とみなす）
          if (this._goalRef !== tgt || this._bestD == null) { this._goalRef = tgt; this._bestD = d; this._bestT = g.time; (this._progP ||= new THREE.Vector3()).copy(this.pos); }
          if (d < this._bestD - 0.3 || this.pos.distanceTo(this._progP) > 0.8) { this._bestD = Math.min(d, this._bestD); this._bestT = g.time; this._progP.copy(this.pos); this._noProg = 0; }
          else if (g.time - this._bestT > 3) {
            this._bestT = g.time; this._bestD = d; this._progP.copy(this.pos);
            if (d < 2.0) { this._noProg = 0; if (g.metrics) g.metrics.count('nearArrive'); this.arriveDist = 0; const cb = this.onArrive; this.onArrive = null; this.runMult = 1; if (this.pf) this.pf.reset(); if (cb) cb(); else this.state = 'idle'; break; }
            this._noProg = (this._noProg || 0) + 1; if (g.metrics) g.metrics.count('noProgress');
            if (this.pf) this.pf.reset();
            // 12秒近づけない（遠くでうろうろ）：仕事を手放して、別の人にまかせる
            if (this._noProg >= 4) {
              this._noProg = 0; g.stats.stuckGiveUps = (g.stats.stuckGiveUps || 0) + 1; if (g.metrics) g.metrics.count('noProgressGiveUp');
              g.markJobFail(this.job, this); this.releaseJob(); this.act(0.8, 'shrug', () => this.think()); break;
            }
          }
          // ドミノの列・家具をよけて歩く（目的地のすぐ近くだけ直進）。Ver.0.6：列はまたがない。道がなければ待つ
          let sx = dx, sz = dz, sd = d;
          if (g.nav && d > 1.5 && !this.forcing) {
            this.pf ||= new PathFollower(0);
            const wp = this.pf.next(g.nav, this.pos, tgt, g.time);
            if (wp) { sx = wp.x - this.pos.x; sz = wp.z - this.pos.z; sd = Math.hypot(sx, sz) || 1; }
            else {
              // 倒れたドミノに囲まれて、足元から動けない：まわりの倒れたドミノを拾って（起こして）道を作る
              if (this.pf.lastFail === 'noStart' && this.selfRescue()) break;
              // 道がない（列の向こう側）。横着な小人はときどき無理やり通ろうとする（体が当たれば本当に倒れる）
              if (this.pf.fail >= 1 && this.maybeForce(d)) break;
              this.stall(dt, d); break;
            }
          }
          let st = Math.min(step, sd), mx = (sx / sd) * st, mz = (sz / sd) * st;
          // 実際の位置で、体とドミノが当たるかを確かめる（すり抜けない）
          const cur = g.bodyContact(this.pos.x, this.pos.z, this.pos.y);
          const nxt = g.bodyContact(this.pos.x + mx, this.pos.z + mz, this.pos.y);
          if (nxt > 0 && nxt >= cur - 1e-4) {
            if (this.forcing) {
              // 横着：体で押しのけて進む（押す力はめり込み量から。倒れるかどうかは物理しだい）
              g.pushByBody(this, sx / sd, sz / sd, dt);
              st *= 0.45; mx *= 0.45; mz *= 0.45;
            } else {
              // 少し向きを変えて回り込めるか
              let ok = false;
              for (const ang of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
                const c = Math.cos(ang), sn = Math.sin(ang), rx = mx * c - mz * sn, rz = mx * sn + mz * c;
                const dd2 = g.bodyContact(this.pos.x + rx, this.pos.z + rz, this.pos.y);
                if (dd2 <= 0 || dd2 < cur - 1e-4) { mx = rx; mz = rz; ok = true; break; }
              }
              if (!ok) {
                // 目的地がドミノのすぐそば（拾う・起こす）：手が届くのでここで着いたことにする
                if (d < 1.0) { this.arriveDist = 0; const cb = this.onArrive; this.onArrive = null; this.runMult = 1; if (this.pf) this.pf.reset(); if (cb) cb(); else this.state = 'idle'; break; }
                // 道はあるのに体が当たって進めない（カーブの内側などのすき間）：その所をしばらく通れないことにして引き直す
                if ((this.stuckT || 0) > 0.8 && g.nav && (!this._softT || g.time - this._softT > 1.5)) { this._softT = g.time; g.nav.blockAt(this.pos.x + (sx / sd) * 0.45, this.pos.z + (sz / sd) * 0.45, g.time); }
                this.stall(dt, d); if (this.pf) this.pf.reset(); break;
              }
            }
          }
          this.stuckT = 0;
          this.pos.x += mx; this.pos.z += mz;
          if (g.metrics) g.metrics.add(g.metrics.dist, this.role, Math.hypot(mx, mz));
          sx = mx; sz = mz;
          this.turnTo(Math.atan2(sx, sz), dt);
          this.walking = true;
          this.pose = this.load > 0 ? 'carry' : (this.runMult > 1.2 ? 'run' : 'walk');
          const tripMul = g.level('boots') > 0 ? 0.6 : 1;
          if (d > 1.5 && Math.random() < CFG.tripChancePerSec * tripMul * dt * (this.isStopper ? 0.3 : 1)) this.trip();
        }
        break;
      }
      case 'act':
        this.timer -= dt;
        if (this.timer <= 0) {
          const cb = this.onDone; this.onDone = null;
          if (this.fleeAfter) { const f = this.fleeAfter; this.fleeAfter = null; if (cb) cb(); this.startFlee(f.pos, f.label); }
          else if (cb) cb(); else this.think();
        }
        break;
      case 'trip':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.loose.length) this.act(1.0, 'pick', () => { this.loose.forEach((d) => g.scene.remove(d)); this.loose.length = 0; this.think(); });
          else this.think();
        }
        break;
      case 'flee': {
        this.timer -= dt;
        const sp = CFG.walkSpeed * 1.9 * dt;
        // 慌てて逃げる：ドミノがあれば少し向きを変えてよける。よけられない時だけ体で押してしまう（当たったときだけ）
        if (g.bodyContact(this.pos.x + this.fleeDir.x * sp, this.pos.z + this.fleeDir.z * sp, this.pos.y) > 0) {
          let ok = false;
          for (const a of [0.6, -0.6, 1.2, -1.2]) { const c = Math.cos(a), sn = Math.sin(a), fx = this.fleeDir.x * c - this.fleeDir.z * sn, fz = this.fleeDir.x * sn + this.fleeDir.z * c; if (g.bodyContact(this.pos.x + fx * sp, this.pos.z + fz * sp, this.pos.y) <= 0) { this.fleeDir.set(fx, 0, fz); ok = true; break; } }
          if (!ok) g.pushByBody(this, this.fleeDir.x, this.fleeDir.z, dt);
        }
        this.pos.x += this.fleeDir.x * sp; this.pos.z += this.fleeDir.z * sp;
        g.clampToStage(this.pos);
        this.turnTo(Math.atan2(this.fleeDir.x, this.fleeDir.z), dt * 2);
        this.walking = true;
        if (this.timer <= 0) this.act(0.5, 'surprised', () => this.think());
        break;
      }
    }
    // 床の高さ（歩道橋の上ならその高さ）
    this.pos.y = Math.max(g.stage.heightAt(this.pos.x, this.pos.z), g.bridgeHeight ? g.bridgeHeight(this.pos.x, this.pos.z) : 0) + (this.liftY || 0);
    this.animate(dt);
  }

  /** goto の拡張：走る速さ */
  goto2() {}

  turnTo(target, dt) {
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 12);
  }

  animate(dt) {
    const m = this.m;
    this.poseT += dt;
    const sp = this.state === 'flee' ? 2.3 : this.speed * (this.runMult || 1);
    this.phase += dt * (this.walking ? 11 : 3) * sp;
    const s = Math.sin(this.phase);
    let legA = 0, armL = 0, armR = 0, lean = 0, bob = 0, spread = 0, armRz = 0;
    switch (this.pose) {
      case 'walk': legA = s * 0.7; armL = -s * 0.6; armR = s * 0.6; bob = Math.abs(s) * 0.05; break;
      case 'run': legA = s * 1.0; armL = -s * 1.0; armR = s * 1.0; bob = Math.abs(s) * 0.09; lean = 0.25; break;
      case 'carry': legA = s * 0.6; armL = armR = -1.25; bob = Math.abs(s) * 0.04; break;
      case 'liftbox': { const k = Math.min(1, this.poseT * 1.6); armL = armR = -1.4 - 0.35 * k; lean = 0.25 * (1 - k); bob = -0.06 * (1 - k); spread = -0.15; break; }
      case 'carrybox': legA = s * 0.55; armL = armR = -1.75; bob = Math.abs(s) * 0.03; spread = -0.15; break;
      case 'place': { const k = Math.sin(Math.min(1, this.poseT * this.speed / CFG.placeTime) * Math.PI); lean = 0.75 * k; armL = armR = -1.25 + 0.75 * k; break; }
      case 'pick': { const k = Math.sin(Math.min(1, this.poseT * 2.5) * Math.PI); lean = 0.8 * k; armL = armR = -0.6 * k - 0.2; break; }
      case 'kneel': { const k = Math.min(1, this.poseT * 4); lean = 0.6 * k; bob = -0.12 * k; legA = 0.9 * k; armL = armR = -1.0; break; }
      case 'salute': armR = -2.5; armRz = 0.9; armL = 0.05; bob = 0.02; break;
      case 'read': armL = armR = -1.3; lean = 0.08; bob = Math.sin(this.poseT * 2) * 0.01; break;
      case 'point': armR = -2.2; armL = -0.2; break;
      case 'pry': { const k = Math.sin(this.poseT * 5); lean = 0.5 + k * 0.15; armR = -1.0 - k * 0.6; armL = -0.8; bob = -0.05; break; }
      case 'pushup': { const k = Math.abs(Math.sin(this.poseT * 4)); lean = 1.35; bob = -0.38 + k * 0.12; armL = armR = -1.4 - k * 0.2; break; }
      case 'dumbbell': { armL = -0.3 - Math.max(0, Math.sin(this.poseT * 5)) * 1.9; armR = -0.3 - Math.max(0, -Math.sin(this.poseT * 5)) * 1.9; bob = 0.01; break; }
      case 'sit': legA = -1.45; bob = -0.3; armL = armR = -0.3; lean = -0.1; break;
      case 'nap': lean = -1.45; bob = -0.5; armL = armR = -2.9; legA = 0.05; break;
      case 'kick': { const k = Math.sin(this.poseT * 4); legA = Math.max(0, k) * 1.1; armL = -0.5 * k; armR = 0.5 * k; break; }
      case 'squabble': armL = -2.0 + Math.sin(this.poseT * 16) * 0.6; armR = -2.0 - Math.sin(this.poseT * 16) * 0.6; bob = Math.abs(Math.sin(this.poseT * 12)) * 0.12; lean = 0.15; break;
      case 'reach': { const k = Math.sin(Math.min(1, this.poseT * 2.2) * Math.PI); armR = -1.35 - 0.2 * k; armL = -0.4; lean = 0.25 * k; if (m.reacher) m.reacher.scale.y = 1 + 0.6 * k; break; }
      case 'aim': armR = -1.55; armL = -1.2; spread = -0.1; lean = -0.05; bob = this.poseT < 0.08 ? 0.03 : 0; break;
      case 'shove': { const k = Math.min(1, this.poseT * 6); armL = -1.5 * k; armR = -1.2 * k; lean = 0.35 * k; legA = 0.4 * k; break; }
      case 'trip': {
        const t = this.poseT;
        if (t < 0.25) lean = (t / 0.25) * 1.45;
        else if (t < 1.4) lean = 1.45 + Math.sin(t * 20) * 0.02;
        else lean = Math.max(0, 1.45 * (1 - (t - 1.4) / 0.4));
        armL = armR = -2.6; legA = Math.sin(t * 25) * (t < 1.4 ? 0.3 : 0);
        break;
      }
      case 'flee': legA = s * 1.0; armL = -2.8 + Math.sin(this.phase * 1.3) * 0.4; armR = -2.8 - Math.sin(this.phase * 1.3) * 0.4; bob = Math.abs(s) * 0.12; break;
      case 'surprised': { const k = Math.max(0, 1 - this.poseT * 2); bob = Math.sin(Math.min(1, this.poseT * 4) * Math.PI) * 0.25; armL = armR = -2.6 * (0.4 + k * 0.6); spread = 0.6; break; }
      case 'oops': armL = armR = -2.9; spread = 0.5; bob = Math.abs(Math.sin(this.poseT * 18)) * 0.08; break;
      case 'shrug': armL = armR = -0.4; spread = 0.9 * Math.abs(Math.sin(this.poseT * 3)); break;
      case 'cheer': armL = armR = -2.7; spread = 0.2; bob = Math.abs(Math.sin(this.poseT * 9)) * 0.3; break;
      case 'wave': armR = -2.6 + Math.sin(this.poseT * 10) * 0.35; armRz = 0.5; armL = -0.1; break;
      case 'talk': armR = -0.9 + Math.sin(this.poseT * 5) * 0.4; armL = -0.4; bob = Math.abs(Math.sin(this.poseT * 7)) * 0.02 - 0.3; legA = -1.45; break;
      case 'throw': { const k = Math.min(1, this.poseT / 0.4); armR = k < 0.6 ? -2.8 * (k / 0.6) : -2.8 + (k - 0.6) * 5; lean = (k - 0.5) * 0.4; break; }
      case 'ready': armL = armR = -1.3; spread = 0.25; lean = 0.15; bob = -0.05; break;
      case 'catch': { const k = Math.max(0, 1 - this.poseT * 2.5); armL = armR = -1.5 - 0.3 * k; spread = 0.1; lean = -0.15 * k; break; }
      case 'shake': armL = armR = -1.4 + Math.sin(this.poseT * 18) * 0.3; lean = 0.35; break;
      case 'alarm': armL = -2.8 + Math.sin(this.poseT * 14) * 0.5; armR = -2.8 - Math.sin(this.poseT * 14) * 0.5; spread = 0.3; break;
      default: armL = armR = Math.sin(this.phase * 0.7) * 0.08; bob = Math.sin(this.phase) * 0.01;
    }
    m.legL.rotation.x = legA; m.legR.rotation.x = this.pose === 'kneel' ? -0.2 : -legA;
    m.armL.rotation.x = armL; m.armR.rotation.x = armR;
    m.armL.rotation.z = -spread; m.armR.rotation.z = spread + armRz;
    m.pivot.rotation.x = lean;
    m.pivot.position.y = bob;
    this.root.rotation.y = this.yaw;
    if (this.pose === 'dumbbell' && !m.bells) {
      m.bells = [m.armL, m.armR].map((a) => { const b = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: '#495057', metalness: 0.5 }); b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6).rotateZ(Math.PI / 2), mat)); for (const sx of [-0.1, 0.1]) b.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat).translateX(sx)); b.position.set(0, -0.28, 0); a.add(b); return b; });
    }
    if (m.bells) m.bells.forEach((b) => (b.visible = this.pose === 'dumbbell'));
    if (this.pose === 'kick') {
      if (!m.ball) { m.ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: ['#ff6b6b', '#4dabf7', '#ffd43b'][this.id % 3] })); m.ball.castShadow = true; this.game.scene.add(m.ball); }
      const k = (this.poseT * 4) % (Math.PI * 2), out = Math.max(0, Math.sin(k)) * 1.6;
      m.ball.visible = true;
      m.ball.position.set(this.pos.x + Math.sin(this.yaw) * (0.45 + out), 0.16 + Math.abs(Math.sin(k)) * 0.5, this.pos.z + Math.cos(this.yaw) * (0.45 + out));
    } else if (m.ball) m.ball.visible = false;
    if (this.pose === 'nap' && Math.floor(this.poseT / 1.6) !== this._zz) { this._zz = Math.floor(this.poseT / 1.6); if (this.poseT > 0.5) this.game.fx.floatObj(this.root, 'Zzz', '', 1.2); }
    if (m.basket) {
      // 背中のかご：持っている数に合わせて中のドミノが増える
      const cap = Math.max(1, this.capacity), k = Math.round((Math.min(this.load, cap) / cap) * m.basketFill.length);
      for (let i = 0; i < m.basketFill.length; i++) m.basketFill[i].visible = i < k;
    }
    if (m.levelTool) m.levelTool.visible = this.levelOn && (this.pose === 'place' || this.pose === 'idle');
    if (m.gun) { const push = this.game.defenseStyle === 'push'; m.gun.visible = !push; m.shield.visible = push; }
    const show = this.pose === 'trip' ? 0 : Math.min(this.load, 6);
    for (let i = 0; i < 6; i++) m.stack[i].visible = i < show;
  }

  dispose() {
    this.game.scene.remove(this.root);
    if (this.m.ball) this.game.scene.remove(this.m.ball);
    this.loose.forEach((d) => this.game.scene.remove(d));
  }
}

// goto に「走る」倍率を付けられるように拡張
Gnome.prototype.goto = function (targetFn, onArrive, runMult = 1) {
  this.arriveDist = 0;
  this.state = 'walk'; this.targetFn = targetFn; this.onArrive = onArrive; this.runMult = runMult;
};

export class Workers {
  constructor(game) { this.game = game; this.list = []; this.nextId = 1; }
  count(role) { return this.list.filter((g) => g.role === role).length; }
  hire(role, quiet = false) {
    const g = this.game;
    const dep = g.depots[0];
    const spawn = role === 'soldier' ? g.soldierPost(this.count('soldier')) : g.campPos(role) || ((role === 'guard' || role === 'restorer') && g.hqPos ? g.hqPos.clone() : dep.pos.clone());
    spawn.x += (Math.random() - 0.5) * 2; spawn.z += 2 + Math.random() * 1.5;
    const gn = new Gnome(role, this.nextId++, g, spawn);
    if (role === 'guard') gn.home = g.guardPost(this.count('guard'));
    if (role === 'soldier') gn.home = spawn.clone();
    if (!quiet) { const s = SAY[role]; gn.say(s[Math.floor(Math.random() * s.length)]); }
    this.list.push(gn);
    g.addWorkerGrab && g.addWorkerGrab(gn);
    return gn;
  }
  update(dt) { for (const gn of this.list) gn.update(dt); }
  inHands() { return this.list.reduce((a, g) => a + g.load, 0); }
  refreshLooks() { this.list.forEach((g) => g.applyLooks()); }
  clear() { this.list.forEach((g) => g.dispose()); this.list = []; }
}
