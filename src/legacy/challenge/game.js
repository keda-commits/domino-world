import * as THREE from 'three';
import { CFG } from './config.js';
import { buildRoute, buildRouteRibbon } from './route.js';
import { DominoField, STANDING, FALLEN, CLAIM_PLACE, CLAIM_COLLECT, CLAIM_REPAIR } from './field.js';
import { buildChests, Crate, Machine, Factory } from './facilities.js';
import { Workers } from './workers.js';
import { UPGRADES, costOf, speedMult, machineRate } from './upgrades.js';

const ROLES = ['builder', 'carrier', 'collector'];

/**
 * ゲーム全体の状態とルール。
 * - head: 次に倒れる（または次の連鎖が始まる）絶対インデックス
 * - buildPtr: 次に建設するスロットの絶対インデックス
 * 立っているドミノは必ず [head, buildPtr) の中にある。
 */
export class Game {
  constructor({ scene, fx, audio }) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.route = buildRoute(CFG.spacing);
    scene.add(buildRouteRibbon(this.route));
    this.field = new DominoField(this.route, scene);
    this.chests = buildChests(scene, this.route);
    this.crate = new Crate(scene);
    this.machine = new Machine(scene);
    this.factory = new Factory(scene);
    this.workers = new Workers(this);
    this.marker = this.buildMarker();
    this.simTime = 0;
    this.listeners = {};
    this.reset();
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach((f) => f(data)); }

  reset() {
    this.coins = CFG.startCoins;
    this.stock = CFG.startStock;
    this.levels = { builder: 0, carrier: 0, collector: 0, speed: 0, basket: 0, machine: 0, factory: 0 };
    this.energy = 0;
    this.odTime = 0;
    this.contUnlocked = false;
    this.stats = {
      best: 0, bestCont: 0, toppled: 0, distance: 0, chains: 0, placed: 0, recycled: 0,
      produced: 0, bought: 0, trips: 0, flees: 0, accidents: 0, overdrives: 0, owned: CFG.startStock, manualCollected: 0,
    };
    this.head = 0;
    this.buildPtr = 0;
    this.chain = { active: false, count: 0, rate: 0, mode: 'normal' };
    this.lastChain = null;
    this.minis = [];
    this.placeTimes = [];
    this.wavePos = null;
    this.field.clearAll();
    this.crate.count = 0;
    this.machine.hopper = 0;
    this.workers.list.forEach((g) => g.dispose());
    this.workers.list = [];
    const p = this.route.side(10, 2.8);
    this.crate.pos.copy(p);
    this.machine.pos.copy(this.route.side(0, -1.5));
  }

  // ---------------- 係数 ----------------
  odMult() { return this.odTime > 0 ? CFG.overdriveMult : 1; }
  workMult() { return speedMult(this.levels.speed) * this.odMult(); }

  // ---------------- 建設 ----------------
  canBuild() { return this.buildPtr - this.head < this.route.length - 6; }
  claimBuild() {
    const idx = this.buildPtr++;
    this.field.claim[this.field.slot(idx)] = CLAIM_PLACE;
    return idx;
  }
  finishPlace(idx, gnome) {
    const rec = this.field.place(idx);
    if (rec) { this.stock += rec; this.stats.recycled += rec; }
    this.stats.placed++;
    this.placeTimes.push(this.simTime);
    if (!this._lastPlaceSnd || this.simTime - this._lastPlaceSnd > 0.07) { this.audio.place(); this._lastPlaceSnd = this.simTime; }
    if (gnome && this.stats.placed > 40) {
      const p = CFG.accidentChance * (this.odTime > 0 ? 2 : 1);
      if (Math.random() < p) this.accident(idx, gnome);
    }
  }
  frontSpot(gnome, out) { return this.route.side(this.buildPtr + (gnome.id % 3), gnome.sideOff, out); }

  manualPlace() {
    if (this.stock <= 0) { this.audio.deny(); this.fx.floatAt(this.route.point(this.buildPtr).setY(1), '在庫がない！', 'warn', 1.2); return false; }
    if (!this.canBuild()) { this.audio.deny(); return false; }
    this.stock--;
    const idx = this.claimBuild();
    this.finishPlace(idx, null);
    return true;
  }

  /** クリック地点の近くの倒れたドミノを手で拾う */
  manualCollect(point) {
    const f = this.field, L = this.route.length;
    const limit = this.chain.active ? this.chain.next - 4 : this.head;
    const found = [];
    for (let s = 0; s < L; s++) {
      if (f.state[s] !== FALLEN || f.abs[s] >= limit) continue;
      const dx = this.route.pos[s * 3] - point.x, dz = this.route.pos[s * 3 + 2] - point.z;
      const d = dx * dx + dz * dz;
      if (d < 4 * 4) found.push([d, f.abs[s]]);
    }
    found.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, abs] of found.slice(0, 20)) if (f.pickUp(abs)) n++;
    if (n > 0) {
      this.stock += n;
      this.stats.recycled += n;
      this.stats.manualCollected += n;
      this.fx.floatAt(point.clone().setY(1), `+${n} 回収`, 'coin', 1.1);
      this.audio.pick();
    }
    return n;
  }

  findRepairJob(pos) {
    const f = this.field;
    let best = null, bd = Infinity;
    const end = Math.min(this.buildPtr, this.head + this.route.length);
    for (let a = this.head; a < end; a++) {
      const s = f.slot(a);
      if (f.abs[s] !== a || f.state[s] !== FALLEN || f.claim[s] !== 0) continue;
      const dx = this.route.pos[s * 3] - pos.x, dz = this.route.pos[s * 3 + 2] - pos.z;
      const d = dx * dx + dz * dz + (a - this.head) * 0.5; // 波に近いほど優先
      if (d < bd) { bd = d; best = a; }
    }
    if (best != null) f.claim[f.slot(best)] = CLAIM_REPAIR;
    return best;
  }
  finishRepair(abs) {
    if (this.field.stand(abs)) {
      this.audio.place();
      if (Math.random() < 0.3) this.fx.floatAt(this.route.point(abs).setY(1.2), 'よいしょ', '', 0.9);
    }
  }

  findCollectJob(pos, maxDist = Infinity) {
    const f = this.field, L = this.route.length;
    const limit = this.chain.active ? this.chain.next - 6 : this.head;
    let best = -1, bd = maxDist * maxDist;
    for (let s = 0; s < L; s++) {
      if (f.state[s] !== FALLEN || f.claim[s] !== 0 || f.abs[s] >= limit) continue;
      const dx = this.route.pos[s * 3] - pos.x, dz = this.route.pos[s * 3 + 2] - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
    if (best < 0) return null;
    f.claim[best] = CLAIM_COLLECT;
    return f.abs[best];
  }

  nearestChest(pos) {
    let best = this.chests[0], bd = Infinity;
    for (const c of this.chests) { const d = c.pos.distanceToSquared(pos); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  // ---------------- 小人のうっかり ----------------
  accident(idx, gnome) {
    const back = Math.random() < 0.7;
    const dir = back ? -1 : 1;
    this.minis.push({ next: idx, dir, left: 4 + Math.floor(Math.random() * 10), timer: 1, count: 0 });
    this.stats.accidents++;
    gnome.oops();
    this.audio.oops();
    this.fx.floatAt(this.route.point(idx).setY(1.6), 'うっかり！予定外の連鎖！', 'warn', 2.0, 1.2);
  }

  updateMinis(dt) {
    const f = this.field;
    for (let i = this.minis.length - 1; i >= 0; i--) {
      const w = this.minis[i];
      w.timer += dt * 8;
      let done = false;
      while (w.timer >= 1 && !done) {
        w.timer -= 1;
        const idx = w.next;
        if (w.left > 0 && f.isStanding(idx)) {
          f.topple(idx, w.dir, 0.3, CFG.restAngle);
          this.audio.click(1.2);
          this.coins += 0.3;
          w.count++;
          w.left--;
          w.next += w.dir;
        } else {
          f.setTarget(w.next - w.dir, CFG.flatAngle);
          if (w.left <= 0 && f.isStanding(idx)) {
            this.fx.floatAt(this.route.point(idx).setY(1.3), 'キャッチ！', 'coin', 1.4);
            this.audio.close();
          }
          if (w.count >= 3) this.fx.floatAt(this.route.point(idx).setY(1.0), `ハプニング ${w.count}個`, '', 1.4);
          done = true;
        }
      }
      if (done) this.minis.splice(i, 1);
    }
  }

  // ---------------- 連鎖 ----------------
  canStart() {
    if (this.chain.active) return false;
    return this.firstStanding() != null;
  }
  firstStanding() {
    for (let a = this.head; a < this.buildPtr; a++) if (this.field.isStanding(a)) return a;
    return null;
  }
  startChain(mode = 'normal') {
    if (this.chain.active) return false;
    if (mode === 'cont' && !this.contUnlocked) return false;
    const first = this.firstStanding();
    if (first == null) { this.audio.deny(); return false; }
    this.head = first; // 先頭より前の立て直し待ちはあきらめる
    this.chain = {
      active: true, mode, count: 0, next: first, timer: 0, elapsed: 0, grace: 0,
      rate: mode === 'cont' ? CFG.contStartRate : CFG.normalFallRate, coins: 0, pending: 0, mi: 0, saves: 0,
    };
    this.chain.timer = 1 / this.chain.rate;
    this.stats.chains++;
    this.audio.start();
    this.emit('chainStart', mode);
    return true;
  }

  updateChain(dt) {
    const c = this.chain;
    if (!c.active) return;
    c.elapsed += dt;
    if (c.mode === 'cont') c.rate = Math.min(CFG.contMaxRate, CFG.contStartRate + CFG.contAccel * c.elapsed + CFG.contAccel2 * c.elapsed * c.elapsed);
    else c.rate = Math.min(CFG.normalFallMax, CFG.normalFallRate + c.count * CFG.normalFallAccel);
    const interval = 1 / c.rate;
    c.timer += dt;
    let guard = 0;
    while (c.timer >= interval && guard++ < 50) {
      const idx = c.next;
      if (this.field.isStanding(idx)) {
        c.timer -= interval;
        if (c.grace > 0.1) {
          c.saves++;
          this.coins += 5;
          this.fx.floatAt(this.route.point(idx).setY(1.8), 'ギリギリセーフ！', 'big', 1.3);
          this.audio.close();
        }
        c.grace = 0;
        this.toppleMain(idx);
        c.next++;
        this.head = c.next;
      } else if (this.field.isClaimedPlace(idx) && c.grace < CFG.graceTime) {
        c.grace += dt;
        c.timer = interval;
        break;
      } else {
        this.endChain();
        break;
      }
    }
    if (c.timer > interval * 3) c.timer = interval * 3;
  }

  toppleMain(idx) {
    const c = this.chain;
    const cont = c.mode === 'cont';
    const dur = Math.max(0.22, Math.min(0.6, 2.2 / c.rate));
    this.field.topple(idx, 1, dur, CFG.restAngle);
    c.count++;
    const mult = 1 + Math.sqrt(c.count) * (cont ? CFG.comboCont : CFG.comboNormal);
    const gain = (cont ? CFG.coinCont : CFG.coinNormal) * mult;
    this.coins += gain;
    c.coins += gain;
    c.pending += gain;
    // 連続運転では転倒が速いほど1個あたりの充填量を減らす（約2.5/秒が上限）
    this.energy = Math.min(CFG.energyMax, this.energy + (cont ? Math.min(1, 2.5 / c.rate) : 1));
    this.stats.toppled++;
    this.stats.distance++;
    this.audio.click(1 + Math.min(0.6, c.count / 600));
    if (c.count % 10 === 0) {
      this.fx.floatAt(this.route.point(idx).setY(1.2), `+${Math.round(c.pending)}`, 'coin', 1.0);
      c.pending = 0;
      if (c.count % 30 === 0) this.audio.coin();
    }
    const ms = CFG.milestones[c.mi];
    if (ms && c.count >= ms) {
      c.mi++;
      const bonus = ms * (cont ? 2 : 1);
      this.coins += bonus;
      c.coins += bonus;
      const p = this.route.point(idx);
      this.fx.floatAt(p.clone().setY(2.5), `${ms}連鎖！ ボーナス +${bonus}`, 'big', 2.2, 2);
      this.fx.confetti(p, 80, 7);
      this.audio.milestone();
    }
  }

  endChain() {
    const c = this.chain;
    c.active = false;
    this.head = c.next;
    this.field.setTarget(c.next - 1, CFG.flatAngle);
    if (c.count > this.stats.best) this.stats.best = c.count;
    if (c.mode === 'cont' && c.count > this.stats.bestCont) this.stats.bestCont = c.count;
    this.lastChain = { count: c.count, coins: c.coins, mode: c.mode, caught: this.buildPtr <= c.next + 1 };
    this.wavePos = null;
    this.audio.end();
    this.emit('chainEnd', this.lastChain);
  }

  // ---------------- オーバードライブ ----------------
  canOverdrive() { return this.energy >= CFG.energyMax && this.odTime <= 0; }
  activateOverdrive() {
    if (!this.canOverdrive()) { this.audio.deny(); return false; }
    this.energy = 0;
    this.odTime = CFG.overdriveTime;
    this.stats.overdrives++;
    this.audio.overdrive();
    this.fx.confetti(this.route.point(this.buildPtr), 60, 6);
    this.emit('overdrive', true);
    return true;
  }

  // ---------------- ショップ ----------------
  upgradeCost(id) { return costOf(id, this.levels[id]); }
  canBuy(id) {
    const u = UPGRADES.find((x) => x.id === id);
    return this.levels[id] < u.max && this.coins >= this.upgradeCost(id);
  }
  buy(id) {
    if (!this.canBuy(id)) { this.audio.deny(); return false; }
    this.coins -= this.upgradeCost(id);
    this.levels[id]++;
    if (ROLES.includes(id)) this.workers.hire(id);
    if (id === 'machine' && this.levels.machine === 1) {
      this.machine.pos.copy(this.route.side(this.buildPtr, -1.5));
      this.fx.floatAt(this.machine.pos.clone().setY(3), '自動設置機 稼働！', 'big', 2.2);
      this.fx.confetti(this.machine.pos, 60, 6);
    }
    this.audio.buy();
    this.checkUnlock();
    return true;
  }
  buy10() {
    if (this.coins < CFG.buy10Cost) { this.audio.deny(); return false; }
    this.coins -= CFG.buy10Cost;
    this.stock += 10;
    this.stats.bought += 10;
    this.stats.owned += 10;
    this.audio.buy();
    return true;
  }
  checkUnlock() {
    const u = CFG.contUnlock;
    if (!this.contUnlocked && this.levels.builder >= u.builder && this.levels.carrier >= u.carrier && this.levels.collector >= u.collector) {
      this.contUnlocked = true;
      this.emit('unlock', 'cont');
    }
  }

  // ---------------- 集計 ----------------
  buildRate() {
    const win = 4;
    while (this.placeTimes.length && this.placeTimes[0] < this.simTime - win) this.placeTimes.shift();
    return this.placeTimes.length / Math.min(win, Math.max(0.5, this.simTime));
  }
  buffer() { return this.field.counts.standing; }
  /** 理論上の建設能力（個/秒）：表示とバランス確認用 */
  buildCapacity() { return machineRate(this.levels.machine) * this.odMult(); }
  totalDominoes() {
    const fc = this.field.counts;
    const loose = this.workers.inHands();
    return this.stock + this.crate.count + this.machine.hopper + loose + fc.standing + fc.falling + fc.fallen;
  }
  /** 在庫の整合チェック（テスト用） */
  audit() {
    const total = this.totalDominoes();
    const expect = this.stats.owned + this.stats.produced;
    return { total, expect, ok: total === expect };
  }

  // ---------------- 更新 ----------------
  update(dt) {
    this.simTime += dt;
    if (this.odTime > 0) {
      this.odTime -= dt;
      if (this.odTime <= 0) { this.odTime = 0; this.emit('overdrive', false); }
    }
    this.updateChain(dt);
    this.updateMinis(dt);
    this.wavePos = this.chain.active ? this.route.point(this.chain.next - 1) : null;
    this.workers.update(dt);
    this.crate.update(dt, this);
    this.machine.update(dt, this);
    this.factory.update(dt, this);
    this.field.update(dt);
    this.updateMarker(dt);
  }

  buildMarker() {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4), new THREE.MeshStandardMaterial({ color: '#ff3d7f', emissive: '#ff3d7f', emissiveIntensity: 0.4 }));
    cone.rotation.x = Math.PI;
    g.add(cone);
    this.scene.add(g);
    return g;
  }
  updateMarker() {
    const p = this.route.point(this.buildPtr);
    this.marker.position.set(p.x, 2.0 + Math.abs(Math.sin(this.simTime * 4)) * 0.4, p.z);
    this.marker.rotation.y += 0.05;
  }

  /** カメラ追尾の注目点 */
  focusPoint(out) {
    const L = this.route.length;
    if (this.chain.active) {
      const gap = this.buildPtr - this.chain.next;
      const ahead = Math.min(gap, 24) * 0.5;
      return this.route.point(this.chain.next + Math.round(ahead), out);
    }
    const back = Math.min(this.buildPtr - this.head, 16);
    return this.route.point(this.buildPtr - Math.round(back * 0.5) + (L * 0), out);
  }

  // ---------------- セーブ ----------------
  serialize() {
    return {
      v: 1,
      coins: this.coins,
      stock: this.totalDominoes(), // 場のドミノは片付けて在庫へ
      levels: this.levels,
      energy: this.energy,
      contUnlocked: this.contUnlocked,
      stats: this.stats,
    };
  }
  load(d) {
    if (!d || d.v !== 1) return false;
    this.coins = d.coins ?? 0;
    this.levels = { ...this.levels, ...(d.levels || {}) };
    this.energy = d.energy ?? 0;
    this.contUnlocked = !!d.contUnlocked;
    this.stats = { ...this.stats, ...(d.stats || {}) };
    this.stock = d.stock ?? CFG.startStock;
    // 保存時点の合計を新たな基準にする
    this.stats.owned = this.stock - this.stats.produced;
    for (const r of ROLES) for (let i = 0; i < this.levels[r]; i++) this.workers.hire(r, true);
    this.checkUnlock();
    return true;
  }
}
