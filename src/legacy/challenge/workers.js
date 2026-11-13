import * as THREE from 'three';
import { CFG } from './config.js';
import { buildGnome, looseGeo, looseMats } from './gnomeModel.js';
import { cap } from './upgrades.js';
import { CLAIM_COLLECT, CLAIM_REPAIR } from './field.js';

const tmp = new THREE.Vector3();

/**
 * 小人1人。役割ごとの思考 (think) と、歩く・作業する・転ぶ・逃げるの
 * 状態機械を持つ。見た目のアニメーションも状態から決まる。
 */
export class Gnome {
  constructor(role, id, game, spawn) {
    this.role = role;
    this.id = id;
    this.game = game;
    this.m = buildGnome(role);
    this.root = this.m.root;
    this.pos = this.root.position;
    this.pos.copy(spawn);
    this.yaw = Math.random() * Math.PI * 2;
    this.speedVar = 0.88 + Math.random() * 0.24;
    this.phase = Math.random() * 10;
    this.load = 0;
    this.job = null;
    this.jobType = 0;
    this.pose = 'idle';
    this.poseT = 0;
    this.state = 'act';
    this.timer = 0.6;
    this.onDone = () => this.think();
    this.targetFn = null;
    this.onArrive = null;
    this.fleeAfter = false;
    this.loose = [];
    this.walking = false;
    this.sideOff = role === 'builder' ? 0.7 + (id % 3) * 0.3 : 0.7;
    this.pose = 'cheer';
    game.scene.add(this.root);
  }

  get capacity() { return cap(this.role, this.game.levels.basket); }

  // ---------- 基本動作 ----------
  goto(targetFn, onArrive) {
    this.state = 'walk';
    this.targetFn = targetFn;
    this.onArrive = onArrive;
  }
  act(time, pose, onDone) {
    this.state = 'act';
    this.timer = time;
    this.pose = pose;
    this.poseT = 0;
    this.onDone = onDone;
  }
  wait(time) { this.act(time, 'idle', () => this.think()); }

  releaseJob() {
    if (this.job == null) return;
    const f = this.game.field;
    const s = f.slot(this.job);
    if (f.abs[s] === this.job && (f.claim[s] === CLAIM_COLLECT || f.claim[s] === CLAIM_REPAIR)) f.claim[s] = 0;
    this.job = null;
  }

  // ---------- 思考 ----------
  think() {
    this.pose = 'idle';
    if (this.role === 'builder') this.thinkBuilder();
    else if (this.role === 'carrier') this.thinkCarrier();
    else this.thinkCollector();
  }

  thinkBuilder() {
    const g = this.game;
    const rep = g.findRepairJob(this.pos);
    if (rep != null) {
      this.job = rep;
      this.goto(() => g.route.side(rep, 0.65, tmp), () => {
        this.faceSlot(rep);
        this.act(CFG.repairTime / g.workMult(), 'pick', () => {
          g.finishRepair(rep, this);
          this.job = null;
          this.afterWork();
        });
      });
      return;
    }
    if (this.load === 0) {
      if (g.crate.count > 0) {
        this.goto(() => g.crate.spot(this.id, tmp), () => {
          const take = Math.min(this.capacity, g.crate.count);
          if (take <= 0) return this.wait(0.2);
          g.crate.count -= take;
          this.load += take;
          this.act(CFG.pickTime / g.workMult(), 'pick', () => this.think());
        });
      } else if (g.stock > 0) {
        const chest = g.nearestChest(this.pos);
        this.goto(() => chest.spot, () => {
          const take = Math.min(this.capacity, g.stock);
          if (take <= 0) return this.wait(0.3);
          g.stock -= take;
          this.load += take;
          this.act(CFG.pickTime / g.workMult(), 'pick', () => this.think());
        });
      } else {
        if (Math.random() < 0.15) g.fx.floatObj(this.root, '在庫切れ…', 'warn', 1.2);
        this.act(1.2, 'shrug', () => this.think());
      }
      return;
    }
    if (g.canBuild()) {
      this.goto(() => g.frontSpot(this, tmp), () => {
        if (!g.canBuild()) return this.wait(0.3);
        const idx = g.claimBuild();
        this.job = idx;
        g.route.side(idx, this.sideOff, this.pos);
        this.faceSlot(idx);
        this.act(CFG.placeTime / g.workMult(), 'place', () => {
          this.job = null;
          this.load--;
          g.finishPlace(idx, this);
          this.afterWork();
        });
      });
      return;
    }
    this.wait(0.4);
  }

  afterWork() {
    if (this.fleeAfter && this.game.wavePos) { this.fleeAfter = false; this.startFlee(this.game.wavePos); return; }
    this.fleeAfter = false;
    if (this.state === 'act' && this.pose === 'oops') return; // うっかり演出中
    this.think();
  }

