import * as THREE from 'three';
import { CFG } from '../config.js';
import { Physics } from '../core/physics.js';
import { Dominoes } from '../core/dominoes.js';
import { Course } from '../core/course.js';
import { createStage, STAGES } from '../world/stages.js';
import {
  GoalBell, LauncherPiece, BridgePiece, Stopper, barricadeMesh, sensorMesh, bellPieceMesh, chestMesh,
  gachaMachineMesh, markerMesh, orbMesh, towerMesh, hqMesh, startPadMesh, piggyMesh,
} from '../world/devices.js';
import { Roomba } from '../world/roomba.js';
import { GoalMachine } from '../world/goalMachine.js';
import { Workers } from '../actors/workers.js';
import { Depot, Crate, Machine, Train, Factory } from './facilities.js';
import { PlanView } from './planView.js';
import { Progress, xpForRun } from './progress.js';
import { PARTS, EVOLUTIONS, CATEGORY } from '../data/parts.js';

const tmp = new THREE.Vector3();
const ROLE_PARTS = ['builder', 'carrier', 'collector', 'stopperCrew', 'restorer', 'guard'];
// 配置して使うパーツ：id -> 1レベルあたりの個数
const PLACEABLE = { minicar: 1, marble: 1, bridge: 1, bell: 1, barricade: 3, sensor: 2 };
export const PIECE_LABEL = { minicar: 'ミニカー発射台', marble: 'ビー玉スロープ', bridge: '高架橋', bell: '特殊ベル', barricade: 'バリケード', sensor: '接近センサー' };

/**
 * ゲーム全体。ステージ・物理・コース・小人・設備・連鎖・報酬をまとめる。
 * mode: 'build'（建設中） / 'run'（本番の連鎖中） / 'test'（区間テスト中）
 */
export class Game {
  constructor({ scene, fx, audio }) {
    this.scene = scene; this.fx = fx; this.audio = audio;
    this.progress = new Progress();
    this.listeners = {};
    this.records = { 1: { best: 0, cleared: false, attempts: 0 }, 2: { best: 0, cleared: false, attempts: 0 } };
    this.stats = { trips: 0, flees: 0, accidents: 0, placed: 0, restands: 0, roombaKnocks: 0, roombaEaten: 0, emergencies: 0, totalToppled: 0, produced: 0, stoppersSaved: 0 };
    this.rewinds = 0;
    this.unlockedStage = 1;
    this.stageId = 0;
    this.mode = 'build';
    this.editMode = 'play';
    this.time = 0;
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, d) { (this.listeners[ev] || []).forEach((f) => f(d)); }

  // ================= ステージ =================
  loadStage(id, data = null) {
    this.unloadStage();
    this.stageId = id;
    this.def = STAGES[id];
    this.physics = new Physics();
    this.stage = createStage(id, this.scene, this.physics);
    this.stage.extraBlockers = [(x, z, m, forRoomba) => this.pieceBlocks(x, z, m, forRoomba)];
    this.dominoes = new Dominoes(this.scene, this.physics);
    this.dominoes.onTopple = (d) => this.onTopple(d);
    this.course = new Course(this.stage);
    this.planView = new PlanView(this.scene);
    this.depots = this.def.depots.map((p, i) => new Depot(this, p.x, p.z, i));
    this.crate = new Crate(this);
    this.crate.pos.set(this.def.start.x + 3, 0, this.def.start.z + 3);
    this.machine = new Machine(this);
    this.machine.pos.set(this.depots[0].pos.x + 3, 0, this.depots[0].pos.z + 3);
    this.train = new Train(this);
    this.train.pos.copy(this.depots[0].pos);
    const fp = this.depots[0].pos.clone().add(new THREE.Vector3(6, 0, 3));
    this.factory = new Factory(this, fp);
    this.workers = new Workers(this);
    this.stoppers = [];
    this.pieces = []; // ポート付き（course.pieces と共有）
    this.placed = []; // バリケード・センサー・ベル {type,x,z,yaw,mesh,slot?}
    this.tempBarricades = [];
    this.loose = new Set();
    this.mode = 'build';
    this.run = null;
    this.alarm = null;
    this.alarmT = 0;
    // スタート台
    const sp = startPadMesh();
    sp.position.set(this.def.start.x, 0, this.def.start.z);
    sp.rotation.y = this.def.start.yaw;
    this.scene.add(sp);
    this.startPad = sp;
    this.stage.obstacles.push({ x: this.def.start.x - Math.sin(this.def.start.yaw) * 2.8, z: this.def.start.z - Math.cos(this.def.start.yaw) * 2.8, hw: 1.6, hd: 1.0, yaw: this.def.start.yaw, roomba: true, build: true });
    // ゴール
    this.goal = this.def.goal.type === 'bell' ? new GoalBell(this.scene, this.physics, this.def.goal) : new GoalMachine(this.scene, this.physics, this.def.goal);
    this.goal.onTrigger = () => this.onGoal();
    this.goal.onStep = (name, pos) => this.emit('goalStep', { name, pos });
    const gp = this.def.goal;
    const bell = this.def.goal.type === 'bell';
    const goff = bell ? 2.6 : 10.2;
    const gfx = gp.x + Math.sin(gp.yaw) * goff, gfz = gp.z + Math.cos(gp.yaw) * goff;
    this.stage.obstacles.push({ x: gfx, z: gfz, hw: bell ? 3 : 4.5, hd: bell ? 2.4 : 9.6, yaw: gp.yaw, roomba: true, build: true });
    // ルンバ
    this.roomba = this.def.roomba ? new Roomba(this.scene, this.physics, this.stage, this.def.roomba) : null;
    // 特殊ギミック（ステージ配置物）
    this.markers = this.def.markers.map((m, i) => {
      const mesh = m.type === 'orbs' ? null : markerMesh(m.type);
      if (mesh) { mesh.position.set(m.x, this.stage.heightAt(m.x, m.z), m.z); this.scene.add(mesh); }
      const mk = { ...m, i, mesh, consumed: false, orbs: [], respawn: 0 };
      if (m.type === 'orbs') this.spawnOrbs(mk);
      return mk;
    });
    this.chests = this.def.chests.map((c, i) => {
      const mesh = chestMesh(false); mesh.position.set(c.x, 0, c.z); mesh.rotation.y = Math.atan2(-c.x, -c.z); this.scene.add(mesh);
      this.stage.obstacles.push({ x: c.x, z: c.z, r: 2.2, roomba: true, build: true });
      return { ...c, i, mesh, opened: false, openT: 0 };
    });
    const gm = this.def.gachaMachine;
    this.gachaMachine = { ...gm, mesh: gachaMachineMesh(gm.category === 'defense' ? '#4dabf7' : '#ff922b'), used: false, spin: 0 };
    this.gachaMachine.mesh.position.set(gm.x, 0, gm.z);
    this.gachaMachine.mesh.rotation.y = Math.atan2(-gm.x, -gm.z);
    this.scene.add(this.gachaMachine.mesh);
    this.stage.obstacles.push({ x: gm.x, z: gm.z, r: 2.4, roomba: true, build: true });
    // 最終ゴールの宝箱（クリア時に開く）
    const fc = chestMesh(true);
    const fcx = gp.x + Math.cos(gp.yaw) * 4.5, fcz = gp.z - Math.sin(gp.yaw) * 4.5;
    fc.position.set(fcx, 0, fcz); fc.rotation.y = gp.yaw + Math.PI;
    this.scene.add(fc);
    this.finalChest = { mesh: fc, opened: false, openT: 0 };
    this.stage.obstacles.push({ x: fcx, z: fcz, r: 3, roomba: true, build: true });
    this.piggy = null;
    this.tower = null; this.hq = null; this.hqPos = null;
    this.stock = CFG.startStock;
    if (data) this.applyStageSave(data);
    this.syncPartsToWorld(true);
    this.refreshCourse();
    this.emit('stageLoaded', id);
  }

  unloadStage() {
    if (!this.stageId) return;
    this.workers.clear();
    this.dominoes.clear();
    this.scene.remove(this.dominoes.mesh);
    for (const p of this.pieces) p.dispose();
    for (const s of this.stoppers) s.dispose();
    for (const p of this.placed) this.scene.remove(p.mesh);
    for (const b of this.tempBarricades) this.scene.remove(b.mesh);
    this.goal.dispose();
    if (this.roomba) this.roomba.dispose();
    for (const m of this.markers) { if (m.mesh) this.scene.remove(m.mesh); m.orbs.forEach((o) => this.scene.remove(o.mesh)); }
    for (const c of this.chests) this.scene.remove(c.mesh);
    this.scene.remove(this.gachaMachine.mesh, this.finalChest.mesh, this.startPad, this.crate.group, this.machine.group, this.train.mesh, this.factory.group);
    if (this.piggy) this.scene.remove(this.piggy.mesh);
    if (this.tower) this.scene.remove(this.tower);
    if (this.hq) this.scene.remove(this.hq);
    this.depots.forEach((d) => d.dispose());
    this.scene.remove(this.planView.ghost, this.planView.lines, this.planView.stopMarker, this.planView.strokeLine, this.planView.portMarks);
    this.stage.dispose();
    this.physics.world.free();
    this.stageId = 0;
  }

