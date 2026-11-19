import * as THREE from 'three';
import { CFG } from '../config.js';
import { Physics } from '../core/physics.js';
import { Dominoes } from '../core/dominoes.js';
import { Course } from '../core/course.js';
import { createStage, STAGES } from '../world/stages.js';
import {
  GoalBell, LauncherPiece, BridgePiece, Stopper, barricadeMesh, footbridgeMesh, sensorMesh, bellPieceMesh, chestMesh,
  gachaMachineMesh, markerMesh, orbMesh, towerMesh, hqMesh, startPadMesh, piggyMesh,
} from '../world/devices.js';
import { Roomba } from '../world/roomba.js';
import { GoalMachine } from '../world/goalMachine.js';
import { Checkpoint } from '../world/checkpoints.js';
import { Mouse, RollingBall } from '../world/threats.js';
import { MischiefRobot, RunawayCar } from '../world/enemies.js';
import { Darts } from './defense.js';
import { ToyRailway } from '../world/toyrail.js';
import { Crossings } from './crossings.js';
import { Grabbables, propEntry, carryEntry, addHitProxy } from './grabbables.js';
import { NavGrid } from './nav.js';
import { campVillage, StorageShelf, ROLE_CAMP, SMALL_PARTS } from '../world/camps.js';
import { CampLife } from './campLife.js';
import { RailPlans } from './railPlan.js';
import { Metrics } from './metrics.js';
import { autoConnect, plankMesh } from './chief.js';
import { Workers } from '../actors/workers.js';
import { Depot, Crate, Machine, Train, Factory, SupplyPile } from './facilities.js';
import { PlanView } from './planView.js';
import { Progress, xpForRun } from './progress.js';
import { PARTS, EVOLUTIONS, CATEGORY, DEFENSE } from '../data/parts.js';

