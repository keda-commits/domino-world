import * as THREE from 'three';
import { CFG } from '../config.js';
import { buildGnome, looseMats } from './gnomeModel.js';

const tmp = new THREE.Vector3();
const looseGeo = new THREE.BoxGeometry(CFG.dominoW, CFG.dominoT, CFG.dominoH);

const SAY = {
  builder: ['がんばるぞ！', 'まかせて！', 'ならべるよ〜'],
  carrier: ['はこぶよ！', 'よいしょ！'],
  collector: ['ひろうよ！', 'おかたづけ〜'],
  stopperCrew: ['ストッパーズ、着任！', '安全第一！', '事故ゼロ宣言！'],
  restorer: ['復旧はおまかせ！', '出動準備よし！'],
  guard: ['警備開始！', 'ルンバは通さない！'],
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
  }

  // ---------- 基本動作 ----------
  goto(targetFn, onArrive) { this.state = 'walk'; this.targetFn = targetFn; this.onArrive = onArrive; }
  act(time, pose, onDone) { this.state = 'act'; this.timer = time; this.pose = pose; this.poseT = 0; this.onDone = onDone; }
  wait(time, pose = 'idle') { this.act(time, pose, () => this.think()); }
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
    // 倒れたドミノの立て直し（建設がない時も）
    if (this.load === 0) {
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
      if (g.unbuiltCount() === 0) { g.returnToStock(this.load); this.load = 0; }
      return this.wait(0.6);
    }
    this.job = slot;
    this.goto(() => g.sideOf(slot, this.side, tmp), () => {
      if (slot.domino || slot.claim !== this.id) { this.releaseJob(); return this.think(); }
      this.face(slot);
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

  doRestand(d) {
    const g = this.game;
    this.job = d;
    const fast = this.role === 'restorer' ? (g.evolved('stopperHQ') ? 2.6 : 1.6) : 1;
    this.goto(() => g.sideOf(d.slot, this.side, tmp), () => {
      if (d.removed || d.claim !== this.id) { this.releaseJob(); return this.think(); }
      this.face(d.slot);
      this.act(CFG.restandTime / (this.speed * fast), 'pick', () => {
        this.releaseJob();
        g.restand(d, this);
        if (this.role === 'restorer' && Math.random() < 0.15) this.say('復旧完了！');
        this.think();
      });
    });
  }

  // ---------- 運搬小人 ----------
  thinkCarrier() {
    const g = this.game;
    if (this.load === 0) {
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
      if (this.load > 0 && g.unbuiltCount() === 0) { g.returnToStock(this.load); this.load = 0; }
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

  // ---------- 更新 ----------
  update(dt) {
    const g = this.game;
    this.walking = false;
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
        const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const step = CFG.walkSpeed * this.speed * (this.runMult || 1) * dt;
        if (d <= Math.max(0.08, step)) {
          this.pos.x = tgt.x; this.pos.z = tgt.z;
          const cb = this.onArrive; this.onArrive = null; this.runMult = 1;
          cb();
        } else {
          this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
          this.turnTo(Math.atan2(dx, dz), dt);
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
        this.pos.x += this.fleeDir.x * sp; this.pos.z += this.fleeDir.z * sp;
        g.clampToStage(this.pos);
        this.turnTo(Math.atan2(this.fleeDir.x, this.fleeDir.z), dt * 2);
        this.walking = true;
        if (this.timer <= 0) this.act(0.5, 'surprised', () => this.think());
        break;
      }
    }
    this.pos.y = g.stage.heightAt(this.pos.x, this.pos.z);
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
      case 'place': { const k = Math.sin(Math.min(1, this.poseT * this.speed / CFG.placeTime) * Math.PI); lean = 0.75 * k; armL = armR = -1.25 + 0.75 * k; break; }
      case 'pick': { const k = Math.sin(Math.min(1, this.poseT * 2.5) * Math.PI); lean = 0.8 * k; armL = armR = -0.6 * k - 0.2; break; }
      case 'kneel': { const k = Math.min(1, this.poseT * 4); lean = 0.6 * k; bob = -0.12 * k; legA = 0.9 * k; armL = armR = -1.0; break; }
      case 'salute': armR = -2.5; armRz = 0.9; armL = 0.05; bob = 0.02; break;
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
      case 'alarm': armL = -2.8 + Math.sin(this.poseT * 14) * 0.5; armR = -2.8 - Math.sin(this.poseT * 14) * 0.5; spread = 0.3; break;
      default: armL = armR = Math.sin(this.phase * 0.7) * 0.08; bob = Math.sin(this.phase) * 0.01;
    }
    m.legL.rotation.x = legA; m.legR.rotation.x = this.pose === 'kneel' ? -0.2 : -legA;
    m.armL.rotation.x = armL; m.armR.rotation.x = armR;
    m.armL.rotation.z = -spread; m.armR.rotation.z = spread + armRz;
    m.pivot.rotation.x = lean;
    m.pivot.position.y = bob;
    this.root.rotation.y = this.yaw;
    const show = this.pose === 'trip' ? 0 : Math.min(this.load, 6);
    for (let i = 0; i < 6; i++) m.stack[i].visible = i < show;
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.loose.forEach((d) => this.game.scene.remove(d));
  }
}

// goto に「走る」倍率を付けられるように拡張
Gnome.prototype.goto = function (targetFn, onArrive, runMult = 1) {
  this.state = 'walk'; this.targetFn = targetFn; this.onArrive = onArrive; this.runMult = runMult;
};

export class Workers {
  constructor(game) { this.game = game; this.list = []; this.nextId = 1; }
  count(role) { return this.list.filter((g) => g.role === role).length; }
  hire(role, quiet = false) {
    const g = this.game;
    const dep = g.depots[0];
    const spawn = (role === 'guard' || role === 'restorer') && g.hqPos ? g.hqPos.clone() : dep.pos.clone();
    spawn.x += (Math.random() - 0.5) * 2; spawn.z += 2 + Math.random() * 1.5;
    const gn = new Gnome(role, this.nextId++, g, spawn);
    if (role === 'guard') gn.home = g.guardPost(this.count('guard'));
    if (!quiet) { const s = SAY[role]; gn.say(s[Math.floor(Math.random() * s.length)]); }
    this.list.push(gn);
    return gn;
  }
  update(dt) { for (const gn of this.list) gn.update(dt); }
  inHands() { return this.list.reduce((a, g) => a + g.load, 0); }
  refreshLooks() { this.list.forEach((g) => g.applyLooks()); }
  clear() { this.list.forEach((g) => g.dispose()); this.list = []; }
}