  // ================= パーツ → 3Dの現場 =================
  level(id) { return this.progress.lv(id); }
  evolved(id) { return !!this.progress.evolutions[id]; }
  odMult() { return 1; }
  workMult(role) {
    let m = 1 + 0.2 * this.level('boots');
    if ((role === 'stopperCrew' || role === 'restorer' || role === 'guard') && (this.evolved('autoSafety') || this.evolved('stopperHQ'))) m *= 1.3;
    return m;
  }
  speedStopper() { return this.evolved('autoSafety') ? 1.6 : 1.2; }
  capacity(role) {
    const b = this.level('basket');
    if (role === 'builder') return (3 + b) * (this.evolved('massBuild') ? 2 : 1);
    if (role === 'carrier') return 8 + 3 * b;
    return 5 + 2 * b;
  }
  placeableCount(type) { return PLACEABLE[type] * this.level(type); }
  placeableUsed(type) {
    if (type === 'minicar' || type === 'marble' || type === 'bridge') return this.pieces.filter((p) => p.type === type).length;
    return this.placed.filter((p) => p.type === type).length;
  }

  /** 獲得済みパーツに合わせて、小人や設備を現場に出す */
  syncPartsToWorld(quiet = false) {
    for (const role of ROLE_PARTS) {
      const want = this.level(role);
      while (this.workers.count(role) < want) this.workers.hire(role, quiet);
    }
    if (this.level('watchtower') && !this.tower) {
      this.tower = towerMesh();
      const ts = this.def.towerSpot;
      const p = new THREE.Vector3(ts.x, 0, ts.z);
      this.tower.position.copy(p);
      this.scene.add(this.tower);
      this.stage.obstacles.push({ x: p.x, z: p.z, r: 1.8, roomba: true, build: true });
    }
    if (this.evolved('stopperHQ') && !this.hq) {
      this.hq = hqMesh();
      const hs = this.def.hqSpot;
      this.hqPos = new THREE.Vector3(hs.x, 0, hs.z);
      this.hq.position.copy(this.hqPos);
      this.scene.add(this.hq);
      this.stage.obstacles.push({ x: this.hqPos.x, z: this.hqPos.z, hw: 5, hd: 4, yaw: 0, roomba: true, build: true });
    }
    if (this.level('piggy') && !this.piggy) {
      const s = this.def.start;
      const p = { x: s.x + Math.cos(s.yaw) * 3.2, z: s.z - Math.sin(s.yaw) * 3.2 };
      const m = piggyMesh(); m.position.set(p.x, 0, p.z); m.rotation.y = s.yaw; this.scene.add(m);
      this.piggy = { mesh: m, bank: 0 };
      this.stage.obstacles.push({ x: p.x, z: p.z, r: 1.8, roomba: true, build: true });
    }
    // 自動遮断ゲート／本部ならストッパーがゲートになる
    const gates = this.level('gate') > 0 || this.evolved('stopperHQ');
    for (const s of this.stoppers) if (s.gate !== gates) s.setGate(gates);
    this.workers.refreshLooks();
  }

  guardPost(i) {
    const posts = this.def.guardPosts;
    const [x, z] = posts[i % posts.length];
    return new THREE.Vector3(x, 0, z);
  }

  // ================= コース・建設 =================
  refreshCourse() {
    this.course.pieces = this.pieces;
    this.course.refresh();
    // 特殊マーカー（プレゼント・四つ葉）をスロットに割り当て
    for (const sl of this.course.allSlots) sl.special = null;
    for (const m of this.markers) {
      if (m.consumed || m.type === 'orbs') continue;
      let best = null, bd = 1.6 * 1.6;
      for (const sl of this.course.allSlots) { const d = (sl.x - m.x) ** 2 + (sl.z - m.z) ** 2; if (d < bd && sl.kind === 'normal') { bd = d; best = sl; } }
      if (best) best.special = m;
      if (m.mesh) m.mesh.userData.linked = !!best;
    }
    // ベルの取り付け先
    for (const p of this.placed) if (p.type === 'bell') p.slot = this.nearestSlot(p.x, p.z, 2.5);
    this.unbuiltDirty = true;
    this.planView.setPorts(this.course.openOutputs(), this.course.openInputs(), this.course.openEnds());
  }