const tmp = new THREE.Vector3();
const ROLE_PARTS = ['builder', 'carrier', 'collector', 'stopperCrew', 'restorer', 'guard', 'soldier'];
// 配置して使うパーツ：id -> 1レベルあたりの個数
const MAP_LAYOUT = 2; // Ver.0.5 で部屋を約20%広げた配置
const PLACEABLE = { minicar: 1, marble: 1, bridge: 1, bell: 1, barricade: 3, sensor: 2, footbridge: 1 };
const FOOTBRIDGE_L = 7.5, FOOTBRIDGE_H = 2.0;
export const PIECE_LABEL = { minicar: 'ミニカー発射台', marble: 'ビー玉スロープ', bridge: '高架橋', bell: '特殊ベル', barricade: 'バリケード', sensor: '接近センサー', footbridge: '歩道橋' };

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
    this.physics.onStep((dt) => this.hand && this.hand.step(dt));
    if (this.hand) { this.hand.held = null; this.hand.flying.clear(); }
    this.stage = createStage(id, this.scene, this.physics);
    this.stage.extraBlockers = [(x, z, m, forRoomba, ignoreMovable) => this.pieceBlocks(x, z, m, forRoomba) || (!ignoreMovable && this.factoryBlocks(x, z, m))];
    this.dominoes = new Dominoes(this.scene, this.physics);
    this.dominoes.onTopple = (d) => this.onTopple(d);
    this.course = new Course(this.stage);
    this.planView = new PlanView(this.scene);
    this.depots = this.def.depots.map((p, i) => new Depot(this, p.x, p.z, i));
    this.crate = new Crate(this);
    this.pile = new SupplyPile(this);
    this.crate.pos.set(this.def.start.x + 3, 0, this.def.start.z + 3);
    this.machine = new Machine(this);
    this.machine.pos.set(this.depots[0].pos.x + 3, 0, this.depots[0].pos.z + 3);
    this.train = new Train(this);
    this.train.pos.copy(this.depots[0].pos);
    // 獲得物の行き先（看板）と倉庫の棚
    const camps = this.def.camps || {};
    this.campMeshes = [];
    // Ver.0.6：待機所は小人の村（家・庭・ハンモック・休憩所・遊び道具）。小人どうしの遊びや声かけは campLife が受け持つ
    this.campLife = new CampLife(this);
    for (const [k, c] of Object.entries(camps)) if (k !== 'storage') {
      const vg = campVillage(k); vg.group.position.set(c.x, 0, c.z); vg.group.rotation.y = c.yaw || 0; this.scene.add(vg.group); this.campMeshes.push(vg.group);
      for (const o of vg.obstacles) this.stage.obstacles.push({ x: c.x + o.x, z: c.z + o.z, hw: o.hw, hd: o.hd, yaw: 0, roomba: true, build: true, camp: k });
      this.campLife.addVillage(k, new THREE.Vector3(c.x, 0, c.z), vg.spots);
    }
    this.shelf = camps.storage ? new StorageShelf(this.scene, camps.storage) : null;
    if (camps.storage) this.stage.obstacles.push({ x: camps.storage.x, z: camps.storage.z, hw: 3.8, hd: 1.2, yaw: 0, roomba: true, build: true });
    const fs = this.def.factorySpot;
    const fp = fs ? new THREE.Vector3(fs.x, 0, fs.z) : camps.machines ? new THREE.Vector3(camps.machines.x, 0, camps.machines.z) : this.depots[0].pos.clone().add(new THREE.Vector3(6, 0, 3));
    this.factory = new Factory(this, fp);
    this.workers = new Workers(this);
    this.metrics = new Metrics(this);
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
    // （v0.2 の床置きガチャマシン・宝箱・プレゼントは廃止。報酬は連鎖で作動する中間ゴールから）
    this.gachaMachine = { x: 1e6, z: 1e6, used: true, spin: 0, category: 'build', mesh: new THREE.Group() };
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
    this.history = this.history || [];
    // CPU が設計した固定コース
    this.buildDesignedCourse();
    // Ver.0.6：ステージ2の青い線路（おもちゃの鉄道）。中間ゴールの装置より先に作る（線路の上に置かないため）
    this.railway = this.def.toyRail ? new ToyRailway(this, this.def.toyRail) : null;
    this.setupCheckpoints();
    this.crossings = this.railway ? new Crossings(this, this.railway) : null;
    // Ver.0.6：ぽっぽ線の路線計画（支線を自分で延ばす）
    this.railPlans = this.railway && this.def.toyRail.plans ? new RailPlans(this, this.railway, this.def.toyRail.plans) : null;
    if (data) this.applyStageSave(data);
    this.syncPartsToWorld(true);
    this.refreshCourse();
    // 小さな脅威（ネズミ・ボール）
    this.threats = [];
    if (this.def.mouse) this.threats.push(new Mouse(this, this.def.mouse));
    if (this.def.ball) this.threats.push(new RollingBall(this, this.def.ball));
    if (this.def.robot) this.threats.push(new MischiefRobot(this, this.def.robot));
    if (this.def.car) this.threats.push(new RunawayCar(this, this.def.car));
    this.darts = new Darts(this);
    this.registerGrabbables();
    if (data) this.applyGrabSave(data);
    // 経路探索のグリッド（家具・小物・ドミノ）。歩道橋は通路として登録
    this.nav = new NavGrid(this);
    for (const p of this.placed) if (p.type === 'footbridge' || p.type === 'plank') this.nav.addBridge(p.a, p.b);
    // ゲーム開始：建設開始地点近くの資材箱にドミノ50個（在庫から「移す」ので総数は増えない）。
    // 資材箱の中身を保存しているセーブ（grab.crate）では保存された数をそのまま使う（再読み込みで増えない）
    // Ver.0.5.2：補充漏れ（Ver.0.5 の不具合）で空のまま保存された資材箱も、一度だけ在庫から移す（最大50枚。総数は変わらない）。
    // 修正後に保存した資材箱（refill:2 付き）は、プレイヤーが空にした状態でもそのまま使う
    const savedCrate = data && data.grab && data.grab.crate;
    const emptyFromBug = savedCrate && savedCrate.n === 0 && savedCrate.refill !== 2;
    if ((!savedCrate || emptyFromBug) && this.crate.count === 0 && !this.def.noStartCrate) {
      const n = Math.min(50, this.stock); this.stock -= n; this.crate.count += n;
      if (emptyFromBug && n > 0) this.fx.floatAt(this.crate.pos.clone().setY(2.4), `📦 倉庫から ${n}枚を前線の資材箱へ移しました`, 'coin', 3);
    }
    this.crate.syncCollider(true); // 読み込み時だけ位置を直接合わせる（周りにまだ動くドミノはない）
    this.emit('stageLoaded', id);
  }

  // ================= つかめるオブジェクト =================
  registerGrabbables() {
    const G = (this.grabbables = new Grabbables(this));
    this.dynamicProps = new Set();
    this.propEntries = (this.stage.props || []).map((p) => G.add(propEntry(this, p)));
    const notRun = () => this.mode === 'build';
    // 資材箱：中のドミノは1枚ずつ取り出し、縁や旗をつかむと箱ごと運ぶ（運んだ場所に固定され、建設の先頭を追わなくなる）
    this.crateEntry = G.add(carryEntry(this, { name: '前線の資材箱', kind: 'facility', obj: this.crate.group, radius: 1.5, height: 1.0, canGrab: notRun, foot: { hw: 1.2, hd: 0.9 }, ownBody: true,
      getPos: () => this.crate.pos.clone(), setPos: (v) => this.crate.pos.copy(v),
      onGrab: () => { this.crate.carried = true; this.crate.pinned = true; }, onDrop: () => { this.crate.carried = false; this.crate.pinT = this.time; this.crate.pos.y = this.stage.heightAt(this.crate.pos.x, this.crate.pos.z); this.navDirty = true; } }));
    G.add(carryEntry(this, { name: 'ドミノ自動設置機', kind: 'facility', obj: this.machine.group, radius: 1.6, height: 2.6, canGrab: () => notRun() && this.machineActive() && this.level('machine') > 0,
      getPos: () => this.machine.pos.clone(), setPos: (v) => this.machine.pos.copy(v), onGrab: () => { this.machine.carried = true; }, onDrop: () => { this.machine.carried = false; } }));
    this.trainEntry = G.add(carryEntry(this, { name: '資材運搬トレイン', kind: 'facility', obj: this.train.mesh, radius: 1.6, height: 1.6, canGrab: () => notRun() && this.level('train') > 0,
      getPos: () => this.train.pos.clone(), setPos: (v) => this.train.pos.copy(v), onGrab: () => { this.train.carried = true; }, onDrop: () => { this.train.carried = false; } }));
    this.factoryEntry = G.add(carryEntry(this, { name: 'ドミノ製造機', kind: 'facility', obj: this.factory.group, radius: 2.6, height: 3.6, canGrab: notRun, foot: { hw: 4.95, hd: 2.1, ox: 2.45 },
      getPos: () => this.factory.group.position.clone(), setPos: (v) => this.factory.group.position.copy(v), onGrab: () => { this.factory.carried = true; }, onDrop: () => { this.factory.carried = false; this.navDirty = true; } }));
    for (const w of this.workers.list) this.addWorkerGrab(w);
    for (const p of this.placed) this.addPieceGrab(p);
    for (const th of this.threats) {
      if (th instanceof Mouse && !th.hitProxy) th.hitProxy = addHitProxy(th.group, 0.7, 0.9);
      if (th instanceof Mouse) G.add(carryEntry(this, { name: 'いたずらネズミ', kind: 'threat', obj: th.group, radius: 0.5, height: 0.8, canGrab: () => notRun() && th.state !== 'den',
        getPos: () => th.pos.clone(), setPos: (v) => th.pos.copy(v), onGrab: () => { th.held = true; this.fx.floatAt(th.pos.clone().setY(1.6), 'チュ〜！？', 'warn', 1); }, onDrop: () => { th.held = false; th.startReturn(); } }));
      if ((th instanceof MischiefRobot || th instanceof RunawayCar) && !th.hitProxy) th.hitProxy = addHitProxy(th.group, th instanceof RunawayCar ? 1.0 : 0.8, th instanceof RunawayCar ? 0.8 : 2.0);
      if (th instanceof MischiefRobot) G.add(carryEntry(this, { name: 'いたずらロボット', kind: 'threat', obj: th.group, radius: 0.7, height: 2.0, canGrab: notRun,
        getPos: () => th.pos.clone(), setPos: (v) => th.pos.copy(v), onGrab: () => { th.held = true; th.knock = null; this.fx.floatAt(th.pos.clone().setY(2.4), 'ピピッ！？', 'warn', 1); }, onDrop: () => { th.held = false; th.pos.y = 0; th.stun = 1.2; th.startReturn(); this.stats.robotGrabbed = (this.stats.robotGrabbed || 0) + 1; } }));
      if (th instanceof RunawayCar) G.add(carryEntry(this, { name: '暴走ミニカー', kind: 'threat', obj: th.group, radius: 0.9, height: 0.8, canGrab: () => notRun() && th.state !== 'drive',
        getPos: () => th.pos.clone(), setPos: (v) => th.pos.copy(v), onGrab: () => { th.held = true; }, onDrop: () => { th.held = false; th.pos.y = 0; th.arrow.material.opacity = 0; if (th.state === 'warn') { th.state = 'return'; th.pf.reset(); this.stats.carGrabbed = (this.stats.carGrabbed || 0) + 1; this.fx.floatAt(th.pos.clone().setY(1.6), 'ブロロ…（あきらめて車庫へ）', 'coin', 1.6); } } }));
      if (th instanceof RollingBall) G.add({ name: 'ゴムボール', kind: 'threat', obj: th.group, mode: 'body', body: th.body, radius: th.r, height: th.r * 2, canGrab: notRun, getPos: () => th.pos.setY(0), onGrab: () => { th.state = 'rest'; }, onDrop: () => {} });
    }
    if (this.piggy) this.addPiggyGrab();
  }
  /** 人がドミノにぶつかった（逃げている・道がなくて直進したとき）：物理的に押して倒す */
  /**
   * Ver.0.6：小人の体（半径 gnomeR の球を足元から3段）とドミノ（実際の箱の形・向き）の重なり。
   * 返り値は一番深いめり込み量（0＝当たっていない）。out を渡すと当たっているドミノを集める
   */
  bodyContact(x, z, y = 0, out = null) {
    const R = CFG.gnomeR, hw = CFG.dominoW / 2, hh = CFG.dominoH / 2, ht = CFG.dominoT / 2;
    let depth = 0;
    for (const d of this.dominoes.near(x, z)) {
      if (d.held || d.removed) continue;
      const t = d.body.translation();
      if (t.y - y > 1.4 || t.y - y < -0.6 || (t.x - x) ** 2 + (t.z - z) ** 2 > 1.1) continue;
      const q = d.body.rotation(), qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w; // 逆回転でドミノの局所座標へ
      for (const hgt of [0.2, 0.42, 0.64]) {
        const vx = x - t.x, vy = y + hgt - t.y, vz = z - t.z;
        const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
        const lx = vx + qw * tx + (qy * tz - qz * ty), ly = vy + qw * ty + (qz * tx - qx * tz), lz = vz + qw * tz + (qx * ty - qy * tx);
        const cx = Math.max(-hw, Math.min(hw, lx)), cy = Math.max(-hh, Math.min(hh, ly)), cz = Math.max(-ht, Math.min(ht, lz));
        const dd = Math.hypot(lx - cx, ly - cy, lz - cz);
        if (dd < R) { if (R - dd > depth) depth = R - dd; if (out && !out.includes(d)) out.push(d); }
      }
    }
    return depth;
  }
  /** 小人の体が当たっているドミノを、進む向きに押す（めり込んだ分だけの力。倒れるかどうかは物理しだい。確率は使わない） */
  pushByBody(w, dx, dz, dt) {
    const hits = [];
    const depth = this.bodyContact(w.pos.x + dx * 0.06, w.pos.z + dz * 0.06, w.pos.y, hits);
    if (!hits.length) return;
    for (const d of hits) {
      if (d.frozen) this.dominoes.unfreeze(d);
      const t = d.body.translation();
      const J = Math.min(0.07, 14 * Math.max(depth, 0.03) * dt); // 体重をかけて押す力（めり込みが深いほど強い）
      d.body.wakeUp();
      d.body.applyImpulseAtPoint({ x: dx * J, y: 0, z: dz * J }, { x: t.x, y: w.pos.y + 0.62, z: t.z }, true); // 肩の高さ（ドミノの重心より上）で押す
      if (!d._bodyHit || this.time - d._bodyHit > 1) { d._bodyHit = this.time; this.stats.workerBumps = (this.stats.workerBumps || 0) + 1; }
    }
    if (!w._bumpSay || this.time - w._bumpSay > 3) { w._bumpSay = this.time; w.say('あっ、ぶつかった！', 'warn'); }
  }
  /** 作業員が組み立て終えた通路を置く（踏み板＝基本の通路／歩道橋＝エリート建築士）。プレイヤーの歩道橋の数には含めない */
  addWalkway(kind, x, z, yaw) {
    if (kind === 'footbridge') { const p = this.placePiece('footbridge', x, z, yaw, true, true); if (p) p.auto = true; return p; }
    const L = 5.4, H = 1.3, mesh = plankMesh(L, H);
    mesh.position.set(x, 0, z); mesh.rotation.y = yaw; this.scene.add(mesh);
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    const p = { type: 'plank', x, z, yaw, mesh, slot: null, auto: true, len: L, height: H };
    p.a = new THREE.Vector3(x - ax * L / 2, 0, z - az * L / 2); p.b = new THREE.Vector3(x + ax * L / 2, 0, z + az * L / 2);
    if (this.nav) this.nav.addBridge(p.a, p.b);
    this.placed.push(p);
    this.navDirty = true;
    return p;
  }
  /** 歩道橋の上なら、その高さ（橋の中央が一番高いアーチ） */
  bridgeHeight(x, z) {
    for (const p of this.placed) {
      if (p.type !== 'footbridge' && p.type !== 'plank') continue;
      const ab = p.b.clone().sub(p.a), len = ab.length(); ab.divideScalar(len);
      const rx = x - p.a.x, rz = z - p.a.z;
      const along = rx * ab.x + rz * ab.z, side = Math.abs(-rx * ab.z + rz * ab.x);
      if (along < 0 || along > len || side > 0.8) continue;
      if (p.type === 'plank') return p.height * Math.max(0, Math.min(1, Math.min(along, len - along) / 1.0)); // 両端は坂、まん中は平ら
      return Math.sin((along / len) * Math.PI) * p.height;
    }
    return 0;
  }
  /**
   * 運んでいる・落下中の物の足元（e.foot の矩形、なければ円）が、壁・家具・ほかの設備に重なるか。
   * 重なる位置へは動かさない（手の移動で、その手前で止まる・壁に沿って滑る）
   */
  footBlocked(e, x, z) {
    const st = this.stage, yaw = e.obj ? e.obj.rotation.y || 0 : 0;
    const f = e.foot || { hw: e.radius * 0.7, hd: e.radius * 0.7 };
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pts = [];
    for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
      const lx = (f.ox || 0) + u * f.hw, lz = v * f.hd;
      pts.push([x + lx * c + lz * s, z - lx * s + lz * c]);
    }
    const self = e.obj;
    const cr = this.crate, fac = this.factory;
    for (const [px, pz] of pts) {
      if (!st.inBounds(px, pz, 0.1)) return true;
      if (st.blocked(px, pz, 0.05, false, true)) return true; // 家具・壁ぎわの物・配置パーツ
      if (fac && self !== fac.group && this.factoryBlocks(px, pz, 0.05)) return true; // 工場
      if (cr && self !== cr.group && !cr.carried && Math.abs(px - cr.pos.x) < 1.25 && Math.abs(pz - cr.pos.z) < 0.95) return true; // 資材箱
    }
    return false;
  }
  /** 置いた物が家具・壁にめり込んでいたら、近くの空いている所へずらす（読み込み時の古いセーブ用） */
  settleOut(pos, r) {
    const st = this.stage;
    const ok = (x, z) => st.inBounds(x, z, r) && !st.blocked(x, z, r * 0.8, false, true);
    if (ok(pos.x, pos.z)) return;
    for (let rad = 0.5; rad < 12; rad += 0.5) for (let a = 0; a < 16; a++) {
      const x = pos.x + Math.cos((a / 16) * Math.PI * 2) * rad, z = pos.z + Math.sin((a / 16) * Math.PI * 2) * rad;
      if (ok(x, z)) { pos.x = x; pos.z = z; return; }
    }
  }
  /** 資材箱：家具・壁と重ならない位置に置き、当たり判定（静的な箱）を合わせる */
  settleCrate() {
    this.settleOut(this.crate.pos, 1.4);
    this.crate.pos.y = this.stage.heightAt(this.crate.pos.x, this.crate.pos.z);
    this.crate.syncCollider && this.crate.syncCollider(true);
  }
  addWorkerGrab(w) {
    if (!this.grabbables) return;
    if (!w.hitProxy) w.hitProxy = addHitProxy(w.root, 0.5, 1.4);
    w.grabEntry = this.grabbables.add(carryEntry(this, { name: '人', kind: 'worker', obj: w.root, radius: 0.4, height: 1.3, canGrab: () => this.mode === 'build',
      getPos: () => w.pos.clone(), setPos: (v) => w.pos.copy(v), onGrab: () => w.grabbed(), onDrop: (p, sp) => w.dropped(sp) }));
  }
  addPieceGrab(p) {
    if (!this.grabbables) return;
    const names = { barricade: 'バリケード', bell: '特殊ベル', sensor: '接近センサー' };
    p.grabEntry = this.grabbables.add(carryEntry(this, { name: names[p.type] || p.type, kind: 'piece', obj: p.mesh, radius: p.type === 'barricade' ? 2.2 : 0.8, height: 1.2, canGrab: () => this.mode === 'build',
      getPos: () => p.mesh.position.clone(), setPos: (v) => p.mesh.position.copy(v), onDrop: (pos) => { p.x = pos.x; p.z = pos.z; this.refreshCourse(); this.navDirty = true; } }));
  }
  addPiggyGrab() {
    const pg = this.piggy;
    if (!this.grabbables || pg.grabEntry) return;
    pg.grabEntry = this.grabbables.add(carryEntry(this, { name: '欲張り貯金箱', kind: 'facility', obj: pg.mesh, radius: 1.4, height: 1.6, canGrab: () => this.mode === 'build' }));
  }
  /** 小物・資材箱・製造機の位置と、資材箱の中身を保存 */
  serializeGrab() {
    return {
      layout: this.def.mapLayout || MAP_LAYOUT,
      props: (this.propEntries || []).map((e) => e.serialize()),
      crate: { n: this.crate.count, x: +this.crate.pos.x.toFixed(2), z: +this.crate.pos.z.toFixed(2), yaw: +this.crate.group.rotation.y.toFixed(3), pinned: !!this.crate.pinned, refill: 2, stay: 1, ho: this.crate.haulOrder ?? -1 },
      factory: [+this.factory.group.position.x.toFixed(2), +this.factory.group.position.z.toFixed(2)],
    };
  }
  applyGrabSave(d) {
    const moved = d.grab;
    if (!moved) return;
    // Ver.0.5：部屋を広げた（家具の位置が変わった）ので、古い配置で保存された小物の位置は使わない。部屋の外の位置も使わない
    const props = moved.layout === (this.def.mapLayout || MAP_LAYOUT) ? moved.props || [] : [];
    props.forEach((v, i) => { const e = this.propEntries[i]; if (!e || !v || !this.stage.inBounds(v[0], v[1], 0.5)) return; const o = e.getPos(); if (Math.abs(o.x - v[0]) > 0.05 || Math.abs(o.z - v[1]) > 0.05 || Math.abs((e.obj.rotation.y || 0) - (v[2] || 0)) > 0.01) e.restore(v); });
    if (moved.crate) {
      this.crate.count = moved.crate.n;
      // Ver.0.6：資材箱は自分で動かないので、置いてあった場所をいつも復元する（以前のセーブの「先頭についていく箱」も最後の位置に置く）
      if (this.stage.inBounds(moved.crate.x, moved.crate.z, 1)) { this.crate.pos.set(moved.crate.x, 0, moved.crate.z); this.crate.group.rotation.y = moved.crate.yaw || 0; this.crate.pinned = !!moved.crate.pinned; this.crate.haulOrder = moved.crate.ho ?? -1; this.settleCrate(); }
    }
    if (moved.factory && moved.layout === (this.def.mapLayout || MAP_LAYOUT) && this.stage.inBounds(moved.factory[0], moved.factory[1], 2)) { this.factory.group.position.set(moved.factory[0], 0, moved.factory[1]); this.settleOut(this.factory.group.position, 2.6); }
  }

  // ================= 小さな脅威と防衛チュートリアル =================
  get flags() { return (this.records.flags ||= {}); }
  /** ネズミが出てくるか（ステージ1は中間ゴール2の到達後。ステージ2は最初から） */
  mouseUnlocked() {
    const m = this.def.mouse;
    if (!m) return false;
    const n = m.afterCheckpoint || 0;
    return !n || (this.checkpoints[n - 1] && this.checkpoints[n - 1].done);
  }
  /** 脅威の予告：自動事故防止チーム（進化）なら先回りして危険区間をストッパーで隔離する */
  onThreatWarn(th, slot) {
    if (th instanceof Mouse && th.tutorial) this.setHint('🐭 ネズミがドミノを狙っている！ 倒れ始めたら、連鎖の先のドミノを1枚つかんで抜こう', 14);
    if (!slot || !slot.seg || !slot.seg.slots || !(this.evolved('autoSafety') || this.evolved('stopperHQ'))) return;
    const seg = slot.seg, i = slot.i;
    let n = 0;
    for (const k of [4, -5]) {
      const a = seg.slots[i + k], b = seg.slots[i + k + 1];
      if (a && b && a.domino && b.domino && this.throwStopper(a, b, '先回りで隔離！')) n++;
    }
    if (n) { this.stats.predictiveIsolations = (this.stats.predictiveIsolations || 0) + 1; this.fx.floatAt(tmp.set(slot.x, 2.6, slot.z), '🚨 自動事故防止チーム：危険区間を隔離', 'coin', 2); }
  }
  onThreatHit(th, slot) {
    this.lastThreatHit = { t: this.time, x: slot.x, z: slot.z };
    if (th instanceof Mouse && th.tutorial && !this.flags.mouseTutorialDone) {
      this.flags.mouseTutorialDone = true;
      this.tutorialPending = this.time;
      this.setHint('⚠ 事故だ！ 連鎖の先のドミノを1枚つかんで抜くと止まる！', 10);
    }
  }
  setHint(text, sec) { this.hint = { text, until: this.time + sec }; }
  /** 手で抜いて事故を止めたか（倒れ始めて数秒以内に、近くの立っているドミノをつかんだ） */
  onHandGrab(d) {
    const t = d.body.translation();
    const recent = [...this.dominoes.list].some((o) => o.accident && o.toppledAt > this.dominoes.time - 3 && (o.body.translation().x - t.x) ** 2 + (o.body.translation().z - t.z) ** 2 < 10 * 10);
    if (recent) { this.stats.manualSaves = (this.stats.manualSaves || 0) + 1; this.fx.floatAt(tmp.set(t.x, 2, t.z), '✋ 抜いた！ ここで止まれ〜！', 'coin', 1.6); this.audio.pick && this.audio.pick(); }
  }
  /** 防衛チュートリアル：事故が落ち着いたらストッパーズの確定ガチャ */
  updateTutorial() {
    if (this.tutorialPending == null || this.mode !== 'build') return;
    const busy = [...this.dominoes.list].some((o) => o.accident && o.toppledAt > this.dominoes.time - 2.5);
    if (busy || this.time - this.tutorialPending < 4) return;
    this.tutorialPending = null;
    if (this.level('stopperCrew') > 0) return;
    this.progress.tickets.push({ source: 'tutorial', label: '🦺 防衛チュートリアル：ストッパーズ出動要請', category: 'defense', force: ['stopperCrew'], choices: 3, ignoreLevel: true });
    this.setHint('🦺 ストッパーズを呼ぼう！ 次の事故からは自動でストッパーを置いてくれる', 12);
    this.emit('tutorialGacha');
  }

  unloadStage() {
    if (!this.stageId) return;
    if (this.railPlans) { this.railPlans.dispose(); this.railPlans = null; }
    if (this.crossings) { this.crossings.dispose(); this.crossings = null; }
    if (this.railway) { this.railway.dispose(); this.railway = null; }
    for (const m of this.campMeshes || []) this.scene.remove(m);
    if (this.shelf) this.shelf.dispose();
    for (const th of this.threats || []) th.dispose();
    this.threats = [];
    if (this.darts) this.darts.clear();
    this.workers.clear();
    this.dominoes.clear();
    this.scene.remove(this.dominoes.mesh);
    for (const p of this.pieces) p.dispose();
    for (const s of this.stoppers) s.dispose();
    for (const p of this.placed) this.scene.remove(p.mesh);
    for (const j of this.walkJobs || []) if (j.ghost) this.scene.remove(j.ghost);
    this.walkJobs = [];
    for (const b of this.tempBarricades) this.scene.remove(b.mesh);
    this.goal.dispose();
    for (const cp of this.checkpoints || []) cp.dispose();
    if (this.roomba) this.roomba.dispose();
    for (const m of this.markers) { if (m.mesh) this.scene.remove(m.mesh); m.orbs.forEach((o) => this.scene.remove(o.mesh)); }
    for (const c of this.chests) this.scene.remove(c.mesh);
    this.scene.remove(this.gachaMachine.mesh, this.finalChest.mesh, this.startPad, this.crate.group, this.machine.group, this.train.mesh, this.factory.group);
    if (this.pile) this.pile.dispose();
    if (this.piggy) this.scene.remove(this.piggy.mesh);
    if (this.tower) this.scene.remove(this.tower);
    if (this.hq) this.scene.remove(this.hq);
    this.depots.forEach((d) => d.dispose());
    this.scene.remove(this.planView.ghost, this.planView.lines, this.planView.stopMarker, this.planView.strokeLine, this.planView.portMarks, this.planView.next);
    this.stage.dispose();
    this.physics.world.free();
    this.stageId = 0;
  }

  // ================= パーツ → 3Dの現場 =================
  level(id) { return this.progress.lv(id); }
  evolved(id) { return !!this.progress.evolutions[id]; }
  /** 自動設置機が動くステージか（Ver.0.5：ステージ1・2では休止。セーブのレベルは残す） */
  machineActive() { return PARTS.machine.stages.includes(this.stageId); }
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
    return this.placed.filter((p) => p.type === type && !p.auto).length; // 設計主任が架けた仮設の歩道橋は数えない
  }

  /** 獲得済みパーツに合わせて、小人や設備を現場に出す */
  syncPartsToWorld(quiet = false) {
    for (const role of ROLE_PARTS) {
      const want = this.level(role);
      while (this.workers.count(role) < want) this.workers.hire(role, quiet);
    }
    if (this.railway) {
      // ステージ2：設計主任（参謀）と撤去班は最初からいる。エリート建築士はガチャで加わる（レベルで得意な建築が増える）
      while (this.workers.count('chief') < 1) this.workers.hire('chief', quiet);
      while (this.workers.count('wrecker') < 2) this.workers.hire('wrecker', quiet);
      while (this.workers.count('architect') < (this.level('architect') > 0 ? 1 : 0)) this.workers.hire('architect', quiet);
      if (this.railPlans && this.workers.count('railchief') < 1) { const c = this.workers.hire('railchief', true); c.pos.copy(this.railway.depot).add(new THREE.Vector3(1.5, 0, -1.5)); c.home = c.pos.clone(); }
      while (this.workers.count('railcrew') < 2) { const c = this.workers.hire('railcrew', true); c.pos.copy(this.railway.depot).add(new THREE.Vector3(0, 0, this.workers.count('railcrew') * 1.2)); c.home = c.pos.clone(); }
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
      this.addPiggyGrab();
      this.stage.obstacles.push({ x: p.x, z: p.z, r: 1.8, roomba: true, build: true });
    }
    // 自動遮断ゲート／本部ならストッパーがゲートになる
    const gates = this.level('gate') > 0 || this.evolved('stopperHQ');
    for (const s of this.stoppers) if (s.gate !== gates) s.setGate(gates);
    if (this.shelf) this.shelf.sync(this);
    this.workers.refreshLooks();
  }

  /** ガチャで選んだパーツを反映し、現場に登場したもの（人・設備）を記録する */
  onGachaPick(p) {
    const wasFirst = !this.progress.firstGachaDone;
    const before = new Set(this.workers.list);
    const res = this.progress.take(p);
    if (p.id === 'rewind') this.rewinds += 2;
    this.syncPartsToWorld(true);
    this.navDirty = true;
    this.lastSpawned = this.workers.list.filter((w) => !before.has(w));
    if (p.id === 'soldier' && this.level('soldier') === 1) this.setHint('💂 おもちゃの兵隊：つかんで置いた所が持ち場。敵（ロボット・ネズミ）が来る所の近くに置こう', 14);
    if (p.id === 'barricade' && this.stageId === 1 && this.level('barricade') === 1) this.setHint('🚧 バリケード：「配置」から置ける。暴走ミニカーの矢印の先に置くと跳ね返す', 14);
    // 最初のガチャで回収担当：そのまま倒れたドミノを拾いに行く様子をカメラで追う
    this.firstPickWorker = wasFirst && p.id === 'collector' ? this.lastSpawned[0] || null : null;
    // 獲得した直後に「効いている様子」を見せる：カメラで追いかける相手と、ひと言
    this.showcase = this.makeShowcase(p);
    const id = p.evo || p.id;
    const firstOf = (role) => { const w = this.workers.list.find((x) => x.role === role); return w ? w.pos.clone() : null; };
    const T = {
      machine: () => this.machine.pos.clone(), fastLine: () => this.machine.pos.clone(), train: () => this.train.pos.clone(),
      factory: () => this.factory.group.position.clone(), watchtower: () => this.tower && this.tower.position.clone(),
      stopperHQ: () => this.hq && this.hq.position.clone(), massBuild: () => firstOf('builder'), autoSafety: () => firstOf('stopperCrew'),
      piggy: () => this.piggy && this.piggy.mesh.position.clone(),
    };
    this.lastSpawnTarget = T[id] ? T[id]() : this.shelf && SMALL_PARTS.includes(id) ? this.shelf.posOf(id) : null;
    if (p.evo) { this.workers.list.forEach((w) => { if (Math.random() < 0.7) w.act(1.6, 'cheer', () => w.think()); }); }
    this.emit('pick', res);
    return res;
  }

  get defenseStyle() { return DEFENSE.style; }
  /** ガチャ直後の見せ場：新しい人は本人、道具は使う人、設備は設備そのものをカメラで追う */
  makeShowcase(p) {
    const id = p.evo || p.id;
    const SAYS = {
      builder: '設計図どおりに並べます！', carrier: '倉庫から最前線へ運びます！', collector: '倒れたドミノ、拾ってきます！', restorer: 'マジックハンドで復旧！',
      stopperCrew: 'ストッパーを差し込みます！', guard: '警備につきます！', soldier: '持ち場へ！ 敵はスポンジ弾で追い払います',
    };
    const newW = (this.lastSpawned || [])[0];
    if (newW && newW.grabEntry) return { entry: newW.grabEntry, text: SAYS[newW.role] || 'がんばります！', obj: newW.root };
    const byRole = (...roles) => { for (const r of roles) { const w = this.workers.list.find((x) => x.role === r); if (w && w.grabEntry) return w; } return null; };
    const TOOL = {
      boots: [['builder', 'carrier', 'collector'], '赤いブーツで足が速くなった！'],
      basket: [['carrier', 'builder', 'collector'], '背中のかごで一度にたくさん運べる！'],
      level: [['builder'], '水平器を当てて、まっすぐ置くよ（うっかり倒し減）'],
      massBuild: [['builder'], '金ヘルメットの大量建設隊！ 2個ずつ並べる'],
      autoSafety: [['stopperCrew', 'soldier'], 'アンテナで連動！ 危ない所を先回りで隔離'],
    };
    if (TOOL[id]) { const w = byRole(...TOOL[id][0]); if (w) return { entry: w.grabEntry, text: TOOL[id][1], obj: w.root }; }
    if (id === 'factory' && this.factoryEntry) return { entry: this.factoryEntry, text: '🏭 工場が動き出した！ 歯車が回ってベルトから箱へ', obj: this.factory.group };
    if (id === 'train' && this.trainEntry) return { entry: this.trainEntry, text: '🚂 列車が倉庫と最前線を往復！', obj: this.train.mesh };
    return null;
  }
  /** 兵隊の持ち場（コースのまわりに分散） */
  soldierPost(i) {
    const posts = this.def.soldierPosts || this.def.guardPosts;
    const [x, z] = posts[i % posts.length];
    return new THREE.Vector3(x + (i >= posts.length ? 1.5 : 0), 0, z);
  }
  /** 兵隊が相手にする敵：攻撃中で、持ち場か本人の近く（見張り範囲）にいるもの */
  soldierTarget(w) {
    let best = null, bd = Infinity;
    const R1 = 16, R2 = 13;
    for (const th of this.threats || []) {
      if (!th.attacking || !th.repel || th instanceof RunawayCar || th.held) continue;
      const dh = Math.hypot(th.pos.x - w.home.x, th.pos.z - w.home.z), dw = Math.hypot(th.pos.x - w.pos.x, th.pos.z - w.pos.z);
      if (dh > R1 && dw > R2) continue;
      if (dw < bd) { bd = dw; best = th; }
    }
    return best;
  }
  /** 復旧係の待機場所：近く（30以内）に、まだ起こされていない倒れたドミノがあればその位置 */
  pendingAccidentNear(pos) {
    if (this.mode !== 'build') return null;
    let best = null, bd = 30 * 30;
    for (const d of this.dominoes.list) {
      if (!d.slot || d.removed || d.held || !d.toppled) continue;
      const t = d.body.translation(); const dd = (t.x - pos.x) ** 2 + (t.z - pos.z) ** 2;
      if (dd < bd) { bd = dd; best = t; }
    }
    return best ? new THREE.Vector3(best.x, 0, best.z) : null;
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
    // 中間ゴールのドミノは幅広、特別なドミノ（プレゼント・四つ葉）はコース設計に組み込み
    for (const sl of this.course.allSlots) sl.special = null;
    const main = this.course.segments[0];
    if (main) {
      // Ver.0.5：中間ゴールのマスも通常のドミノ（幅広ドミノは廃止）
      for (const sp of this.specials || []) { const sl = main.slots[sp.at]; if (sl && !sp.consumed && sl.kind === 'normal') sl.special = sp; }
    }
    // ベルの取り付け先
    for (const p of this.placed) if (p.type === 'bell') p.slot = this.nearestSlot(p.x, p.z, 2.5);
    this.unbuiltDirty = true;
    this.planView.setPorts(this.course.openOutputs(), this.course.openInputs(), this.course.openEnds());
  }

  /** ステージ定義の点列から固定コースを作る */
  buildDesignedCourse() {
    const pts = this.def.course.map(([x, z]) => ({ x, z }));
    const dense = [];
    for (let k = 0; k < pts.length - 1; k++) for (let t = 0; t < 1; t += 0.2) dense.push({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, z: pts[k].z + (pts[k + 1].z - pts[k].z) * t });
    dense.push(pts[pts.length - 1]);
    this.course.addStroke(dense);
    this.specials = (this.def.specials || []).map((sp, i) => ({ ...sp, i, consumed: false }));
    this.refreshCourse();
  }

  /** 中間ゴール装置を、まっすぐな区間の空いている側に置く */
  setupCheckpoints() {
    (this.checkpoints || []).forEach((c) => c.dispose());
    this.checkpoints = [];
    const main = this.course.segments[0];
    if (!main) return;
    const slots = main.slots;
    const straight = (i) => slots[i - 2] && slots[i + 3] && Math.abs(Math.atan2(Math.sin(slots[i + 3].yaw - slots[i - 2].yaw), Math.cos(slots[i + 3].yaw - slots[i - 2].yaw))) < 0.03;
    (this.def.checkpoints || []).forEach((def, index) => {
      let idx = -1;
      for (let d = 0; d < 40 && idx < 0; d++) for (const c of [def.at + d, def.at - d]) if (idx < 0 && straight(c)) idx = c;
      if (idx < 0) idx = def.at;
      const sl = slots[idx];
      if (!sl) { console.warn('checkpoint beyond course', def.at, slots.length); return; }
      let side = 1;
      for (const sd of [1, -1]) {
        const nx = Math.cos(sl.yaw), nz = -Math.sin(sl.yaw);
        let ok = true;
        for (const off of [0.55, 1.2, 2.3, 3.2]) {
          const px = sl.x + nx * sd * off, pz = sl.z + nz * sd * off;
          if (this.stage.blocked(px, pz, 0.6) || !this.stage.inBounds(px, pz, 0.8) || (this.railway && this.railway.track.onTrack(px, pz, 1.4))) ok = false;
          for (const o of this.course.allSlots) if (Math.abs(o.i - sl.i) > 6 && (o.x - px) ** 2 + (o.z - pz) ** 2 < 1.1) ok = false;
        }
        if (ok) { side = sd; break; }
      }
      const cp = new Checkpoint(this.scene, this.physics, sl, side, def, index);
      cp.slotIndex = idx;
      cp.onTrigger = (c) => this.onCheckpoint(c);
      this.checkpoints.push(cp);
      // 装置のまわりは建設・ルンバの障害物
      this.stage.obstacles.push({ x: cp.pos.x, z: cp.pos.z, r: 1.3, roomba: true, build: true });
    });
    this.refreshCourse();
  }

  /** 中間ゴールが作動した（スタートからの連鎖で届いたときだけ報酬） */
  onCheckpoint(cp) {
    const run = this.run;
    const sl = this.course.segments[0].slots[cp.slotIndex];
    if (!run || run.kind !== 'main' || run.checkpoints.includes(cp)) return;
    // 羽根が先に動いても、幅広ドミノが連鎖として数えられるまで待つ（同じフレーム内の順序差を吸収）
    if (!run.chainSlots.has(sl)) { if (!run.pendingCps.includes(cp)) run.pendingCps.push(cp); return; }
    run.pendingCps = run.pendingCps.filter((c) => c !== cp);
    run.checkpoints.push(cp);
    this.audio.checkpoint();
    const p = cp.pos;
    this.fx.floatAt(tmp.set(p.x, 3.2, p.z), `🎯 中間ゴール${cp.index + 1}「${cp.def.name}」到達！`, 'big', 2.4, 1.5);
    this.fx.confetti(tmp.set(p.x, 1, p.z), 70, 7);
    if (cp.def.type === 'alarm' && this.roomba) {
      this.roomba.recall(60);
      this.fx.floatAt(tmp.set(p.x, 4.4, p.z), '🔔 警報！ルンバは充電台へ', 'warn', 2.4);
    }
    // 近くの人たちが喜ぶ
    for (const w of this.workers.list) if (w.state !== 'flee' && w.pos.distanceTo(p) < 30) w.act(1.4 + Math.random() * 0.8, 'cheer', () => w.think());
    this.emit('checkpoint', cp);
  }
  nextCheckpoint() { return (this.checkpoints || []).find((c) => !c.done) || null; }

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
  /** いま建設が進んでいる所：一番先まで立っているドミノの、すぐ先の未建設マス（途中の小さな抜けは数えない） */
  buildHead() {
    // 6枚以上続けて立っている所の先頭（ぽつんと離れて置かれた1枚は数えない）
    let maxB = -1, run = 0;
    const ord = this.course.allSlots.filter((s) => s.order >= 0).sort((a, b) => a.order - b.order);
    for (const s of ord) { if (s.domino && !s.domino.toppled) { if (++run >= 6) maxB = s.order; } else if (!(s.site && s.site.state !== 'open')) run = 0; }
    let best = null;
    for (const s of this.unbuiltList()) { if (s.domino || s.order < maxB - 12) continue; if (!best || s.order < best.order) best = s; }
    return best || this.frontSlot();
  }
  machineTarget() { return this.unbuiltList().find((s) => !s.domino && (!s.claim || s.claim === -1) && !this.crossBlocked(s) && !this.slotBlocker(s)) || null; }
  /** 線路との交差地点で、まだ解決していないマス（設計主任が建築か撤去を決めるまで並べない） */
  crossBlocked(s) { return !!(this.crossings && this.crossings.blocks(s)); }
  nextUnbuiltNear(slot) {
    const seg = slot.seg; if (!seg || !seg.slots) return null;
    const n = seg.slots[slot.i + 1];
    return n && !n.domino && !n.claim && !this.slotBlocker(n) ? n : null;
  }
  findBuildJob(gnome) {
    if (this.mode !== 'build') return null;
    const list = this.unbuiltList();
    // Ver.0.6 安定化：行けるマスを30件まで比べる（行けないマスは数えずに飛ばす。ただし調べるのは先頭から150件まで）。
    // この人が少し前にたどり着けなかったマスは、しばらく別の人にまかせる
    let best = null, bd = Infinity, k = 0, scanned = 0;
    for (const s of list) {
      if (++scanned > 150) break;
      if (s.domino || s.claim || this.crossBlocked(s) || this.slotBlocker(s)) continue;
      if (s._failBy && s._failBy[gnome.id] > this.time) continue;
      const side = this.reachSide(s, gnome);
      if (!side) continue;
      const d = (s.x - gnome.pos.x) ** 2 + (s.z - gnome.pos.z) ** 2 + k * 4;
      if (d < bd) { bd = d; best = s; best._side = side; }
      if (++k >= 30) break;
    }
    if (best) { best.claim = gnome.id; gnome.side = best._side; }
    return best;
  }
  /** この人はこの仕事（マス・ドミノ）にたどり着けなかった：しばらく別の人にまかせる */
  markJobFail(job, gnome, sec = 30) { if (job) (job._failBy ||= {})[gnome.id] = this.time + sec; }
  /** マスの左右どちらかに歩いて行けるか（行ける側の符号つき距離。どちらも無理なら 0） */
  reachSide(slot, gnome) {
    if (!this.nav || !this.nav.version) return gnome.side;
    const v = (this._rsV ||= new THREE.Vector3());
    // 横のすぐそば（0.75）がふさがっていたら（倒れたドミノが横たわっている等）、少し離れた所（1.4）から
    // 自分のいる側（近い方）から作業する：列の向こう側へ回りこむ遠回りをしない
    const nx = Math.cos(slot.yaw), nz = -Math.sin(slot.yaw);
    const base = Math.sign((gnome.pos.x - slot.x) * nx + (gnome.pos.z - slot.z) * nz) || Math.sign(gnome.side) || 1;
    for (const d of [0.75, 1.4]) for (const sd of [base * d, -base * d]) { this.sideOf(slot, sd, v); if (this.nav.reachable(gnome.pos, v, 1)) return sd; }
    return 0;
  }
  /** 小人がそこへ歩いて行けるか（列の向こう側なら false） */
  canReach(gnome, p, rb = 12) { return !this.nav || !this.nav.version || this.nav.reachable(gnome.pos, p, rb); }
  supplyFor(gnome) {
    // Ver.0.6：前線のドミノの山（運搬担当が小分けに運んだもの）が近くにあれば、そこから
    const pl = this.pile;
    if (pl && pl.count > 0 && this.canReach(gnome, pl.pos, 6)) {
      const dp = pl.pos.distanceTo(gnome.pos);
      if (dp < this.crate.pos.distanceTo(gnome.pos) || this.crate.count <= 0) { let nd2 = Infinity; for (const d of this.depots) nd2 = Math.min(nd2, d.pos.distanceTo(gnome.pos)); if (dp < nd2 + 6 || this.stock <= 0) return pl; }
    }
    // Ver.0.6：歩いて行ける所だけ（列の向こうの資材箱・倉庫は使えない）
    const crateOk = this.crate.count > 0 && this.canReach(gnome, this.crate.pos);
    let near = null, nd = Infinity;
    if (this.stock > 0) for (const d of this.depots) { const dd = d.pos.distanceToSquared(gnome.pos); if (dd < nd && this.canReach(gnome, d.pos)) { nd = dd; near = d; } }
    if (crateOk && (!near || this.crate.pos.distanceTo(gnome.pos) < near.pos.distanceTo(gnome.pos) + 12)) return this.crate;
    if (near) return near;
    if (crateOk) return this.crate;
    if (this.metrics && (this.stock > 0 || this.crate.count > 0)) this.metrics.count('supplyFail');
    return null;
  }
  nearestDepot(pos) {
    let best = this.depots[0], bd = Infinity;
    for (const d of this.depots) { const dd = d.pos.distanceToSquared(pos); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }
  returnToStock(n) { this.stock += n; }

  /** スロットにドミノを置く（手持ち・機械から。在庫は呼び出し側で減らしてある） */
  /**
   * マスの上を物理的にふさいでいる別のドミノ（あれば返す）
   * 立っているもの：中心がマスに近い／倒れているもの：長辺（寝ている向き）がマスの上を横切っている
   */
  slotBlocker(slot, ignore = null) {
    for (const d of this.dominoes.near(slot.x, slot.z)) {
      if (d === ignore || d.removed) continue;
      if (d === slot.domino && !ignore) continue;
      const t = d.body.translation();
      const dx = slot.x - t.x, dz = slot.z - t.z;
      if (dx * dx + dz * dz > 1.1 || t.y > 1.6) continue;
      if (!d.toppled && this.dominoes.upY(d) > 0.9) { if (dx * dx + dz * dz < 0.36 * 0.36) return d; continue; }
      // 寝ている：ドミノの長軸（ローカルY）を水平面に落として、マス中心との距離を見る
      const r = d.body.rotation();
      let ax = 2 * (r.x * r.y - r.w * r.z), az = 2 * (r.y * r.z + r.w * r.x);
      const len = Math.hypot(ax, az);
      const half = (CFG.dominoH / 2) * Math.min(1, len);
      if (len > 1e-3) { ax /= len; az /= len; }
      const along = Math.max(-half, Math.min(half, dx * ax + dz * az));
      const px = dx - ax * along, pz = dz - az * along;
      if (px * px + pz * pz < (d.w / 2 + 0.12) ** 2) return d;
    }
    return null;
  }
  /** マスに新しいドミノを立てられるか（ほかのドミノが乗っていない） */
  slotFree(slot) { return !slot.domino && !this.slotBlocker(slot); }

  placeAt(slot, gnome) {
    if (slot.domino) { this.stock++; return null; }
    // 倒れたドミノなどが残っている所には重ねて立てない（先に回収・復旧が必要）
    if (this.slotBlocker(slot)) { this.stock++; this.stats.blockedPlacements = (this.stats.blockedPlacements || 0) + 1; return null; }
    const kind = slot.kind === 'wide' ? 'wide' : slot.special ? slot.special.type : 'normal';
    const d = this.dominoes.create(slot, { slot, kind, drop: true, colorIndex: Math.floor(Math.max(0, slot.order) / 4) });
    if (!d) { this.stock++; return null; }
    slot.domino = d; slot.claim = 0; d._bornT = this.time;
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
          d.accident = true; d._oops = this.time;
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
      for (const s of this.unbuiltList()) { if (s.domino || s.claim || this.crossBlocked(s)) continue; const d = (s.x - near.x) ** 2 + (s.z - near.z) ** 2; if (d < bd) { bd = d; slot = s; } }
    }
    if (!slot) slot = this.unbuiltList().find((s) => !s.domino && !s.claim && !this.crossBlocked(s));
    if (!slot) { this.audio.deny(); this.fx.floatAt(near || tmp.set(0, 1, 0), 'まず「コースを描く」で線を引こう', 'warn', 1.6); return false; }
    if (this.stock > 0) this.stock--; else this.crate.count--;
    this.placeAt(slot, null);
    return true;
  }

  /**
   * 手で置いたドミノ：空いた設計図のマスの上で、まっすぐ立って止まったらそのマスのドミノとして扱う
   * （位置や向きの補正はしない。立ち方が悪ければ数えられない）
   */
  adoptLoose() {
    for (const d of this.dominoes.list) {
      if (d.slot || d.held || d.removed || d.toppled) continue;
      if (!d.body.isSleeping() && !this.isStill(d)) continue;
      if (this.dominoes.upY(d) < 0.97) continue;
      const t = d.body.translation();
      const sl = this.nearestSlot(t.x, t.z, 0.26);
      if (!sl || sl.domino) continue;
      const r = d.body.rotation();
      const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
      if (Math.abs(Math.sin(yaw - sl.yaw)) > 0.26) continue; // 向きが15°以上ずれていたら連鎖しにくいので数えない
      sl.domino = d; d.slot = sl; d.standing = true; this.unbuiltDirty = true;
      this.stats.handPlaced = (this.stats.handPlaced || 0) + 1;
      this.fx.floatAt(tmp.set(t.x, 1.4, t.z), '✓', 'coin', 0.6);
      this.audio.click(1.2, Math.max(0, sl.order));
    }
  }

  /** 役割の待機所 */
  campPos(role) {
    const k = ROLE_CAMP[role];
    const c = k && this.def.camps && this.def.camps[k];
    return c ? new THREE.Vector3(c.x, 0, c.z) : null;
  }

  /** ほぼ止まっているか（スリープしない寄りかかりも含む） */
  isStill(d) {
    if (d.frozen || !d.body || d.body.isSleeping()) return true;
    const v = d.body.linvel(), w = d.body.angvel();
    return v.x * v.x + v.y * v.y + v.z * v.z < 0.01 && w.x * w.x + w.y * w.y + w.z * w.z < 0.04;
  }

  /** 倒れたドミノ（その場）を探す */
  findRestandJob(gnome, maxD = Infinity, preferAccident = false) {
    // 本番中も復旧係だけは、連鎖の波より十分先のドミノを直しに行ける
    const duringRun = this.mode === 'run' && gnome.role === 'restorer';
    if (this.mode !== 'build' && !duringRun) return null;
    const minOrder = duringRun ? (this.run.frontOrder < 0 ? 12 : this.run.frontOrder + 25) : -Infinity;
    let best = null, bd = maxD * maxD;
    // 別のドミノが上に寝ているマスは後回し（重ねて立てない）。ただしお互いの上に寝ている場合は順番の早い方から
    const covered = (d) => {
      const b = this.slotBlocker(d.slot, d);
      if (!b) return false;
      if (b.slot && b.slot !== d.slot && this.slotBlocker(b.slot, b) === d) return this.ord(d.slot) > this.ord(b.slot);
      // 上に寝ているのが、倒れた別のマスのドミノ：それをどけてから起こせる（3枚以上が互いに重なっても止まらない）
      if (b.slot && b.toppled && !b.held && !b.claim) return false;
      return true;
    };
    for (const d of this.dominoes.list) {
      if (!d.slot || d.claim || d.removed || d.held) continue;
      // 倒れた・寄りかかって傾いた・ずれたドミノ（スロットにきちんと立っていない）
      if (!d.toppled && this.dominoes.isStandingAt(d, d.slot)) continue;
      if (duringRun && (d.slot.order < minOrder || this.run.toppled.has(d))) continue;
      if (!this.isStill(d)) continue; // 倒れている最中は待つ（寄りかかって止まったものは対象）
      if (d.restandFailAt && this.time - d.restandFailAt < 4) continue; // さっき起こせなかったもの（同じ所で足踏みしない）
      if (d._failBy && d._failBy[gnome.id] > this.time) continue; // この人がたどり着けなかったもの
      const t = d.body.translation();
      const dist2s = (t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2;
      if (dist2s > CFG.restandDistance ** 2) continue;
      let dd = (t.x - gnome.pos.x) ** 2 + (t.z - gnome.pos.z) ** 2;
      if (preferAccident && d.accident) dd *= 0.3;
      // 大事故の立て直し中：連鎖をさえぎっている手前のものから（順番を強く重視。近さは少しだけ）
      if (this.recovery) dd = dd * 0.15 + Math.max(0, d.slot.order - this.recovery.from) * 1.5;
      else dd += Math.max(0, d.slot.order) * 0.02;
      // 重なりの確認は、いまの候補より近いものだけ（重い判定を全ドミノに対してしない）
      if (dd < bd && !covered(d)) {
        // Ver.0.6：列の向こう側（歩いて行けない所）のドミノは、行ける人にまかせる
        if (gnome.role === 'restorer' ? !this.canReach(gnome, d.slot, 3) : !this.reachSide(d.slot, gnome)) continue;
        bd = dd; best = d;
      }
    }
    if (best) { best.claim = gnome.id; if (gnome.role !== 'restorer') gnome.side = this.reachSide(best.slot, gnome) || gnome.side; }
    return best;
  }
  /** 本番中：波より十分先の空きマス（ルンバに吸われた等）を復旧係が埋める */
  findRunRepairSlot(gnome) {
    if (this.mode !== 'run' || !this.run || this.stock <= 0) return null;
    const minOrder = this.run.frontOrder + 30;
    let best = null, bd = Infinity;
    for (const s of this.course.allSlots) {
      if (s.domino || s.claim || s.order < minOrder || this.slotBlocker(s)) continue;
      const d = (s.x - gnome.pos.x) ** 2 + (s.z - gnome.pos.z) ** 2 + (s.order - minOrder) * 0.5;
      if (d < bd) { bd = d; best = s; }
    }
    if (best) best.claim = gnome.id;
    return best;
  }
  restand(d) {
    if (d.removed || !d.slot) return null;
    if (this.mode === 'run' && this.run && (this.run.frontOrder + 6 > d.slot.order)) return null;
    const slot = d.slot;
    // マスの上に別のドミノが寝ていたら、重ねて立て直さない
    const b = this.slotBlocker(slot, d);
    if (b) {
      // 2枚がお互いのマスの上に寝ている（どちらも起こせない）：もう1枚を拾い上げてから起こす。拾った分は在庫へ、マスは空きになる
      if (b.slot && b.slot !== slot && !b.held && !b.removed && (this.slotBlocker(b.slot, b) === d || (b.toppled && !b.claim))) {
        const bs = b.slot; this.dominoes.remove(b); if (bs.domino === b) bs.domino = null; this.stock++; this.unbuiltDirty = true;
        this.stats.untangled = (this.stats.untangled || 0) + 1;
        if (this.slotBlocker(slot, d)) { d.restandFailAt = this.time; return null; }
      } else { d.restandFailAt = this.time; return null; }
    }
    const kind = slot.kind === 'wide' ? 'wide' : slot.special ? slot.special.type : 'normal';
    const color = d.color;
    this.dominoes.remove(d);
    if (this.metrics) { this.metrics.count('restands'); if (d._fellT != null && this.mode === 'build') this.metrics.push(this.metrics.repair, this.time - d._fellT); }
    const nd = this.dominoes.create(slot, { slot, kind, color, drop: true });
    slot.domino = nd; nd._bornT = this.time; nd._restood = true;
    this.stats.restands++;
    if (!this._lastRestSnd || this.time - this._lastRestSnd > 0.07) { this.audio.place(); this._lastRestSnd = this.time; }
    return nd;
  }
  /** このドミノが、どこかの空いたマス（またはほかのドミノのマス）をふさいでいるか */
  blocksASlot(d) {
    const t = d.body.translation();
    const sl = this.nearestSlot(t.x, t.z, 0.9);
    return !!sl && sl !== d.slot && this.slotBlocker(sl, sl.domino && sl.domino !== d ? sl.domino : null) === d;
  }
  /**
   * 片付けジョブ：建設したいマスをふさいでいる「持ち主のいない（または自分のマスから大きく外れた）」ドミノ
   * 建設担当・復旧係が拾って在庫に戻す → その後で通常どおり建設・立て直しされる
   */
  findClearJob(gnome) {
    if (this.mode !== 'build') return null;
    let best = null, bd = Infinity;
    for (const d of this.dominoes.list) {
      if (d.claim || d.removed || d.held || !this.isStill(d)) continue;
      if (d.releasedAt != null && this.time - d.releasedAt < 12) continue; // 手で置いたばかりのものは少し待つ
      const t = d.body.translation();
      if (d.slot && (t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2 <= CFG.restandDistance ** 2) continue; // 自分のマスの近く → 立て直しで直る
      // マスから遠くへ飛ばされたドミノは、起こせない：拾って片付ける（マスは空きになり、建設担当が置き直す）
      if (!(d.slot && d.toppled) && !this.blocksASlot(d)) continue;
      if (d._failBy && d._failBy[gnome.id] > this.time) continue;
      const dd = (t.x - gnome.pos.x) ** 2 + (t.z - gnome.pos.z) ** 2;
      if (dd < bd && this.canReach(gnome, t, 3)) { bd = dd; best = d; }
    }
    if (best) best.claim = gnome.id;
    return best;
  }
  /** 復旧：建設の先頭より手前で空いてしまったマス（手で抜いた・吸い込まれた等）。物理的に空いているものだけ */
  findGapJob(gnome) {
    if (this.mode !== 'build' || this.stock + this.crate.count <= 0) return null;
    // 一番先まで建っているドミノより手前の空き（＝途中の抜け）
    let fo = -1;
    for (const s of this.course.allSlots) if (s.domino && s.order > fo) fo = s.order;
    let best = null, bd = Infinity;
    for (const s of this.unbuiltList()) {
      if (s.order < 0 || s.order >= fo) continue;
      if (s.domino || s.claim || this.crossBlocked(s) || this.slotBlocker(s)) continue;
      const d = (s.x - gnome.pos.x) ** 2 + (s.z - gnome.pos.z) ** 2;
      if (d < bd && this.reachSide(s, gnome)) { bd = d; best = s; }
    }
    if (best) { best.claim = gnome.id; gnome.side = this.reachSide(best, gnome) || gnome.side; }
    return best;
  }
  /** 重なりの解消（拾って在庫へ） */
  clearBlocker(d) {
    if (d.removed) return;
    this.collect(d); this.stock++;
    this.stats.overlapsCleared = (this.stats.overlapsCleared || 0) + 1;
  }

  /** スロットから離れた・持ち主のいないドミノ */
  findCollectJob(gnome) {
    if (this.mode !== 'build') return null;
    let best = null, bd = Infinity;
    for (const d of this.dominoes.list) {
      if (d.claim || d.removed || d.held) continue;
      if (!d.slot && d.releasedAt != null && this.time - d.releasedAt < 12 && !this.blocksASlot(d)) continue; // プレイヤーが置いたばかりのものは片付けない（マスをふさいでいれば片付ける）
      let loose = !d.slot;
      if (d.slot && !this.dominoes.isStandingAt(d, d.slot) && this.isStill(d)) {
        const t = d.body.translation();
        if ((t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2 > CFG.restandDistance ** 2) loose = true;
      }
      if (!loose) continue;
      if (!this.isStill(d)) continue;
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
      if (!this.isStill(d)) continue;
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
    // 起こす候補：自分のマスの近くで倒れている・ずれているドミノ（順番の早いものから）
    const cands = [];
    for (const d of this.dominoes.list) {
      if (!d.slot || d.claim || d.removed || d.held) continue;
      if (!d.toppled && this.dominoes.isStandingAt(d, d.slot)) continue;
      if (!this.isStill(d)) continue;
      const t = d.body.translation();
      if ((t.x - d.slot.x) ** 2 + (t.z - d.slot.z) ** 2 > CFG.restandDistance ** 2) { this.collect(d); this.stock++; return true; }
      cands.push(d);
    }
    if (!cands.length) {
      // マスをふさいでいる持ち主のいないドミノ（手で置いた・転がってきた）を片付ける
      for (const d of this.dominoes.list) if (!d.slot && !d.held && !d.claim && this.isStill(d) && this.blocksASlot(d)) { this.clearBlocker(d); return true; }
      return false;
    }
    cands.sort((a, b) => this.ord(a.slot) - this.ord(b.slot));
    for (const d of cands) {
      const b = this.slotBlocker(d.slot, d);
      if (!b) { if (this.restand(d)) return true; continue; }
      // 上に寝ているのが持ち主のいないドミノなら片付ける
      if (!b.slot && !b.held) { this.clearBlocker(b); return true; }
    }
    // 全部がお互いの上に寝ていて立てられない → 一番後ろの1枚を在庫に戻して、重なりを解く
    const last = cands[cands.length - 1];
    if (last.slot && last.slot.domino === last) last.slot.domino = null;
    this.clearBlocker(last);
    this.unbuiltDirty = true;
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
  /** ドミノ製造機（本体・ベルト・ドミノ箱）の場所。人や列車は通り抜けない */
  factoryBlocks(x, z, m) {
    const f = this.factory;
    if (!f || !this.progress || this.level('factory') <= 0 || f.carried) return false;
    const p = f.group.position;
    return Math.abs(x - (p.x + 2.45)) < 4.95 + m && Math.abs(z - p.z) < 2.1 + m;
  }
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
  canPlacePiece(type, x, z, yaw, ignoreCount = false) {
    if (!ignoreCount && this.placeableUsed(type) >= this.placeableCount(type)) return { ok: false, why: `${PIECE_LABEL[type]}がもうありません（ガチャで増やせます）` };
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
    if (type === 'footbridge') {
      const ax = Math.cos(yaw), az = -Math.sin(yaw);
      for (const e of [-1, 1]) {
        const ex = x + ax * e * (FOOTBRIDGE_L / 2 - 0.6), ez = z + az * e * (FOOTBRIDGE_L / 2 - 0.6);
        if (!st.inBounds(ex, ez, 0.8) || st.blocked(ex, ez, 0.6)) return { ok: false, why: '階段の所に家具があります' };
        if (this.nearestSlot(ex, ez, 1.0)) return { ok: false, why: '階段がドミノの列にかかっています（列をまたぐ向きに）' };
        if (this.railway && this.railway.track.onTrack(ex, ez, 0.5)) return { ok: false, why: '階段が線路にかかっています' };
      }
      return { ok: true };
    }
    if (!st.inBounds(x, z, 1) || st.blocked(x, z, type === 'barricade' ? 0.3 : 0.6)) return { ok: false, why: '置けない場所です' };
    if (type === 'barricade') for (let t = -2.4; t <= 2.4; t += 0.6) { const px = x + Math.cos(yaw) * t, pz = z - Math.sin(yaw) * t; if (this.nearestSlot(px, pz, 0.6)) return { ok: false, why: 'コースと重なっています' }; }
    if (type === 'bell' && !this.nearestSlot(x, z, 2.5)) return { ok: false, why: 'コースのすぐ横に置いてください' };
    return { ok: true };
  }
  placePiece(type, x, z, yaw, quiet = false, force = false) {
    const chk = this.canPlacePiece(type, x, z, yaw, force);
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
    const mesh = type === 'barricade' ? barricadeMesh() : type === 'sensor' ? sensorMesh() : type === 'footbridge' ? footbridgeMesh(FOOTBRIDGE_L, FOOTBRIDGE_H) : bellPieceMesh();
    mesh.position.set(x, this.stage.heightAt(x, z), z); mesh.rotation.y = yaw;
    this.scene.add(mesh);
    const p = { type, x, z, yaw, mesh, slot: null };
    if (type === 'footbridge') {
      const ax = Math.cos(yaw), az = -Math.sin(yaw);
      p.a = new THREE.Vector3(x - ax * FOOTBRIDGE_L / 2, 0, z - az * FOOTBRIDGE_L / 2); p.b = new THREE.Vector3(x + ax * FOOTBRIDGE_L / 2, 0, z + az * FOOTBRIDGE_L / 2); p.height = FOOTBRIDGE_H;
      if (this.nav) this.nav.addBridge(p.a, p.b);
      this.stats.footbridges = (this.stats.footbridges || 0) + 1;
    }
    this.placed.push(p);
    this.addPieceGrab(p);
    this.navDirty = true;
    this.refreshCourse();
    if (!quiet) this.audio.buy();
    return p;
  }
  removePieceAt(x, z) {
    for (const p of this.placed) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 2.5 * 2.5) { this.scene.remove(p.mesh); this.placed.splice(this.placed.indexOf(p), 1); if (p.grabEntry) this.grabbables.remove(p.grabEntry); this.refreshCourse(); this.navDirty = true; return true; }
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
    for (const th of this.threats || []) if (th instanceof RunawayCar && th.state === 'drive' && (pos.x - th.pos.x) ** 2 + (pos.z - th.pos.z) ** 2 < 9) return { pos: th.pos, label: 'わっ、車だ！' };
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
  onRoombaWarn(r) { this.audio.roombaWarn(); this.fx.floatAt(r.pos.clone().setY(3.2), '🤖 ルンバ出動まで 3…2…1', 'warn', 2.6); }
  onRoombaReturn(r) { this.fx.floatAt(r.pos.clone().setY(3.2), '🤖 お掃除おわり。充電台へ帰ります', '', 2.0); }
  onRoombaDock(r) { this.audio.roombaDock(); this.fx.floatAt(r.pos.clone().setY(3), '🔋 充電中', '', 1.6); }
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
    else if (d.slot) {
      d.accident = true; d._fellT = this.time;
      if (this.metrics) {
        // 倒れた理由（計測用）
        const T = this.time, sl = d.slot, seg = sl.seg && sl.seg.slots;
        const nb = seg ? [seg[sl.i - 1], seg[sl.i + 1]].some((q) => q && q.domino && q.domino !== d && q.domino._fellT != null && T - q.domino._fellT < 1.5) : false;
        const tt = d.body.translation();
        const nearThreat = (this.threats || []).some((th) => { const q = th.pos || (th.mesh && th.mesh.position) || (th.group && th.group.position); return q && (q.x - tt.x) ** 2 + (q.z - tt.z) ** 2 < 3.5 * 3.5; });
        const cause = d.byRoomba ? 'roomba' : nearThreat ? 'threat' : d._bodyHit && T - d._bodyHit < 2 ? 'gnome' : d._oops && T - d._oops < 3 ? 'oops' : nb ? 'cascade' : d._bornT != null && T - d._bornT < 4 ? (d._restood ? 'afterRestand' : 'afterPlace') : 'other';
        this.metrics.count('topples'); this.metrics.add((this.metrics.cause ||= {}), cause, 1);
      }
      this.onAccidentTopple(d); this.countAccident(d);
    }
  }

  /**
   * 大事故の立て直し（Ver.0.6 安定化）：倒れたままのドミノが多い（25枚以上）と「立て直し中」になる。
   * 設計主任（いなければ建設担当の先輩）が声をかけ、建設担当も一時的に立て直しへ回る。手前（連鎖をさえぎる所）から順に、分担して起こす。
   * 遊んでいた人もすぐ戻る。5枚以下になったら終わり
   */
  updateRecovery() {
    let fallen = 0, from = Infinity, oldest = 0;
    for (const d of this.dominoes.list) {
      if (!d.slot || d.held || d.removed) continue;
      // 建設中の事故で倒れたものだけ（本番で倒れたドミノの立て直しは、ふだんの作業）
      if (d._runFell) continue;
      if (d.toppled || !this.dominoes.isStandingAt(d, d.slot)) {
        fallen++; if (d.slot.order >= 0 && d.slot.order < from) from = d.slot.order;
        if (!d.claim) { if (d._waitT == null) d._waitT = this.time; oldest = Math.max(oldest, this.time - d._waitT); } else d._waitT = null;
      }
    }
    // 大事故（25枚以上）か、だれも起こしに来ないまま長く放置されている（8枚以上・45秒以上）とき
    if (!this.recovery && this.time > (this._recCool || 0) && (fallen >= 25 || (fallen >= 8 && oldest > 45))) {
      this.recovery = { t: this.time, n0: fallen, from: from === Infinity ? 0 : from, small: fallen < 25, helpers: new Set() };
      // 手伝う建設担当：大事故なら全員、小さな放置なら、いちばん近い1人だけ（ほかの人は建設を続ける）
      const builders = this.workers.list.filter((w) => w.role === 'builder');
      if (fallen >= 25) builders.forEach((w) => this.recovery.helpers.add(w.id));
      else { const fs = this.course.allSlots.find((q) => q.order === this.recovery.from); if (fs && builders.length) { builders.sort((a, b) => Math.hypot(a.pos.x - fs.x, a.pos.z - fs.z) - Math.hypot(b.pos.x - fs.x, b.pos.z - fs.z)); this.recovery.helpers.add(builders[0].id); } }
      this.stats.recoveries = (this.stats.recoveries || 0) + 1;
      const lead = this.workers.list.find((w) => w.role === 'chief') || this.workers.list.find((w) => w.role === 'restorer') || this.workers.list.find((w) => w.role === 'builder');
      if (lead) lead.say(fallen >= 25 ? (lead.role === 'chief' ? `大事故だ！ ${fallen}枚倒れた。建設班も立て直しに回ってくれ！` : `${fallen}枚も倒れた！ みんなで立て直そう！`) : (lead.role === 'chief' ? '倒れたままのドミノがあるな。手の空いた人、起こしてくれ！' : '倒れたままのがある、起こしに行こう！'), 'warn');
      const helpers = this.workers.list.filter((w) => ['builder', 'collector', 'restorer'].includes(w.role) && w !== lead).slice(0, 3);
      helpers.forEach((w, i) => this.campLife && this.campLife.after(0.7 + i * 0.4, () => w.say(['了解、起こしに行きます！', 'まかせて！', '手前から順に起こそう！'][i])));
    } else if (this.recovery) {
      this.recovery.from = from === Infinity ? this.recovery.from : from;
      // 終わり：ほぼ起こし終えた／長くかかりすぎた（小さな放置は90秒、大事故は5分で、いったん建設に戻る）
      if (fallen <= (this.recovery.small ? 2 : 5) || this.time - this.recovery.t > (this.recovery.small ? 90 : 300)) {
        this._recCool = this.time + 30;
        const dur = this.time - this.recovery.t, done = fallen <= (this.recovery.small ? 2 : 5);
        if (this.metrics) this.metrics.push((this.metrics.recoveryTimes ||= []), dur);
        const big = !this.recovery.small;
        this.recovery = null;
        const lead = this.workers.list.find((w) => w.role === 'chief') || this.workers.list.find((w) => w.role === 'builder');
        if (lead && big) lead.say(done ? '立て直し完了！ 建設再開だ！' : '残りは回収班にまかせて、建設に戻ろう！', 'coin');
      }
    }
  }
  /** 建設中の事故：倒れた枚数を数える（観客の声や「ブー！」表示は出さない。知らせるのはドミノが倒れる物理音だけ） */
  countAccident(d) {
    const ep = (this.accEp ||= { n: 0, last: 0, x: 0, z: 0 });
    if (!ep.n) { const t = d.body.translation(); ep.x = t.x; ep.z = t.z; }
    ep.n++; ep.last = this.time;
  }
  updateAccidentReaction() {
    const ep = this.accEp;
    if (!ep || !ep.n || this.time - ep.last < 1.3) return;
    const n = ep.n; ep.n = 0;
    if (this.mode !== 'build' || n < 3) return;
    this.stats.accidentReactions = (this.stats.accidentReactions || 0) + 1;
    this.emit('accident', n);
  }

  // ================= 序盤のやり直し =================
  /** 最初のガチャを選ぶまでの間で、倒れた・散らばったドミノがあるとき */
  canEarlyRestart() {
    if (this.progress.firstGachaDone || this.mode !== 'build' || this.run) return false;
    for (const d of this.dominoes.list) if (!d.held && (d.toppled || !d.slot || !this.dominoes.isStandingAt(d, d.slot))) return true;
    return false;
  }
  /**
   * 「↺ 最初から並べ直す」：置いたドミノを全部資材箱に戻す（セーブ・記録・設定はそのまま）
   * 枚数は増減しない：ワールドのドミノ＋人が持っている分を、すべて資材箱へ
   */
  earlyRestart() {
    if (this.progress.firstGachaDone || this.mode !== 'build') return 0;
    if (this.hand) this.hand.cancel();
    let n = 0;
    for (const d of [...this.dominoes.list]) { if (d.slot && d.slot.domino === d) d.slot.domino = null; this.dominoes.remove(d); n++; }
    for (const w of this.workers.list) { n += w.load; w.load = 0; w.releaseJob(); }
    for (const s of this.course.allSlots) s.claim = 0;
    this.crate.count += n;
    this.unbuiltDirty = true;
    for (const cp of this.checkpoints) cp.reset();
    this.stats.earlyRestarts = (this.stats.earlyRestarts || 0) + 1;
    this.audio.rewind();
    this.fx.floatAt(this.crate.pos.clone().setY(2.4), `↺ ${n}枚を資材箱に戻しました`, 'coin', 2);
    this.emit('earlyRestart', n);
    return n;
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
    if (this.crossings) this.crossings.preRunCheck();
    this.snapshot = this.takeSnapshot();
    this.mode = 'run';
    this.records[this.stageId].attempts++;
    this.run = {
      id: (this.runSeq = (this.runSeq || 0) + 1), kind: 'main', t: 0, lastTopple: 0, toppled: new Set(), count: 0,
      frontPos: null, frontOrder: -1, presents: 0, clovers: 0, chest: [], gacha: false, bells: 0, piggy: 0,
      goal: false, startPushed: false, roombaHits: 0, rogue: new Set(), chainSlots: new Set(), chainPieces: new Set(), checkpoints: [], pendingCps: [],
    };
    for (const cp of this.checkpoints) cp.reset();
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
    d._runFell = true; // 本番で倒れた（立て直しは、ふだんの作業。大事故の扱いにしない）
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
    // クリア条件：スタートからの一本の連鎖が最終ゴール装置を作動させたこと（枚数は問わない）
    const cleared = run.goal;
    const { stop, reason } = cleared ? { stop: null, reason: '' } : this.analyze();
    this.planView.showStop(stop);
    const prevBest = rec.best;
    // 経験値
    let piggy = 0;
    if (this.piggy) piggy = cleared ? run.piggy : Math.floor(run.piggy / 2);
    const xp = xpForRun(run.count, prevBest, piggy);
    if (run.bells && !this.roomba) { xp.total += 30 * run.bells; xp.bell = 30 * run.bells; }
    const ups = this.progress.addXP(xp.total);
    // 特別報酬のガチャ券
    const T = this.progress.tickets;
    for (let i = 0; i < run.presents; i++) T.push({ source: 'present', label: '🎁 プレゼントドミノ', rarityMin: 'rare' });
    if (run.clovers) this.progress.extraChoice = 2;
    // 中間ゴール：初めて届いたときだけ確定ガチャ（一度きり）
    const newCps = [];
    for (const cp of run.checkpoints) {
      if (cp.done) continue;
      cp.done = true;
      newCps.push(cp);
      T.unshift({ source: 'checkpoint', label: `🎯 中間ゴール${cp.index + 1}「${cp.def.name}」到達報酬`, rarityMin: 'rare', category: cp.def.category, choices: 3, ignoreLevel: true });
    }
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
      xp, levelUps: ups, newBest, prevBest, presents: run.presents, chests: 0, gacha: false, clovers: run.clovers,
      checkpoints: newCps.map((c) => ({ index: c.index, name: c.def.name })), reached: run.checkpoints.map((c) => c.index),
      piggy, piggyLost: this.piggy && !cleared ? run.piggy - piggy : 0, roombaHits: run.roombaHits, time: run.t,
    };
    this.lastResult = result;
    if (this.crossings) this.crossings.afterRun();
    this.history.unshift({ at: Date.now(), stage: this.stageId, count: run.count, cleared, reason, xp: xp.total, record: newBest, checkpoints: result.checkpoints.map((c) => c.index + 1) });
    this.history.length = Math.min(this.history.length, 40);
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
    this.run = { kind: 'test', t: 0, lastTopple: 0, toppled: new Set(), count: 0, frontOrder: -1, frontPos: null, a, b, snap, temp, released, total: slots.length, rogue: new Set(), chainSlots: new Set(), chainPieces: new Set(), checkpoints: [], pendingCps: [] };
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
    for (const cp of this.checkpoints) cp.reset();
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
        // 重なって立たないよう、上に寝ている持ち主のいないドミノは在庫へ
        for (let b = this.slotBlocker(s), n = 0; b && n < 4; b = this.slotBlocker(s), n++) { if (b.slot && b.slot !== s && this.course.allSlots.includes(b.slot)) { b.slot.domino = null; } this.dominoes.remove(b); this.stock++; }
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
    if (this.mode === 'build' && (this._adoptT = (this._adoptT || 0) - dt) <= 0) { this._adoptT = 0.3; this.adoptLoose(); }
    this.dominoes.update(dt);
    if (this.run) this.updateRun(dt);
    if (this.run && this.run.pendingCps.length) for (const cp of [...this.run.pendingCps]) this.onCheckpoint(cp);
    this.goal.update(dt);
    for (const p of this.pieces) p.update(dt);
    for (const cp of this.checkpoints) {
      cp.update(dt);
      // 建設中：レバーは中間ゴールのドミノが立て直されると自然に戻る。倒れた回の作動状態だけ解除する
      if (this.mode === 'build' && cp.fired && cp.slot.domino && this.dominoes.isStandingAt(cp.slot.domino, cp.slot)) cp.reset();
    }
    for (const s of this.stoppers) s.update(dt);
    if (this.roomba) this.roomba.update(dt, this);
    for (const th of this.threats || []) th.update(dt);
    if (this.darts) this.darts.update(dt);
    if (this.railway) this.railway.update(dt);
    if (this.crossings) this.crossings.update(dt);
    if (this.railPlans) this.railPlans.update(dt);
    if (this.campLife) this.campLife.update(dt);
    // 列で囲まれて行けない仕事があれば、歩道橋を架ける（8秒ごと）
    if (this.mode === 'build' && (this._connT = (this._connT ?? 4) - dt) <= 0) { this._connT = 8; autoConnect(this); }
    if (this.growMeshes && this.growMeshes.length) for (const m of [...this.growMeshes]) { m.scale.y = Math.min(1, m.scale.y + dt * 1.2); if (m.scale.y >= 1) this.growMeshes.splice(this.growMeshes.indexOf(m), 1); }
    if (this.metrics && this.mode === 'build') this.metrics.tick(dt);
    if (this.mode === 'build' && (this._recT = (this._recT ?? 2) - dt) <= 0) { this._recT = 2; this.updateRecovery(); }
    this.updateTutorial();
    this.updateAccidentReaction();
    if (this.nav) this.nav.budget = 3; // 経路探索はフレームごとに最大3件
    if (this.nav) { if (this.navDirty) { this.navDirty = false; this.nav.buildStatic(); for (const p of this.placed) if (p.type === 'footbridge' || p.type === 'plank') this.nav.addBridge(p.a, p.b); } this.nav.refresh(this.time); }
    this.updateThrows(dt);
    this.updateAlarm(dt);
    this.workers.update(dt);
    this.crate.update(dt);
    if (this.pile) { if ((this._pileT = (this._pileT ?? 1) - dt) <= 0) { this._pileT = 2; this.pile.plan(); } this.pile.update(); }
    if (!this.machine.carried) this.machine.update(dt);
    if (!this.train.carried) this.train.update(dt);
    this.factory.update(dt);
    for (const e of this.dynamicProps || []) e.sync();
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
    return this.stock + this.crate.count + this.machine.hopper + this.workers.inHands() + inCourse + (this.roomba ? this.roomba.bin : 0) + this.train.load + (this.factory ? this.factory.box : 0);
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
    for (const d of this.dominoes.list) if (!d.slot) { const t = d.body.translation(), r = d.body.rotation(); loose.push([+t.x.toFixed(2), +t.z.toFixed(2), +t.y.toFixed(3), +r.x.toFixed(4), +r.y.toFixed(4), +r.z.toFixed(4), +r.w.toFixed(4)]); }
    return {
      rail: this.crossings ? this.crossings.serialize() : undefined,
      railPlans: this.railPlans ? this.railPlans.serialize() : undefined,
      course: this.course.serialize(),
      pieces: this.pieces.map((p) => ({ id: p.id, type: p.type, x: p.x, z: p.z, yaw: p.yaw })),
      placed: this.placed.map((p) => ({ type: p.type, x: p.x, z: p.z, yaw: p.yaw, auto: p.auto ? 1 : undefined })),
      built, loose,
      stoppers: this.stoppers.map((s) => [slotKey(s.slot), slotKey(s.next), s.locked ? 1 : 0, s.emergency ? 1 : 0]),
      designed: true,
      courseVer: this.def.courseVer || 1,
      checkpoints: this.checkpoints.map((c) => (c.done ? 1 : 0)),
      specials: this.specials.map((sp) => (sp.consumed ? 1 : 0)),
      markers: this.markers.map((m) => (m.consumed ? 1 : 0)),
      chests: this.chests.map((c) => (c.opened ? 1 : 0)),
      gachaUsed: this.gachaMachine.used,
      finalChest: this.finalChest.opened,
      // 在庫（資材箱の中身は grab.crate に別に保存。二重計上しない）
      stock: this.stock + (this.pile ? this.pile.count : 0) + this.machine.hopper + this.workers.inHands() + this.train.load + (this.roomba ? this.roomba.bin : 0) + (this.factory ? this.factory.box : 0),
      grab: this.serializeGrab(),
      pieceSeq: this.pieceSeq || 0,
    };
  }
  applyStageSave(d) {
    if (d.designed !== true) d = { ...d, pieces: [] };
    this.pieceSeq = 0;
    for (const p of d.pieces || []) {
      this.pieceSeq = Math.max(this.pieceSeq, p.id - 1);
      const piece = p.type === 'bridge' ? new BridgePiece(this.scene, this.physics, p, p.id) : new LauncherPiece(this.scene, this.physics, p.type, p, p.id);
      piece.onFire = (pc) => this.onPieceFire(pc);
      this.pieces.push(piece);
      this.pieceSeq = Math.max(this.pieceSeq, p.id);
    }
    // v0.3：コースは CPU 設計の固定コース。v0.2 の自由設計コースは引き継げないので、
    // 置いてあったドミノは在庫に戻す（数は失わない）
    const designed = d.designed === true;
    // v0.4：ステージ1の設計図が長くなった。古い設計図のデータは配置を在庫に戻し、中間ゴールの記録も新しいコースに合わせて初期化
    const sameCourse = designed && (d.courseVer || 1) === (this.def.courseVer || 1);
    if (!sameCourse) { d = { ...d, stock: (d.stock || 0) + (d.built || []).length + (d.loose || []).length, built: [], loose: [], stoppers: [], placed: [], checkpoints: [], specials: [], rail: null, railPlans: null }; }
    // 交差地点（階段・撤去）を先に戻す：階段の上のマスは高さが変わるので、ドミノを置く前に
    if (this.crossings) this.crossings.load(d.rail);
    if (this.railPlans) this.railPlans.load(d.railPlans);
    (d.checkpoints || []).forEach((v, i) => { if (this.checkpoints[i] && v) this.checkpoints[i].done = true; });
    (d.specials || []).forEach((v, i) => { if (this.specials[i] && v) this.specials[i].consumed = true; });
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
    for (const [x, z, y, qx, qy, qz, qw] of d.loose || []) {
      // 手で置いたドミノ：姿勢ごと復元（立っていれば立ったまま）。古い形式は寝かせて置く
      if (qw !== undefined) {
        const up = 1 - 2 * (qx * qx + qz * qz);
        const nd = this.dominoes.create({ x, y, z }, { quat: { x: qx, y: qy, z: qz, w: qw }, frozen: up < 0.9 });
        if (nd && up >= 0.9) { nd.toppled = false; nd.standing = true; nd.body.sleep(); nd.releasedAt = this.time; }
      } else this.dominoes.create({ x, y: 0, z, yaw: Math.random() * 6 }, { lying: true, frozen: true });
      used++;
    }
    for (const p of d.placed || []) { if (p.type === 'plank') { this.addWalkway('plank', p.x, p.z, p.yaw); continue; } const q = this.placePiece(p.type, p.x, p.z, p.yaw, true, !!p.auto); if (q && p.auto) q.auto = true; }
    for (const st of d.stoppers || []) {
      const a = byKey.get(st[0]), b = byKey.get(st[1]);
      if (a && b) { const s = this.installStopper(a, b, !!st[3]); if (s && st[2]) s.setLocked(true); }
    }
    this.stock = d.stock ?? CFG.startStock;
    void used;
  }
}

export { PARTS, EVOLUTIONS, PLACEABLE };