  thinkCarrier() {
    const g = this.game;
    if (this.load === 0) {
      if (g.stock > 0 && g.crate.count < g.crate.cap) {
        const chest = g.nearestChest(g.crate.pos);
        this.goto(() => chest.spot, () => {
          const take = Math.min(this.capacity, g.stock);
          if (take <= 0) return this.wait(0.5);
          g.stock -= take;
          this.load += take;
          this.act(CFG.pickTime / g.workMult(), 'pick', () => this.think());
        });
      } else {
        this.act(1.0, g.stock <= 0 ? 'shrug' : 'idle', () => this.think());
      }
      return;
    }
    this.goto(() => g.crate.spot(this.id + 7, tmp), () => {
      if (g.crate.count >= g.crate.cap) return this.act(0.8, 'idle', () => this.think());
      const put = Math.min(this.load, g.crate.cap - g.crate.count);
      g.crate.count += put;
      this.load -= put;
      g.audio.drop();
      this.act(CFG.pickTime / g.workMult(), 'pick', () => this.think());
    });
  }

  thinkCollector() {
    const g = this.game;
    if (this.load < this.capacity) {
      const job = g.findCollectJob(this.pos, this.load > 0 ? 9 : Infinity);
      if (job != null) {
        this.job = job;
        this.goto(() => g.route.side(job, -0.6, tmp), () => {
          this.faceSlot(job);
          if (g.field.pickUp(job)) {
            this.job = null;
            this.load++;
            g.audio.pick();
            this.act(CFG.pickTime / g.workMult(), 'pick', () => this.think());
          } else {
            this.job = null;
            this.think();
          }
        });
        return;
      }
    }
    if (this.load > 0) {
      const chest = g.nearestChest(this.pos);
      this.goto(() => chest.spot, () => {
        g.stock += this.load;
        g.stats.recycled += this.load;
        this.load = 0;
        g.audio.drop();
        this.act(0.3 / g.workMult(), 'pick', () => this.think());
      });
      return;
    }
    this.act(0.8 + Math.random() * 0.6, 'idle', () => this.think());
  }