  nearestSlot(x, z, maxD = Infinity) {
    let best = null, bd = maxD * maxD;
    for (const sl of this.course.allSlots) { const d = (sl.x - x) ** 2 + (sl.z - z) ** 2; if (d < bd) { bd = d; best = sl; } }
    return best;
  }
  sideOf(slot, off, out = new THREE.Vector3()) {
    return out.set(slot.x + Math.cos(slot.yaw) * off, slot.y || 0, slot.z - Math.sin(slot.yaw) * off);
  }
  ord(sl) { return sl.order >= 0 ? sl.order : 1e6 + (sl.seg ? sl.seg.id * 1000 : 0) + sl.i; }
  unbuiltList() {
    if (this.unbuiltDirty || !this._unbuilt || this.time - this._ubT > 0.25) {
      this._unbuilt = this.course.allSlots.filter((s) => !s.domino).sort((a, b) => this.ord(a) - this.ord(b));
      this.unbuiltDirty = false; this._ubT = this.time;
    }
    return this._unbuilt;
  }
  unbuiltCount() { return this.unbuiltList().filter((s) => !s.domino).length; }
  loosePlannedNeed() { return 0; }
  frontSlot() { return this.unbuiltList().find((s) => !s.domino) || null; }
  machineTarget() { return this.unbuiltList().find((s) => !s.domino && (!s.claim || s.claim === -1)) || null; }
  nextUnbuiltNear(slot) {
    const seg = slot.seg; if (!seg || !seg.slots) return null;
    const n = seg.slots[slot.i + 1];
    return n && !n.domino && !n.claim ? n : null;
  }
  findBuildJob(gnome) {
    if (this.mode !== 'build') return null;
    const list = this.unbuiltList();
    let best = null, bd = Infinity, k = 0;
    for (const s of list) {
      if (s.domino || s.claim) continue;
      const d = (s.x - gnome.pos.x) ** 2 + (s.z - gnome.pos.z) ** 2 + k * 4;
      if (d < bd) { bd = d; best = s; }
      if (++k > 14) break;
    }
    if (best) best.claim = gnome.id;
    return best;
  }
  supplyFor(gnome) {
    const near = this.nearestDepot(gnome.pos);
    if (this.crate.count > 0 && (this.stock <= 0 || this.crate.pos.distanceTo(gnome.pos) < near.pos.distanceTo(gnome.pos) + 12)) return this.crate;
    if (this.stock > 0) return near;
    if (this.crate.count > 0) return this.crate;
    return null;
  }
  nearestDepot(pos) {
    let best = this.depots[0], bd = Infinity;
    for (const d of this.depots) { const dd = d.pos.distanceToSquared(pos); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }
  returnToStock(n) { this.stock += n; }

  /** スロットにドミノを置く（手持ち・機械から。在庫は呼び出し側で減らしてある） */
  placeAt(slot, gnome) {
    if (slot.domino) { this.stock++; return null; }
    const kind = slot.kind === 'wide' ? 'wide' : slot.special ? slot.special.type : 'normal';
    const d = this.dominoes.create(slot, { slot, kind, drop: true, colorIndex: Math.floor(Math.max(0, slot.order) / 4) });
    if (!d) { this.stock++; return null; }
    slot.domino = d; slot.claim = 0;
    this.stats.placed++;
    this.unbuiltDirty = true;
    if (!this._lastPlaceSnd || this.time - this._lastPlaceSnd > 0.06) { this.audio.place(); this._lastPlaceSnd = this.time; }
    // うっかり（物理で実際に倒れる）
    if (gnome && this.stats.placed > 25 && this.mode === 'build') {
      const p = CFG.accidentChance * (1 - 0.3 * this.level('level'));
      if (Math.random() < p) {
        const dir = Math.random() < 0.6 ? -1 : 1;
        setTimeout(() => {
          if (d.removed || d.toppled) return;
          this.dominoes.push(d, Math.sin(slot.yaw) * dir, Math.cos(slot.yaw) * dir, 0.07);
          d.accident = true;
          this.stats.accidents++;
          gnome.oops();
          this.audio.oops();
          this.fx.floatAt(tmp.set(slot.x, 1.8, slot.z), 'うっかり！予定外の連鎖！', 'warn', 2.0, 1.2);
          this.emit('accident', slot);
        }, 120);
      }
    }
    return d;
  }

  manualPlace(near) {
    if (this.mode !== 'build') return false;
    if (this.stock <= 0 && this.crate.count <= 0) { this.audio.deny(); this.fx.floatAt(near || tmp.set(0, 1, 0), '在庫がない！', 'warn', 1.2); return false; }
    let slot = null;
    if (near) {
      let bd = 3.5 * 3.5;
      for (const s of this.unbuiltList()) { if (s.domino || s.claim) continue; const d = (s.x - near.x) ** 2 + (s.z - near.z) ** 2; if (d < bd) { bd = d; slot = s; } }
    }
    if (!slot) slot = this.unbuiltList().find((s) => !s.domino && !s.claim);
    if (!slot) { this.audio.deny(); this.fx.floatAt(near || tmp.set(0, 1, 0), 'まず「コースを描く」で線を引こう', 'warn', 1.6); return false; }
    if (this.stock > 0) this.stock--; else this.crate.count--;
    this.placeAt(slot, null);
    return true;
  }

  /** 倒れたドミノ（その場）を探す */
  findRestandJob(gnome, maxD = Infinity, preferAccident = false) {
    // 本番中も復旧係だけは、連鎖の波より十分先のドミノを直しに行ける
    const duringRun = this.mode === 'run' && gnome.role === 'restorer';
    if (this.mode !== 'build' && !duringRun) return null;
    const minOrder = duringRun ? (this.run.frontOrder < 0 ? 12 : this.run.frontOrder + 25) : -Infinity;
    let best = null, bd = maxD * maxD;
    for (const d of this.dominoes.list) {
      if (!d.slot || d.claim || d.removed) continue;
      // 倒れた・寄りかかって傾いた・ずれたドミノ（スロットにきちんと立っていない）
      if (!d.toppled && this.dominoes.isStandingAt(d, d.slot)) continue;
      if (duringRun && (d.slot.order < minOrder || this.run.toppled.has(d))) continue;
      if (!d.frozen && d.body && !d.body.isSleeping()) continue; // 倒れている最中は待つ
      const t = d.body.translation();
      const dist2s = (t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2;
      if (dist2s > CFG.restandDistance ** 2) continue;
      let dd = (t.x - gnome.pos.x) ** 2 + (t.z - gnome.pos.z) ** 2;
      if (preferAccident && d.accident) dd *= 0.3;
      dd += Math.max(0, d.slot.order) * 0.02;
      if (dd < bd) { bd = dd; best = d; }
    }
    if (best) best.claim = gnome.id;
    return best;
  }
  /** 本番中：波より十分先の空きマス（ルンバに吸われた等）を復旧係が埋める */
  findRunRepairSlot(gnome) {
    if (this.mode !== 'run' || !this.run || this.stock <= 0) return null;
    const minOrder = this.run.frontOrder + 30;
    let best = null, bd = Infinity;
    for (const s of this.course.allSlots) {
      if (s.domino || s.claim || s.order < minOrder) continue;
      const d = (s.x - gnome.pos.x) ** 2 + (s.z - gnome.pos.z) ** 2 + (s.order - minOrder) * 0.5;
      if (d < bd) { bd = d; best = s; }
    }
    if (best) best.claim = gnome.id;
    return best;
  }
  restand(d) {
    if (d.removed || !d.slot) return;
    if (this.mode === 'run' && this.run && (this.run.frontOrder + 6 > d.slot.order)) return;
    const slot = d.slot;
    const kind = slot.kind === 'wide' ? 'wide' : slot.special ? slot.special.type : 'normal';
    const color = d.color;
    this.dominoes.remove(d);
    const nd = this.dominoes.create(slot, { slot, kind, color, drop: true });
    slot.domino = nd;
    this.stats.restands++;
    if (!this._lastRestSnd || this.time - this._lastRestSnd > 0.07) { this.audio.place(); this._lastRestSnd = this.time; }
  }
  /** スロットから離れた・持ち主のいないドミノ */
  findCollectJob(gnome) {
    if (this.mode !== 'build') return null;
    let best = null, bd = Infinity;
    for (const d of this.dominoes.list) {
      if (d.claim || d.removed) continue;
      let loose = !d.slot;
      if (d.slot && d.toppled && (d.frozen || d.body.isSleeping())) {
        const t = d.body.translation();
        if ((t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2 > CFG.restandDistance ** 2) loose = true;
      }
      if (!loose) continue;
      if (!d.frozen && !d.body.isSleeping()) continue;
      const t = d.body.translation();
      const dd = (t.x - gnome.pos.x) ** 2 + (t.z - gnome.pos.z) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    if (best) best.claim = gnome.id;
    return best;
  }
  collect(d) {
    if (d.slot && d.slot.domino === d) { d.slot.domino = null; this.unbuiltDirty = true; }
    this.dominoes.remove(d);
  }

  /** プレイヤーの手：クリック位置の近くを片付ける */
  manualTidy(p) {
    if (this.mode !== 'build') return 0;
    let n = 0;
    for (const d of [...this.dominoes.list]) {
      if (d.removed) continue;
      if (!d.toppled && (!d.slot || this.dominoes.isStandingAt(d, d.slot))) continue;
      const t = d.body.translation();
      if ((t.x - p.x) ** 2 + (t.z - p.z) ** 2 > 3.2 * 3.2) continue;
      if (!d.frozen && !d.body.isSleeping()) continue;
      if (d.slot && (t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2 <= CFG.restandDistance ** 2) { this.restand(d); n++; }
      else { this.collect(d); this.stock++; n++; }
      if (n >= 12) break;
    }
    if (n) { this.fx.floatAt(tmp.set(p.x, 1.2, p.z), `+${n} 片付け`, 'coin', 1.0); this.audio.pick(); }
    return n;
  }
  /** 「片付け」ボタン：倒れたドミノを順番に起こす */
  manualRestoreStep() {
    if (this.mode !== 'build') return false;
    let best = null, bo = Infinity;
    for (const d of this.dominoes.list) {
      if (!d.slot || d.claim || d.removed) continue;
      if (!d.toppled && this.dominoes.isStandingAt(d, d.slot)) continue;
      if (!d.frozen && !d.body.isSleeping()) continue;
      const t = d.body.translation();
      if ((t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2 > CFG.restandDistance ** 2) { this.collect(d); this.stock++; return true; }
      const o = this.ord(d.slot);
      if (o < bo) { bo = o; best = d; }
    }
    if (!best) return false;
    this.restand(best);
    return true;
  }

  // ---------- ストッパー ----------
  stopperInterval() { return Math.max(14, CFG.stopperEvery - 6 * this.level('stopperCrew')); }
  findStopperJob(gnome) {
    if (this.mode !== 'build') return null;
    const N = this.stopperInterval();
    const has = new Set(this.stoppers.map((s) => s.slot));
    let best = null, bd = Infinity;
    for (const seg of this.course.segments) {
      for (let i = N - 1; i < seg.slots.length - 1; i += N) {
        const sl = seg.slots[i], nx = seg.slots[i + 1];
        if (has.has(sl) || sl.claim) continue;
        if (!this.dominoes.isStandingAt(sl.domino, sl) || !this.dominoes.isStandingAt(nx.domino, nx)) continue;
        const d = (sl.x - gnome.pos.x) ** 2 + (sl.z - gnome.pos.z) ** 2;
        if (d < bd) { bd = d; best = { slot: sl, next: nx }; }
      }
    }
    if (best) best.slot.claim = gnome.id;
    return best;
  }
  installStopper(slot, next, emergency = false) {
    if (this.stoppers.some((s) => s.slot === slot)) return null;
    const gates = this.level('gate') > 0 || this.evolved('stopperHQ');
    const s = new Stopper(this.scene, this.physics, slot, next, { gate: gates, emergency });
    this.stoppers.push(s);
    this.audio.clunk();
    return s;
  }
  removeStoppersOn(slots) {
    const set = new Set(slots);
    this.stoppers = this.stoppers.filter((s) => { if (set.has(s.slot) || set.has(s.next)) { s.dispose(); return false; } return true; });
  }

  // ---------- 置くタイプの設備 ----------
  pieceBlocks(x, z, m, forRoomba) {
    const inRect = (o, mm) => {
      const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw), dx = x - o.x, dz = z - o.z;
      return Math.abs(dx * c + dz * s) < o.hw + mm && Math.abs(-dx * s + dz * c) < o.hd + mm;
    };
    for (const p of this.pieces || []) {
      if (forRoomba) { if (p.roombaBlocks) { if (p.roombaBlocks.some((b) => inRect(b, m))) return true; } else if (inRect(p.footprint, m)) return true; }
      else if (inRect(p.footprint, Math.min(m, 0.2))) return true;
    }
    for (const p of this.placed || []) {
      if (p.type === 'barricade' && inRect({ x: p.x, z: p.z, hw: 2.6, hd: 0.5, yaw: p.yaw }, m)) return true;
      if (p.type === 'sensor' && (x - p.x) ** 2 + (z - p.z) ** 2 < (0.8 + m) ** 2) return true;
    }
    return false;
  }
  barricadeHit(x, z, m) {
    const hit = (b) => { const c = Math.cos(-b.yaw), s = Math.sin(-b.yaw), dx = x - b.x, dz = z - b.z; return Math.abs(dx * c + dz * s) < 2.6 + m && Math.abs(-dx * s + dz * c) < 0.5 + m; };
    return this.placed.some((p) => p.type === 'barricade' && hit(p)) || this.tempBarricades.some(hit);
  }
  canPlacePiece(type, x, z, yaw) {
    if (this.placeableUsed(type) >= this.placeableCount(type)) return { ok: false, why: `${PIECE_LABEL[type]}がもうありません（ガチャで増やせます）` };
    const st = this.stage;
    if (type === 'minicar' || type === 'marble' || type === 'bridge') {
      const len = type === 'bridge' ? 35 : type === 'minicar' ? 11 : 12;
      for (let t = 0; t <= len; t += 1) {
        const px = x + Math.sin(yaw) * t, pz = z + Math.cos(yaw) * t;
        if (!st.inBounds(px, pz, 1.2) || st.blocked(px, pz, 1.0)) return { ok: false, why: '家具やコースと重なっています' };
        if (this.nearestSlot(px, pz, 1.2)) return { ok: false, why: 'コースと重なっています' };
      }
      return { ok: true };
    }
    if (!st.inBounds(x, z, 1) || st.blocked(x, z, type === 'barricade' ? 0.3 : 0.6)) return { ok: false, why: '置けない場所です' };
    if (type === 'barricade') for (let t = -2.4; t <= 2.4; t += 0.6) { const px = x + Math.cos(yaw) * t, pz = z - Math.sin(yaw) * t; if (this.nearestSlot(px, pz, 0.6)) return { ok: false, why: 'コースと重なっています' }; }
    if (type === 'bell' && !this.nearestSlot(x, z, 2.5)) return { ok: false, why: 'コースのすぐ横に置いてください' };
    return { ok: true };
  }
  placePiece(type, x, z, yaw, quiet = false) {
    const chk = this.canPlacePiece(type, x, z, yaw);
    if (!chk.ok) { if (!quiet) { this.audio.deny(); this.fx.floatAt(tmp.set(x, 1.5, z), chk.why, 'warn', 1.6); } return null; }
    if (type === 'minicar' || type === 'marble' || type === 'bridge') {
      const id = (this.pieceSeq = (this.pieceSeq || 0) + 1);
      const p = type === 'bridge' ? new BridgePiece(this.scene, this.physics, { x, z, yaw }, id) : new LauncherPiece(this.scene, this.physics, type, { x, z, yaw }, id);
      p.onFire = (pc) => this.onPieceFire(pc);
      this.pieces.push(p);
      this.refreshCourse();
      if (!quiet) this.audio.buy();
      return p;
    }
    const mesh = type === 'barricade' ? barricadeMesh() : type === 'sensor' ? sensorMesh() : bellPieceMesh();
    mesh.position.set(x, this.stage.heightAt(x, z), z); mesh.rotation.y = yaw;
    this.scene.add(mesh);
    const p = { type, x, z, yaw, mesh, slot: null };
    this.placed.push(p);
    this.refreshCourse();
    if (!quiet) this.audio.buy();
    return p;
  }
  removePieceAt(x, z) {
    for (const p of this.placed) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 2.5 * 2.5) { this.scene.remove(p.mesh); this.placed.splice(this.placed.indexOf(p), 1); this.refreshCourse(); return true; }
    for (const p of this.pieces) {
      const f = p.footprint; const c = Math.cos(-f.yaw), s = Math.sin(-f.yaw), dx = x - f.x, dz = z - f.z;
      if (Math.abs(dx * c + dz * s) < f.hw + 1 && Math.abs(-dx * s + dz * c) < f.hd + 1) {
        // つながっているセグメントを切り離す
        for (const seg of this.course.segments) {
          if (seg.to && seg.to.type === 'piece' && seg.to.piece === p.id) seg.to = null;
        }
        const outs = this.course.segments.filter((sg) => sg.from.type === 'piece' && sg.from.piece === p.id);
        for (const o of outs) this.dropDominoes(this.course.cutFrom(o.slots[0] || { seg: o, i: 0 }));
        for (const sl of p.slots || []) if (sl.domino) { this.collect(sl.domino); this.stock++; }
        this.removeStoppersOn(p.slots || []);
        p.dispose(); this.pieces.splice(this.pieces.indexOf(p), 1);
        this.refreshCourse();
        return true;
      }
    }
    return false;
  }
  placeTempBarricade(pos, yaw) {
    const mesh = barricadeMesh(); mesh.position.copy(pos); mesh.rotation.y = yaw; this.scene.add(mesh);
    this.tempBarricades.push({ x: pos.x, z: pos.z, yaw, mesh, t: 14 });
    this.audio.clunk();
  }

  // ---------- コース編集 ----------
  addStroke(points) {
    if (this.mode !== 'build') return null;
    const r = this.course.addStroke(points, { allowBranch: this.branchesLeft() > 0 });
    if (!r) return null;
    this.dropDominoes(r.orphan);
    this.refreshCourse();
    this.emit('courseChanged', r);
    return r;
  }
  branchesLeft() { return 2 * this.level('branch') - this.course.segments.filter((s) => s.from.type === 'branch').length; }
  eraseAt(p) {
    if (this.mode !== 'build') return false;
    if (this.removePieceAt(p.x, p.z)) { this.audio.pick(); return true; }
    const sl = this.nearestSlot(p.x, p.z, 1.2);
    if (!sl || !sl.seg || !sl.seg.slots) return false;
    const removed = this.course.cutFrom(sl);
    this.dropDominoes(removed);
    this.refreshCourse();
    this.emit('courseChanged');
    this.audio.pick();
    return true;
  }
  /** コースから外れたドミノ：立っていれば在庫に戻す（手で回収） */
  dropDominoes(list) {
    const slots = [];
    for (const d of list || []) {
      if (d.removed) continue;
      if (d.slot) slots.push(d.slot);
      this.dominoes.remove(d);
      this.stock++;
    }
    this.removeStoppersOn(slots);
    this.stoppers = this.stoppers.filter((s) => { const ok = this.course.allSlots.includes(s.slot); if (!ok) s.dispose(); return ok; });
  }
  clearCourse() {
    if (this.mode !== 'build') return false;
    const all = [];
    for (const s of this.course.segments) for (const sl of s.slots) if (sl.domino) all.push(sl.domino);
    this.course.segments = [];
    this.dropDominoes(all);
    for (const s of this.stoppers) s.dispose();
    this.stoppers = [];
    this.refreshCourse();
  }
  loadSuggested(i) {
    const sug = this.def.suggested[i];
    if (!sug || this.mode !== 'build') return false;
    this.clearCourse();
    const pts = sug.pts.map(([x, z]) => ({ x, z }));
    // 線は1本の連続ストロークとして描いたことにする
    const dense = [];
    for (let k = 0; k < pts.length - 1; k++) for (let t = 0; t < 1; t += 0.2) dense.push({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, z: pts[k].z + (pts[k + 1].z - pts[k].z) * t });
    dense.push(pts[pts.length - 1]);
    return this.addStroke(dense);
  }

  // ================= 危険・警報 =================
  dangerNear(pos) {
    if (this.run && this.run.frontPos) {
      const f = this.run.frontPos;
      if ((pos.x - f.x) ** 2 + (pos.z - f.z) ** 2 < 1.6 * 1.6) return { pos: f, label: '！' };
    }
    const r = this.roomba;
    if (r && r.state !== 'dock') {
      const rad = this.alarm ? 11 : 5;
      if ((pos.x - r.pos.x) ** 2 + (pos.z - r.pos.z) ** 2 < rad * rad) return { pos: r.pos, label: 'ルンバだ〜！' };
    }
    return null;
  }
  clampToStage(p) {
    const b = this.stage.bounds;
    p.x = Math.max(b.minX + 0.5, Math.min(b.maxX - 0.5, p.x));
    p.z = Math.max(b.minZ + 0.5, Math.min(b.maxZ - 0.5, p.z));
  }
  watchRadius() { return this.level('watchtower') ? 12 + 6 * this.level('watchtower') + (this.evolved('stopperHQ') ? 20 : 0) : 0; }
  updateAlarm(dt) {
    const r = this.roomba;
    this.alarmT -= dt;
    let reason = null;
    if (r && r.state !== 'dock') {
      if (this.tower && r.pos.distanceTo(this.tower.position) < this.watchRadius()) reason = 'watch';
      if (this.evolved('stopperHQ')) reason = 'hq';
      for (const p of this.placed) if (p.type === 'sensor' && (p.x - r.pos.x) ** 2 + (p.z - r.pos.z) ** 2 < 49) { reason = 'sensor'; p.mesh.userData.led.material.color.set('#ff3b3b'); p.alert = 1; }
    }
    for (const p of this.placed) if (p.type === 'sensor' && p.alert) { p.alert -= dt * 0.5; if (p.alert <= 0) { p.alert = 0; p.mesh.userData.led.material.color.set('#3cff8a'); } }
    const was = !!this.alarm;
    this.alarm = reason ? { reason } : null;
    if (this.alarm && !was) {
      this.audio.siren();
      this.fx.floatAt(r.pos.clone().setY(3.5), '⚠ 警報！ルンバ接近！', 'warn', 1.8);
      this.emit('alarm', true);
    }
    if (this.tower) this.tower.userData.siren.material.emissiveIntensity = this.alarm ? 1 + Math.sin(this.time * 20) : 0.2;
    if (this.hq) this.hq.userData.siren.material.emissiveIntensity = this.alarm ? 1 + Math.sin(this.time * 20) : 0.2;
    // 自動事故防止チーム：ルンバの進路上のコースを緊急ストッパーで区切る
    if (this.alarm && (this.evolved('autoSafety') || this.evolved('stopperHQ')) && this.alarmT <= 0 && r) {
      this.alarmT = 1.0;
      const ahead = r.pos.clone().add(new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw)).multiplyScalar(r.r + 4));
      const sl = this.nearestSlot(ahead.x, ahead.z, 6);
      if (sl && sl.seg && sl.seg.slots) {
        for (const off of [-8, 8]) {
          const t = sl.seg.slots[sl.i + off], n = sl.seg.slots[sl.i + off + 1];
          if (t && n && this.dominoes.isStandingAt(t.domino, t) && this.dominoes.isStandingAt(n.domino, n)) this.throwStopper(t, n, '自動ストッパー！');
        }
      }
    }
  }
  guardTask(gnome) {
    const r = this.roomba;
    if (!r || r.state === 'dock' || !this.alarm || this.mode !== 'build' && this.mode !== 'run') return null;
    if (this._guardBusy && this.time - this._guardBusy < 6) return null;
    const dir = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw));
    const pos = r.pos.clone().addScaledVector(dir, r.r + 6);
    if (!this.nearestSlot(pos.x, pos.z, 7)) return null;
    if (this.stage.blocked(pos.x, pos.z, 1) || !this.stage.inBounds(pos.x, pos.z, 2)) return null;
    if (this.nearestSlot(pos.x, pos.z, 0.8)) return null;
    if (gnome.pos.distanceTo(pos) > 45) return null;
    this._guardBusy = this.time;
    return { pos, yaw: r.yaw + Math.PI / 2, face: r.pos };
  }