  faceSlot(idx) {
    const p = this.game.route.point(idx, tmp);
    this.yaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  // ---------- ハプニング ----------
  trip() {
    const g = this.game;
    if (this.state === 'trip' || this.loose.length) return;
    this.releaseJob();
    this.state = 'trip';
    this.timer = 1.8;
    this.pose = 'trip';
    this.poseT = 0;
    g.stats.trips++;
    g.audio.squeak(1);
    g.fx.floatObj(this.root, '💫', 'icon', 1.6);
    if (this.load > 0) {
      g.fx.floatObj(this.root, 'ドミノを落とした！', 'warn', 1.4, 0.4);
      const n = Math.min(this.load, 5);
      for (let i = 0; i < n; i++) {
        const d = new THREE.Mesh(looseGeo, looseMats[i % looseMats.length]);
        const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.6;
        d.position.set(this.pos.x + Math.cos(a) * r, CFG.dominoT / 2, this.pos.z + Math.sin(a) * r);
        d.rotation.y = Math.random() * Math.PI;
        d.castShadow = true;
        g.scene.add(d);
        this.loose.push(d);
      }
    }
  }

  oops() {
    // 自分でドミノを倒してしまった
    this.state = 'act';
    this.pose = 'oops';
    this.poseT = 0;
    this.timer = 1.1;
    this.onDone = () => this.think();
    this.game.fx.floatObj(this.root, 'あっ！', 'warn', 1.2);
  }

  startFlee(from) {
    this.releaseJob();
    this.state = 'flee';
    this.timer = 0.9;
    this.pose = 'flee';
    tmp.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (tmp.lengthSq() < 0.01) tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    tmp.normalize();
    this.fleeDir = tmp.clone();
    this.game.stats.flees++;
    this.game.fx.floatObj(this.root, '！', 'big', 0.9);
    if (Math.random() < 0.5) this.game.audio.squeak(1.6);
  }

  // ---------- 更新 ----------
  update(dt) {
    const g = this.game;
    const mult = g.workMult();
    this.walking = false;

    // 連鎖が迫ったら慌てて逃げる
    if (g.wavePos && this.state !== 'trip' && this.state !== 'flee') {
      const dx = this.pos.x - g.wavePos.x, dz = this.pos.z - g.wavePos.z;
      if (dx * dx + dz * dz < CFG.fleeDistance * CFG.fleeDistance) {
        if (this.state === 'act' && (this.pose === 'place' || this.pose === 'pick')) this.fleeAfter = true;
        else this.startFlee(g.wavePos);
      }
    }

    switch (this.state) {
      case 'walk': {
        const tgt = this.targetFn();
        const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        const step = CFG.walkSpeed * mult * this.speedVar * dt;
        if (d <= Math.max(0.08, step)) {
          this.pos.x = tgt.x; this.pos.z = tgt.z;
          const cb = this.onArrive;
          this.onArrive = null;
          cb();
        } else {
          this.pos.x += (dx / d) * step;
          this.pos.z += (dz / d) * step;
          this.turnTo(Math.atan2(dx, dz), dt);
          this.walking = true;
          this.pose = this.load > 0 ? 'carry' : 'walk';
          // つまずき（長い移動中だけ、たまに）
          const od = g.odTime > 0 ? 1.5 : 1;
          if (d > 1.5 && Math.random() < CFG.tripChancePerSec * od * dt) this.trip();
        }
        break;
      }
      case 'act':
        this.timer -= dt;
        if (this.timer <= 0) { const cb = this.onDone; this.onDone = null; if (cb) cb(); else this.think(); }
        break;
      case 'trip':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.loose.length) {
            this.act(1.0, 'pick', () => {
              this.loose.forEach((d) => g.scene.remove(d));
              this.loose.length = 0;
              this.think();
            });
          } else this.think();
        }
        break;
      case 'flee': {
        this.timer -= dt;
        const sp = CFG.walkSpeed * 1.7 * dt;
        this.pos.x += this.fleeDir.x * sp;
        this.pos.z += this.fleeDir.z * sp;
        this.turnTo(Math.atan2(this.fleeDir.x, this.fleeDir.z), dt * 2);
        this.walking = true;
        if (this.timer <= 0) this.act(0.35, 'idle', () => this.think());
        break;
      }
    }
    this.animate(dt, mult);
  }

  turnTo(target, dt) {
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 12);
  }

  animate(dt, mult) {
    const m = this.m;
    this.poseT += dt;
    const animSpeed = this.state === 'flee' ? 2.2 : mult * this.speedVar;
    this.phase += dt * (this.walking ? 11 : 3) * animSpeed;
    const s = Math.sin(this.phase);
    let legA = 0, armL = 0, armR = 0, lean = 0, bob = 0, armSpread = 0;
    const lerp = (a, b, t) => a + (b - a) * t;
    switch (this.pose) {
      case 'walk':
        legA = s * 0.7; armL = -s * 0.6; armR = s * 0.6; bob = Math.abs(s) * 0.05; break;
      case 'carry':
        legA = s * 0.6; armL = armR = -1.25; bob = Math.abs(s) * 0.04; break;
      case 'place': {
        const k = Math.sin(Math.min(1, this.poseT * mult / CFG.placeTime) * Math.PI);
        lean = 0.75 * k; armL = armR = lerp(-1.25, -0.5, k); break;
      }
      case 'pick': {
        const k = Math.sin(Math.min(1, this.poseT * 2.5) * Math.PI);
        lean = 0.8 * k; armL = armR = -0.6 * k - 0.2; break;
      }
      case 'trip': {
        const t = this.poseT;
        if (t < 0.25) lean = (t / 0.25) * 1.45;
        else if (t < 1.4) lean = 1.45 + Math.sin(t * 20) * 0.02;
        else lean = Math.max(0, 1.45 * (1 - (t - 1.4) / 0.4));
        armL = armR = -2.6; legA = Math.sin(t * 25) * (t < 1.4 ? 0.3 : 0);
        break;
      }
      case 'flee':
        legA = s * 1.0; armL = -2.8 + Math.sin(this.phase * 1.3) * 0.4; armR = -2.8 - Math.sin(this.phase * 1.3) * 0.4; bob = Math.abs(s) * 0.12; break;
      case 'oops':
        armL = armR = -2.9; armSpread = 0.5; bob = Math.abs(Math.sin(this.poseT * 18)) * 0.08; break;
      case 'shrug':
        armL = armR = -0.4; armSpread = 0.9 * Math.abs(Math.sin(this.poseT * 3)); break;
      case 'cheer':
        armL = armR = -2.7; bob = Math.abs(Math.sin(this.poseT * 9)) * 0.3; break;
      default:
        armL = armR = Math.sin(this.phase * 0.7) * 0.08; bob = Math.sin(this.phase) * 0.01;
    }
    m.legL.rotation.x = legA;
    m.legR.rotation.x = -legA;
    m.armL.rotation.x = armL;
    m.armR.rotation.x = armR;
    m.armL.rotation.z = -armSpread;
    m.armR.rotation.z = armSpread;
    m.pivot.rotation.x = lean;
    m.pivot.position.y = bob;
    this.root.rotation.y = this.yaw;
    const show = this.pose === 'trip' ? 0 : Math.min(this.load, 5);
    for (let i = 0; i < 5; i++) m.stack[i].visible = i < show;
    m.carry.position.z = this.pose === 'carry' ? 0.3 : 0.24;
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.loose.forEach((d) => this.game.scene.remove(d));
  }
}

export class Workers {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.nextId = 0;
  }
  count(role) { return this.list.filter((g) => g.role === role).length; }
  hire(role, quiet = false) {
    const g = this.game;
    const chest = g.nearestChest(g.route.point(g.buildPtr));
    const spawn = chest.spot.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5));
    const gn = new Gnome(role, this.nextId++, g, spawn);
    if (!quiet) g.fx.floatObj(gn.root, role === 'builder' ? 'がんばるぞ！' : role === 'carrier' ? 'はこぶよ！' : 'ひろうよ！', '', 1.5);
    this.list.push(gn);
    return gn;
  }
  update(dt) { for (const gn of this.list) gn.update(dt); }
  /** 手に持っている・落としたドミノの合計（在庫の整合チェック用） */
  inHands() { return this.list.reduce((a, g) => a + g.load, 0); }
}