  // ---------- 事故 → ストッパーズ緊急出動 ----------
  throwStopper(slot, next, label = '緊急ストッパー！') {
    if (this.stoppers.some((s) => s.slot === slot)) return false;
    const crew = this.workers.list.filter((g) => g.role === 'stopperCrew' || g.role === 'restorer');
    if (!crew.length) return false;
    let best = null, bd = Infinity;
    for (const c of crew) { const d = c.pos.distanceTo(tmp.set(slot.x, 0, slot.z)); if (d < bd) { bd = d; best = c; } }
    const reach = this.evolved('autoSafety') || this.evolved('stopperHQ') ? 80 : 18;
    if (bd > reach) return false;
    best.yaw = Math.atan2(slot.x - best.pos.x, slot.z - best.pos.z);
    best.act(0.5, 'alarm', () => best.think());
    best.say(label, 'warn');
    this.throwArc(best.pos, new THREE.Vector3(slot.x, 0.4, slot.z), Math.min(0.5, 0.15 + bd / 60), () => {
      if (!slot.domino || !next.domino) return;
      if (slot.domino.toppled && next.domino.toppled) return;
      const s = this.installStopper(slot, next, true);
      if (s) { this.stats.emergencies++; this.fx.floatAt(tmp.set(slot.x, 1.6, slot.z), 'ガッチャン！', 'coin', 1.0); }
    });
    return true;
  }
  /** 投げたストッパーの放物線（ゲーム時間で進む） */
  throwArc(from, to, time, cb) {
    (this.throws ||= []);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.12), new THREE.MeshStandardMaterial({ color: '#ffd21f' }));
    m.position.copy(from); this.scene.add(m);
    this.throws.push({ m, a: from.clone().setY(1), b: to.clone(), t: 0, time, cb });
  }
  updateThrows(dt) {
    for (let i = (this.throws || []).length - 1; i >= 0; i--) {
      const a = this.throws[i];
      a.t += dt / a.time;
      const k = Math.min(1, a.t);
      a.m.position.lerpVectors(a.a, a.b, k); a.m.position.y += Math.sin(k * Math.PI) * 4; a.m.rotation.x += dt * 14;
      if (k >= 1) { this.scene.remove(a.m); this.throws.splice(i, 1); a.cb && a.cb(); }
    }
  }
  onAccidentTopple(d) {
    if (this.mode !== 'build' || !d.slot || !d.slot.seg || !d.slot.seg.slots) return;
    if (this._lastEmergency && this.time - this._lastEmergency < 0.7) return;
    const seg = d.slot.seg, i = d.slot.i;
    // 両方向、連鎖の波より先（10〜16個先：波は毎秒約13個進む）の立っている所へストッパーを投げ込む
    let sent = false;
    for (const dir of [1, -1]) {
      for (let k = 10; k <= 16; k++) {
        const a = seg.slots[i + dir * k], b = seg.slots[i + dir * k + (dir > 0 ? 1 : -1)];
        if (!a || !b) break;
        if (this.stoppers.some((s) => Math.abs(s.slot.order - a.order) <= k + 1 && s.slot.seg === a.seg && (dir > 0 ? s.slot.order >= d.slot.order : s.slot.order <= d.slot.order))) break;
        if (!this.dominoes.isStandingAt(a.domino, a) || !this.dominoes.isStandingAt(b.domino, b)) continue;
        const first = dir > 0 ? a : b, second = dir > 0 ? b : a;
        if (this.throwStopper(first, second)) { sent = true; break; }
      }
    }
    if (sent) { this._lastEmergency = this.time; this.audio.siren(); this.emit('emergency', d.slot); }
  }

  // ---------- ルンバのフック ----------
  roombaSuck(pos, r) {
    let n = 0;
    for (const d of [...this.dominoes.list]) {
      if (!d.toppled || (!d.frozen && !d.body.isSleeping())) continue;
      const t = d.body.translation();
      if ((t.x - pos.x) ** 2 + (t.z - pos.z) ** 2 > r * r || t.y > 1.0) continue;
      this.collect(d);
      n++;
    }
    if (n) { this.stats.roombaEaten += n; if (Math.random() < 0.3) this.fx.floatAt(pos.clone().setY(2.4), 'ズゴゴゴ…（吸い込んだ）', 'warn', 1.2); }
    return n;
  }
  roombaDump(n, dock) {
    const show = Math.min(n, 30);
    for (let i = 0; i < show; i++) {
      const a = Math.random() * Math.PI * 2, rr = 2 + Math.random() * 3;
      const d = this.dominoes.create({ x: dock.x + Math.cos(a) * rr, y: 0, z: dock.z + 5 + Math.abs(Math.sin(a)) * rr, yaw: Math.random() * 6 }, { lying: true });
      if (d) d.dumped = true; else this.stock++;
    }
    this.stock += n - show;
    this.fx.floatAt(tmp.set(dock.x, 3, dock.z + 4), `ゴミ捨て場にドミノ ${n}個`, '', 2);
  }
  onRoombaDepart(r) {
    this.audio.roombaStart();
    this.fx.floatAt(r.pos.clone().setY(3.5), `ルンバ出動！（${r.pattern.name}）`, 'warn', 2.2);
    this.emit('roomba', 'depart');
  }
  onRoombaBump(r, barricade) {
    if (barricade) { this.fx.floatAt(r.pos.clone().setY(3), 'バリケードで方向転換！', 'coin', 1.4); this.audio.bonk(); this.emit('roomba', 'deflect'); }
  }

  // ================= 転倒イベント =================
  onTopple(d) {
    this.audio.click(d.kind === 'wide' ? 0.7 : 1, d.slot ? Math.max(0, d.slot.order) : 0);
    const r = this.roomba;
    if (r && r.state !== 'dock') {
      const t = d.body.translation();
      if ((t.x - r.pos.x) ** 2 + (t.z - r.pos.z) ** 2 < (r.r + 1.6) ** 2) { d.byRoomba = true; this.stats.roombaKnocks++; }
    }
    if (this.mode === 'run' || this.mode === 'test') this.runTopple(d);
    else if (d.slot) { d.accident = true; this.onAccidentTopple(d); }
  }

  // ================= 本番の連鎖 =================
  preflight() {
    const unbuilt = this.unbuiltCount();
    let fallen = 0;
    for (const sl of this.course.allSlots) if (sl.domino && !this.dominoes.isStandingAt(sl.domino, sl)) fallen++;
    const locked = this.stoppers.filter((s) => s.locked).length;
    return { unbuilt, fallen, locked, connected: this.course.connected(), total: this.course.allSlots.length };
  }

  startRun() {
    if (this.mode !== 'build') return false;
    const root = this.course.segments.find((s) => s.from.type === 'start');
    const first = root && root.slots[0];
    if (!first || !first.domino || !this.dominoes.isStandingAt(first.domino, first)) { this.audio.deny(); this.fx.floatAt(tmp.set(this.def.start.x, 2, this.def.start.z), '最初のドミノが立っていません', 'warn', 1.8); return false; }
    this.snapshot = this.takeSnapshot();
    this.mode = 'run';
    this.records[this.stageId].attempts++;
    this.run = {
      id: (this.runSeq = (this.runSeq || 0) + 1), kind: 'main', t: 0, lastTopple: 0, toppled: new Set(), count: 0,
      frontPos: null, frontOrder: -1, presents: 0, clovers: 0, chest: [], gacha: false, bells: 0, piggy: 0,
      goal: false, startPushed: false, roombaHits: 0, rogue: new Set(), chainSlots: new Set(), chainPieces: new Set(),
    };
    // ストッパー解除（ゲートは波が来る直前まで閉じたまま）
    let rel = 0;
    for (const s of this.stoppers) if (!s.gate && s.release()) rel++;
    if (rel) this.fx.floatAt(tmp.set(this.def.start.x, 3, this.def.start.z), `ストッパー ${rel}個 解除！`, 'coin', 1.6);
    for (const p of this.pieces) p.reset && p.reset();
    this.goal.reset();
    for (const g of this.workers.list) { g.releaseJob(); g.think(); }
    this.audio.start();
    this.emit('runStart', this.run);
    this.pushStart();
    return true;
  }

  pushStart() {
    const arm = this.startPad.userData.arm;
    this.run.punch = 0;
    this.run.punchArm = arm;
  }

  /** スタートから途切れずに伝わった連鎖か（ルンバや事故が先で起こした連鎖は数えない） */
  inChain(sl) {
    const run = this.run;
    if (run.kind === 'test' && sl.order === run.a) return true;
    // 直前5枚までさかのぼる（横に押しのけられたり寄りかかって止まった数枚を、波が物理的に飛び越えた場合も連続とみなす）
    let cur = sl;
    for (let k = 0; k < 5; k++) {
      const pred = this.course.predecessor(cur);
      if (pred === 'start') return true;
      if (!pred) return false;
      if (pred.piece && pred.x === undefined) return run.chainPieces.has(pred.piece);
      if (run.chainSlots.has(pred)) return true;
      cur = pred;
    }
    return false;
  }
  runTopple(d) {
    const run = this.run;
    if (!run || run.toppled.has(d) || run.rogue.has(d)) return;
    if (!d.slot) return;
    if (d.byRoomba) run.roombaHits++;
    if (d.byRoomba || !this.inChain(d.slot)) { run.rogue.add(d); return; }
    this.chainTopple(d);
    // 判定の順番が前後したものを救済（先に倒れ判定された後続ドミノ）
    const stack = [d.slot];
    while (stack.length) {
      const cur = stack.pop();
      for (const nx of this.course.successors(cur)) {
        if (nx.piece && nx.x === undefined) { if (nx.piece.fired && !run.chainPieces.has(nx.piece)) { run.chainPieces.add(nx.piece); const o = this.course.segments.find((x) => x.from.type === 'piece' && x.from.piece === nx.piece.id); const f = (nx.piece.slots && nx.piece.slots[0]) || (o && o.slots[0]); if (f && f.domino && run.rogue.has(f.domino) && !f.domino.byRoomba) { run.rogue.delete(f.domino); this.chainTopple(f.domino); stack.push(f); } } continue; }
        if (!nx.domino || nx.goal) continue;
        if (run.rogue.has(nx.domino) && !nx.domino.byRoomba) { run.rogue.delete(nx.domino); this.chainTopple(nx.domino); stack.push(nx); }
      }
    }
  }
  chainTopple(d) {
    const run = this.run;
    run.toppled.add(d);
    run.chainSlots.add(d.slot);
    run.count++;
    run.lastTopple = run.t;
    const sl = d.slot;
    if (sl.order > run.frontOrder) { run.frontOrder = sl.order; }
    const t = d.body.translation();
    run.frontPos = new THREE.Vector3(t.x, 0, t.z);
    if (run.kind !== 'main') return;
    this.stats.totalToppled++;
    // プレゼント・四つ葉
    if (sl.special && !sl.special.consumed) {
      const m = sl.special;
      m.consumed = true;
      if (m.mesh) { this.scene.remove(m.mesh); }
      if (m.type === 'present') { run.presents++; this.fx.floatAt(tmp.set(t.x, 2, t.z), '🎁 プレゼントが開いた！', 'big', 2.0); this.fx.confetti(tmp.set(t.x, 0.5, t.z), 50, 6); this.audio.present(); }
      else { run.clovers++; this.fx.floatAt(tmp.set(t.x, 2, t.z), '🍀 四つ葉！次のガチャが5択に', 'big', 2.0); this.audio.present(); }
      this.emit('special', { type: m.type, pos: t });
    }
    // 宝箱・ガチャマシン（近くで倒れたら作動）
    for (const c of this.chests) if (!c.opened && (c.x - t.x) ** 2 + (c.z - t.z) ** 2 < 3.4 * 3.4) {
      c.opened = true; run.chest.push(c); this.audio.chest();
      this.fx.floatAt(tmp.set(c.x, 3, c.z), '宝箱オープン！', 'big', 2.0); this.fx.confetti(tmp.set(c.x, 1, c.z), 80, 7);
      this.emit('special', { type: 'chest', pos: c });
    }
    const gm = this.gachaMachine;
    if (!gm.used && (gm.x - t.x) ** 2 + (gm.z - t.z) ** 2 < 3.6 * 3.6) {
      gm.used = true; run.gacha = true; gm.spin = 2.5; this.audio.present();
      this.fx.floatAt(tmp.set(gm.x, 6, gm.z), `ドミノ式ガチャマシン起動！（${CATEGORY[gm.category].label}）`, 'big', 2.2);
      this.emit('special', { type: 'gacha', pos: gm });
    }
    // 特殊ベル
    for (const p of this.placed) if (p.type === 'bell' && p.slot === sl && !p.rung) {
      p.rung = 1.5; run.bells++; this.audio.bell();
      if (this.roomba) { this.roomba.recall(); this.fx.floatAt(tmp.set(p.x, 3, p.z), '🔔 ルンバ、おうちに帰って！', 'big', 2.0); }
      else this.fx.floatAt(tmp.set(p.x, 3, p.z), '🔔 おうえんボーナス！', 'big', 2.0);
      this.emit('special', { type: 'bell', pos: p });
    }
    // 欲張り貯金箱：長くなるほど1枚あたりの貯金が増える
    if (this.piggy) { run.piggy += 1 + Math.floor(run.count / 150); }
    // 自動遮断ゲート：波が近づいたら開く
    for (const s of this.stoppers) {
      if (!s.armed || !s.gate || s.locked) continue;
      const sg = s.slot.seg || s.slot.piece;
      if (sg === (sl.seg || sl.piece) && sl.i >= s.slot.i - 3 && sl.i <= s.slot.i) s.release();
    }
  }

  updateRun(dt) {
    const run = this.run;
    run.t += dt;
    // スタートのパンチ
    if (run.punch != null && run.punch < 1) {
      run.punch += dt * 3;
      const arm = run.punchArm;
      const k = Math.sin(Math.min(1, run.punch) * Math.PI);
      arm.position.z = -1.8 + k * 1.3;
      if (!run.startPushed && run.punch > 0.45) {
        run.startPushed = true;
        const root = this.course.segments.find((s) => s.from.type === 'start');
        const d = root.slots[0].domino;
        if (d) this.dominoes.push(d, Math.sin(this.def.start.yaw), Math.cos(this.def.start.yaw), 0.07);
        this.audio.punch();
      }
    }
    // 終了判定：新しい転倒がしばらく無く、ギミックも止まっている
    if (this.goal.stage !== run.goalStage) { run.goalStage = this.goal.stage; run.goalStageT = run.t; }
    const goalBusy = this.goal.stage >= 1 && this.goal.stage < 5 && run.t - (run.goalStageT || 0) < 8;
    const moving = this.pieces.some((p) => p.isMoving && p.isMoving()) || goalBusy;
    if (moving) run.lastTopple = run.t;
    const idle = run.t - Math.max(run.lastTopple, 0.8);
    if ((run.goal && run.t - run.goalT > 2.5) || idle > CFG.runIdleEnd || run.t > 600) this.endRun();
  }

  onPieceFire(pc) {
    this.emit('launch', pc);
    const run = this.run;
    if (!run) return;
    const inSeg = this.course.segments.find((x) => x.to && x.to.type === 'piece' && x.to.piece === pc.id);
    const last = inSeg && inSeg.slots[inSeg.slots.length - 1];
    if (last && run.chainSlots.has(last)) run.chainPieces.add(pc);
  }

  onGoal() {
    if (!this.run || this.run.kind !== 'main') return;
    const feeder = this.course.goalFeeder();
    if (!feeder || !this.run.chainSlots.has(feeder)) {
      this.run.goalRogue = true;
      this.fx.floatAt(tmp.copy(this.goal.focus()).setY(4), 'ゴールが先に動いてしまった…（連鎖がつながっていない）', 'warn', 2.5);
      return;
    }
    this.run.goal = true;
    this.run.goalT = this.run.t;
    this.audio.goal();
    this.fx.confetti(tmp.copy(this.goal.focus()).setY(3), 160, 9);
    this.emit('goal', this.run);
  }

  /** 連鎖の結果を分析して、止まった場所と理由を返す */
  analyze() {
    const run = this.run;
    let stop = null, reason = '', bestOrder = -1;
    for (const d of run.toppled) {
      const sl = d.slot;
      for (const nx of this.course.successors(sl)) {
        if (nx.goal) { if (!this.goal.triggered && sl.order > bestOrder) { bestOrder = sl.order; stop = sl; reason = 'ゴール装置を最後まで動かせなかった'; } continue; }
        if (nx.piece && nx.x === undefined) {
          const pc = nx.piece;
          const o = this.course.segments.find((x) => x.from.type === 'piece' && x.from.piece === pc.id);
          const f = o && o.slots[0];
          if (sl.order <= bestOrder) continue;
          if (!pc.fired && pc.trigger) { bestOrder = sl.order; stop = sl; reason = `${PIECE_LABEL[pc.type]}が作動しなかった`; }
          else if (pc.fired && f && !(f.domino && run.toppled.has(f.domino))) { bestOrder = sl.order; stop = f; reason = f.domino ? `${PIECE_LABEL[pc.type]}が次のドミノを倒せなかった` : `${PIECE_LABEL[pc.type]}の先が未建設`; }
          else if (pc.fired && !o) { bestOrder = sl.order; stop = sl; reason = `${PIECE_LABEL[pc.type]}の出口からコースが続いていない`; }
          continue;
        }
        if (nx.domino && run.toppled.has(nx.domino)) continue;
        if (sl.order <= bestOrder) continue;
        bestOrder = sl.order; stop = nx;
        const st = this.stoppers.find((s) => (s.slot === sl || s.slot === nx) && s.armed);
        if (!nx.domino) reason = '未建設のすき間があった';
        else if (st) reason = st.locked ? 'ストッパーが解除されていなかった（ロック中）' : 'ストッパーが閉じたままだった';
        else if (nx.domino.byRoomba) reason = 'ルンバに壊された';
        else if (nx.domino.toppled && !run.toppled.has(nx.domino)) reason = '先のドミノが倒れたままだった（事故・ルンバ被害）';
        else if (!this.dominoes.isStandingAt(nx.domino, nx)) reason = 'ずれたドミノがあった';
        else reason = nx.warn || sl.warn ? '急カーブで物理的に止まった' : '物理的に止まった（間隔・角度）';
      }
    }
    if (!stop && !this.goal.triggered) {
      if (run.count > 0) {
        let last = null;
        for (const d of run.toppled) if (!last || d.slot.order > last.order) last = d.slot;
        stop = last; reason = run.goalRogue ? 'ゴールが先に作動してしまった（連鎖がつながっていない）' : 'コースの終わりまで倒れたが、ゴール装置につながっていない';
      } else {
        const root = this.course.segments.find((s) => s.from.type === 'start');
        stop = root && root.slots[0]; reason = '最初のドミノが倒れなかった';
      }
    }
    return { stop, reason };
  }

  endRun() {
    const run = this.run;
    if (!run) return;
    this.mode = 'build';
    if (run.kind === 'test') return this.endTest();
    const rec = this.records[this.stageId];
    const cleared = run.goal && run.count >= this.stage.target;
    const { stop, reason } = cleared ? { stop: null, reason: '' } : this.analyze();
    this.planView.showStop(stop);
    const prevBest = rec.best;
    // 経験値
    let piggy = 0;
    if (this.piggy) piggy = cleared ? run.piggy : Math.floor(run.piggy / 2);
    const xp = xpForRun(run.count, prevBest, piggy);
    const orbs = this.collectOrbs(run);
    xp.orbs = orbs * CFG.orbXP;
    xp.total += xp.orbs;
    if (run.bells && !this.roomba) { xp.total += 30 * run.bells; xp.bell = 30 * run.bells; }
    const ups = this.progress.addXP(xp.total);
    // 特別報酬のガチャ券
    const T = this.progress.tickets;
    for (let i = 0; i < run.presents; i++) T.push({ source: 'present', label: '🎁 プレゼントドミノ', rarityMin: 'rare' });
    if (run.clovers) this.progress.extraChoice = 2;
    for (const c of run.chest) T.push({ source: 'chest', label: '🧰 宝箱のお宝', rarityMin: 'rare', choices: 4 });
    if (run.gacha) T.push({ source: 'machine', label: `🎰 ドミノ式ガチャ（${CATEGORY[this.gachaMachine.category].label}）`, category: this.gachaMachine.category, choices: 4, ignoreLevel: true });
    const newBest = run.count > prevBest;
    if (newBest) { rec.best = run.count; if (prevBest > 0) T.push({ source: 'trophy', label: '🏆 記録更新トロフィー', rarityMin: 'rare' }); }
    if (cleared && !rec.cleared) {
      rec.cleared = true;
      T.push({ source: 'clear', label: '👑 ステージクリア報酬', rarityMin: 'epic', choices: 4, ignoreLevel: true });
      T.push({ source: 'clear', label: '👑 ステージクリア報酬', rarityMin: 'rare', choices: 4, ignoreLevel: true });
      this.finalChest.opened = true;
      if (this.stageId === 1) this.unlockedStage = Math.max(this.unlockedStage, 2);
    }
    // ストッパーは落ち着いたら再設置（再武装）
    this.rearmPending = true;
    const result = {
      stage: this.stageId, count: run.count, target: this.stage.target, cleared, goal: run.goal, stop, reason,
      xp, levelUps: ups, newBest, prevBest, presents: run.presents, chests: run.chest.length, gacha: run.gacha, clovers: run.clovers,
      piggy, piggyLost: this.piggy && !cleared ? run.piggy - piggy : 0, roombaHits: run.roombaHits, time: run.t,
    };
    this.lastResult = result;
    this.run = null;
    for (const g of this.workers.list) g.think();
    this.emit('runEnd', result);
    return result;
  }

  collectOrbs(run) {
    const rad = 2.5 + (this.level('magnet') ? 6 + 6 * this.level('magnet') : 0);
    let n = 0;
    const pts = [...run.toppled].filter((d) => !d.removed).map((d) => d.body.translation());
    for (const m of this.markers) {
      if (m.type !== 'orbs') continue;
      for (const o of m.orbs) {
        if (o.taken) continue;
        let hit = null;
        for (const p of pts) if ((p.x - o.mesh.position.x) ** 2 + (p.z - o.mesh.position.z) ** 2 < rad * rad) { hit = p; break; }
        if (hit) { o.taken = true; n++; this.fx.suck(o.mesh, this.magnetTarget(hit)); }
      }
      if (m.orbs.every((o) => o.taken)) m.respawn = 2;
    }
    if (n) this.audio.magnet(n);
    return n;
  }
  magnetTarget(p) { return new THREE.Vector3(p.x, 1.5, p.z); }
  spawnOrbs(m) {
    m.orbs.forEach((o) => this.scene.remove(o.mesh));
    m.orbs = [];
    for (let i = 0; i < 8; i++) {
      const mesh = orbMesh();
      const a = (i / 8) * Math.PI * 2, rr = 1.5 + (i % 3) * 1.2;
      mesh.position.set(m.x + Math.cos(a) * rr, 1.2 + (i % 2) * 0.4, m.z + Math.sin(a) * rr);
      this.scene.add(mesh);
      m.orbs.push({ mesh, taken: false, base: mesh.position.y, ph: Math.random() * 6 });
    }
  }

  // ---------- 区間テスト ----------
  startSectionTest(a, b) {
    if (this.mode !== 'build') return false;
    const slots = this.course.allSlots.filter((s) => s.order >= a && s.order <= b);
    const first = this.course.allSlots.find((s) => s.order === a);
    if (!first || !first.domino || !this.dominoes.isStandingAt(first.domino, first)) { this.audio.deny(); return false; }
    const snap = slots.map((s) => ({ s, standing: !!(s.domino && this.dominoes.isStandingAt(s.domino, s)) }));
    // 範囲の最後の先に一時ストッパー
    const last = this.course.allSlots.find((s) => s.order === b);
    let temp = null;
    if (last) {
      const nx = this.course.successors(last).find((x) => x.x != null);
      if (nx) temp = new Stopper(this.scene, this.physics, last, nx, {});
    }
    const released = [];
    for (const s of this.stoppers) if (s.slot.order >= a && s.slot.order < b && !s.locked && s.armed) { s.release(); released.push(s); }
    this.mode = 'test';
    this.run = { kind: 'test', t: 0, lastTopple: 0, toppled: new Set(), count: 0, frontOrder: -1, frontPos: null, a, b, snap, temp, released, total: slots.length, rogue: new Set(), chainSlots: new Set(), chainPieces: new Set() };
    this.dominoes.push(first.domino, Math.sin(first.yaw), Math.cos(first.yaw), 0.07);
    this.audio.start();
    this.emit('testStart', this.run);
    return true;
  }
  endTest() {
    const run = this.run;
    // 最後の1枚は一時ストッパーに寄りかかって止まるので、その手前まで倒れれば成功
    const reached = run.frontOrder >= run.b - 1 ? run.b : run.frontOrder;
    const ok = reached >= run.b;
    // 元の配置に復元
    for (const { s, standing } of run.snap) {
      if (s.domino) { this.dominoes.remove(s.domino); s.domino = null; }
      if (standing) { const kind = s.kind === 'wide' ? 'wide' : s.special ? s.special.type : 'normal'; s.domino = this.dominoes.create(s, { slot: s, kind, colorIndex: Math.floor(Math.max(0, s.order) / 4) }); }
    }
    if (run.temp) run.temp.dispose();
    for (const s of run.released) s.arm();
    for (const p of this.pieces) p.reset && p.reset();
    this.run = null;
    this.unbuiltDirty = true;
    const res = { ok, reached: Math.max(0, reached - run.a + 1), total: run.b - run.a + 1, count: run.count };
    this.emit('testEnd', res);
    for (const g of this.workers.list) g.think();
    return res;
  }

  // ---------- ぜんまい巻き戻し ----------
  takeSnapshot() {
    return this.course.allSlots.map((s) => ({ s, standing: !!(s.domino && this.dominoes.isStandingAt(s.domino, s)) }));
  }
  rewind() {
    if (this.mode !== 'build' || !this.snapshot || this.rewinds <= 0) return false;
    this.rewinds--;
    let made = 0;
    for (const { s, standing } of this.snapshot) {
      if (!this.course.allSlots.includes(s)) continue;
      if (s.domino && (!standing || !this.dominoes.isStandingAt(s.domino, s))) { this.dominoes.remove(s.domino); s.domino = null; if (!standing) this.stock++; }
      if (standing && !s.domino) {
        const kind = s.kind === 'wide' ? 'wide' : s.special ? s.special.type : 'normal';
        s.domino = this.dominoes.create(s, { slot: s, kind, colorIndex: Math.floor(Math.max(0, s.order) / 4) });
        made++;
      }
    }
    // 散らばったドミノ（コース外）は巻き戻しで回収扱い
    for (const d of [...this.dominoes.list]) if (!d.slot && !d.dumped) { this.dominoes.remove(d); }
    for (const s of this.stoppers) if (!s.armed) s.arm();
    for (const p of this.pieces) p.reset && p.reset();
    this.goal.reset();
    this.planView.showStop(null);
    this.unbuiltDirty = true;
    this.audio.rewind();
    this.fx.confetti(tmp.set(this.def.start.x, 0.5, this.def.start.z), 40, 5);
    this.emit('rewind', made);
    void made;
    return true;
  }

  // ================= 毎フレーム =================
  update(dt) {
    this.time += dt;
    this.physics.update(dt);
    this.dominoes.update(dt);
    if (this.run) this.updateRun(dt);
    this.goal.update(dt);
    for (const p of this.pieces) p.update(dt);
    for (const s of this.stoppers) s.update(dt);
    if (this.roomba) this.roomba.update(dt, this);
    this.updateThrows(dt);
    this.updateAlarm(dt);
    this.workers.update(dt);
    this.crate.update(dt);
    this.machine.update(dt);
    this.train.update(dt);
    this.factory.update(dt);
    this.planView.update(dt, this);
    // 予約の掃除：持ち主が仕事をしていない予約を解放（進行不能の防止）
    if ((this.claimT = (this.claimT || 0) - dt) <= 0) {
      this.claimT = 2;
      const held = new Set(this.workers.list.map((w) => w.job).filter(Boolean));
      for (const d of this.dominoes.list) if (d.claim && !held.has(d)) d.claim = 0;
      for (const sl of this.course.allSlots) if (sl.claim && sl.claim !== -1 && !held.has(sl)) sl.claim = 0;
    }
    // ストッパーの再武装（両隣が立ったら）
    if (this.mode === 'build' && (this.rearmT = (this.rearmT || 0) - dt) <= 0) {
      this.rearmT = 0.5;
      for (const s of this.stoppers) {
        if (s.armed) continue;
        const okA = !s.slot.domino || this.dominoes.isStandingAt(s.slot.domino, s.slot);
        const okB = !s.next.domino || this.dominoes.isStandingAt(s.next.domino, s.next);
        if (okA && okB) s.arm();
      }
    }
    // 一時バリケードの撤去
    for (let i = this.tempBarricades.length - 1; i >= 0; i--) {
      const b = this.tempBarricades[i]; b.t -= dt;
      b.mesh.position.y = b.t < 1 ? -(1 - b.t) * 2 : 0;
      if (b.t <= 0) { this.scene.remove(b.mesh); this.tempBarricades.splice(i, 1); }
    }
    // 演出：マーカー・宝箱・ガチャマシン・ベル・オーブ
    for (const m of this.markers) {
      if (m.mesh && m.mesh.userData.spin) { m.mesh.userData.spin.rotation.y += dt * 1.5; m.mesh.userData.spin.position.y = 1.3 + Math.sin(this.time * 2 + m.i) * 0.15; }
      for (const o of m.orbs) if (!o.taken && !o.sucking) { o.mesh.rotation.y += dt * 2; o.mesh.position.y = o.base + Math.sin(this.time * 2.4 + o.ph) * 0.2; }
    }
    for (const c of [...this.chests, this.finalChest]) {
      if (c.opened && c.openT < 1) { c.openT = Math.min(1, c.openT + dt * 1.5); c.mesh.userData.lid.rotation.x = -c.openT * 1.9; c.mesh.userData.glow.material.opacity = 0.5 * Math.sin(c.openT * Math.PI); }
    }
    const gm = this.gachaMachine;
    if (gm.spin > 0) { gm.spin -= dt; gm.mesh.userData.handle.rotation.z += dt * 10; }
    for (const p of this.placed) if (p.type === 'bell' && p.rung > 0) { p.rung -= dt; p.mesh.userData.bell.rotation.x = Math.sin(p.rung * 20) * 0.5 * p.rung; }
    if (this.piggy && this.run && this.run.kind === 'main') { const s = 1 + Math.min(0.6, this.run.piggy / 800); this.piggy.mesh.userData.body.scale.set(1.25 * s, s, s); }
  }

  /** ラン終了後に呼ぶ：オーブの再出現など */
  afterRunMaintenance() {
    for (const m of this.markers) if (m.type === 'orbs' && m.respawn > 0) { m.respawn--; if (m.respawn === 0) this.spawnOrbs(m); }
  }

  // ================= 集計 =================
  buildProgress() {
    const total = this.course.allSlots.length;
    let standing = 0;
    for (const s of this.course.allSlots) if (s.domino && this.dominoes.isStandingAt(s.domino, s)) standing++;
    return { total, standing, unbuilt: this.unbuiltCount() };
  }
  totalDominoes() {
    let inCourse = 0;
    for (const d of this.dominoes.list) inCourse++;
    return this.stock + this.crate.count + this.machine.hopper + this.workers.inHands() + inCourse + (this.roomba ? this.roomba.bin : 0) + this.train.load;
  }

  // ================= セーブ =================
  serializeStage() {
    const slotKey = (s) => (s.seg && s.seg.slots ? `s${s.seg.id}:${s.i}` : `p${s.piece.id}:${s.i}`);
    const built = [];
    for (const s of this.course.allSlots) {
      if (!s.domino) continue;
      if (this.dominoes.isStandingAt(s.domino, s)) built.push([slotKey(s), 1]);
      else { const t = s.domino.body.translation(), r = s.domino.body.rotation(); built.push([slotKey(s), 2, +t.x.toFixed(2), +t.y.toFixed(3), +t.z.toFixed(2), +r.x.toFixed(3), +r.y.toFixed(3), +r.z.toFixed(3), +r.w.toFixed(3)]); }
    }
    const loose = [];
    for (const d of this.dominoes.list) if (!d.slot) { const t = d.body.translation(); loose.push([+t.x.toFixed(2), +t.z.toFixed(2)]); }
    return {
      course: this.course.serialize(),
      pieces: this.pieces.map((p) => ({ id: p.id, type: p.type, x: p.x, z: p.z, yaw: p.yaw })),
      placed: this.placed.map((p) => ({ type: p.type, x: p.x, z: p.z, yaw: p.yaw })),
      built, loose,
      stoppers: this.stoppers.map((s) => [slotKey(s.slot), slotKey(s.next), s.locked ? 1 : 0, s.emergency ? 1 : 0]),
      markers: this.markers.map((m) => (m.consumed ? 1 : 0)),
      chests: this.chests.map((c) => (c.opened ? 1 : 0)),
      gachaUsed: this.gachaMachine.used,
      finalChest: this.finalChest.opened,
      stock: this.stock + this.crate.count + this.machine.hopper + this.workers.inHands() + this.train.load + (this.roomba ? this.roomba.bin : 0),
      pieceSeq: this.pieceSeq || 0,
    };
  }
  applyStageSave(d) {
    this.pieceSeq = 0;
    for (const p of d.pieces || []) {
      this.pieceSeq = Math.max(this.pieceSeq, p.id - 1);
      const piece = p.type === 'bridge' ? new BridgePiece(this.scene, this.physics, p, p.id) : new LauncherPiece(this.scene, this.physics, p.type, p, p.id);
      piece.onFire = (pc) => this.onPieceFire(pc);
      this.pieces.push(piece);
      this.pieceSeq = Math.max(this.pieceSeq, p.id);
    }
    this.course.pieces = this.pieces;
    const c = d.course || { segments: [] };
    this.course.nextSeg = c.nextSeg || 1;
    // 親から順に復元（分岐やピースの出口は親が先に必要）
    const pending = [...(c.segments || [])];
    let guard = 0;
    while (pending.length && guard++ < 200) {
      const s = pending.shift();
      if (s.from.type === 'branch' && !this.course.segById(s.from.seg)) { pending.push(s); continue; }
      const seg = { id: s.id, pts: s.pts.map(([x, z]) => ({ x, z })), from: s.from, to: s.to, slots: [] };
      this.course.segments.push(seg);
      this.course.rebuild(seg);
      seg.to = s.to;
      this.course.rebuild(seg);
    }
    this.course.pieces = this.pieces;
    this.course.refresh();
    (d.markers || []).forEach((v, i) => { const m = this.markers[i]; if (m && v) { m.consumed = true; if (m.mesh) this.scene.remove(m.mesh); } });
    (d.chests || []).forEach((v, i) => { if (this.chests[i] && v) { this.chests[i].opened = true; this.chests[i].openT = 1; this.chests[i].mesh.userData.lid.rotation.x = -1.9; } });
    this.gachaMachine.used = !!d.gachaUsed;
    if (d.finalChest) { this.finalChest.opened = true; this.finalChest.openT = 1; this.finalChest.mesh.userData.lid.rotation.x = -1.9; }
    this.refreshCourse();
    const byKey = new Map();
    for (const s of this.course.allSlots) byKey.set(s.seg && s.seg.slots ? `s${s.seg.id}:${s.i}` : `p${s.piece.id}:${s.i}`, s);
    let used = 0;
    for (const b of d.built || []) {
      const s = byKey.get(b[0]);
      if (!s || s.domino) continue;
      const kind = s.kind === 'wide' ? 'wide' : s.special ? s.special.type : 'normal';
      if (b[1] === 1) s.domino = this.dominoes.create(s, { slot: s, kind, colorIndex: Math.floor(Math.max(0, s.order) / 4) });
      else s.domino = this.dominoes.create({ x: b[2], y: b[3], z: b[4] }, { slot: s, kind, quat: { x: b[5], y: b[6], z: b[7], w: b[8] }, frozen: true });
      used++;
    }
    for (const [x, z] of d.loose || []) { this.dominoes.create({ x, y: 0, z, yaw: Math.random() * 6 }, { lying: true, frozen: true }); used++; }
    for (const p of d.placed || []) this.placePiece(p.type, p.x, p.z, p.yaw, true) || null;
    for (const st of d.stoppers || []) {
      const a = byKey.get(st[0]), b = byKey.get(st[1]);
      if (a && b) { const s = this.installStopper(a, b, !!st[3]); if (s && st[2]) s.setLocked(true); }
    }
    this.stock = d.stock ?? CFG.startStock;
    void used;
  }
}

export { PARTS, EVOLUTIONS, PLACEABLE };
