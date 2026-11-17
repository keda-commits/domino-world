import * as THREE from 'three';
import { R } from '../core/physics.js';
import { MAT, rbox, shadow } from './props.js';
import { PathFollower } from '../game/nav.js';

/**
 * Ver.0.5：ステージ1の後半（プレイヤーレベル5以上）から少しずつ出てくる敵。
 * - MischiefRobot（いたずらロボット）：ゆっくり歩いてドミノの横へ行き、腕を振り上げて押す。
 *     防衛：おもちゃの兵隊（撃退・押し返し）／手でつかんで戻す。バリケードは回り込まれる。
 * - RunawayCar（暴走ミニカー）：予告の矢印のあと、まっすぐ猛スピードで走る（物理でドミノをはね飛ばす）。
 *     防衛：バリケード（ぶつかると跳ね返る）／予告中に手でつかんで向きを変える。兵隊は速すぎて止められない。
 * どちらも画面の中で消えたりワープしたりしない（帰り道も歩いて／走って帰る）。
 * 共通：repel(from, kind) … 防衛に当たったときに動きが実際に変わる（後退・気絶・帰還）。
 */

const tmpV = new THREE.Vector3();
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

function robotModel() {
  const g = new THREE.Group();
  const body = MAT.plastic('#adb5bd'), dark = MAT.plastic('#343a40'), red = MAT.plastic('#e03131');
  const torso = new THREE.Mesh(rbox(0.9, 0.8, 0.6, 0.12), body); torso.position.y = 0.85; g.add(torso);
  const head = new THREE.Mesh(rbox(0.6, 0.45, 0.5, 0.1), body); head.position.y = 1.5; g.add(head);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', emissive: '#ff2020', emissiveIntensity: 0.2 });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), eyeMat); eye.position.set(sx * 0.14, 1.55, 0.26); g.add(eye);
  }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), dark); ant.position.y = 1.85; g.add(ant);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), red); bulb.position.y = 2.02; g.add(bulb);
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.55, 1.1, 0);
    const arm = new THREE.Mesh(rbox(0.16, 0.6, 0.16, 0.05), dark); arm.position.y = -0.28; pivot.add(arm);
    const claw = new THREE.Mesh(rbox(0.22, 0.12, 0.22, 0.04), red); claw.position.y = -0.62; pivot.add(claw);
    g.add(pivot); arms.push(pivot);
  }
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(rbox(0.22, 0.45, 0.28, 0.05), dark); leg.position.set(sx * 0.22, 0.25, 0); g.add(leg); legs.push(leg);
  }
  // 背中のゼンマイ
  const key = new THREE.Group(); key.position.set(0, 0.95, -0.36);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 6, 12), MAT.metal('#d4b05a')); w.position.set(sx * 0.13, 0, -0.05); w.rotation.y = Math.PI / 2; key.add(w); }
  g.add(key);
  shadow(g);
  g.userData = { arms, legs, key, eyeMat, bulb };
  return g;
}

export class MischiefRobot {
  constructor(game, def) {
    this.game = game; this.def = def;
    this.name = 'いたずらロボット';
    this.home = new THREE.Vector3(def.home.x, 0, def.home.z);
    this.group = robotModel();
    this.group.position.copy(this.home);
    game.scene.add(this.group);
    this.pos = this.group.position;
    // 住みか：ふたの開いたおもちゃ箱（ロボットはこの前で充電している）
    const box = new THREE.Group();
    const wood = MAT.wood('#e8590c');
    box.add(at(new THREE.Mesh(rbox(2.6, 1.4, 1.8, 0.1), wood), 0, 0.7, 0));
    const lid = new THREE.Mesh(rbox(2.7, 0.12, 1.9, 0.05), MAT.wood('#ffa94d')); lid.position.set(0, 1.9, -1.1); lid.rotation.x = -1.2; box.add(lid);
    box.position.set(this.home.x, 0, this.home.z - 2.0); shadow(box); game.scene.add(box); this.box = box;
    game.stage.obstacles.push({ x: box.position.x, z: box.position.z, hw: 1.4, hd: 1.0, yaw: 0, roomba: true, build: true });
    this.state = 'home';
    this.timer = def.firstDelay || 40;
    this.hp = 3; this.stun = 0; this.knock = null;
    this.pf = new PathFollower(1);
    this.trips = 0; this.repelled = 0;
  }
  get active() { return this.game.progress.level >= (this.def.minLevel || 5); }
  get attacking() { return this.state === 'go' || this.state === 'windup'; }

  chooseTarget() {
    const g = this.game;
    const list = g.course.allSlots.filter((s) => s.order >= 0 && s.domino && g.dominoes.isStandingAt(s.domino, s));
    if (list.length < 30) return null;
    // 近い順に並べ、近めの所からランダム（遠征しすぎない）
    list.sort((a, b) => ((a.x - this.home.x) ** 2 + (a.z - this.home.z) ** 2) - ((b.x - this.home.x) ** 2 + (b.z - this.home.z) ** 2));
    return list[Math.floor(Math.random() * Math.min(list.length, 160))];
  }

  update(dt) {
    const g = this.game, u = this.group.userData;
    u.key.rotation.z += dt * (this.state === 'home' ? 0.5 : 6);
    u.eyeMat.emissiveIntensity = this.stun > 0 ? 0.05 + Math.abs(Math.sin(g.time * 20)) * 0.4 : this.attacking ? 1.2 : this.state === 'warn' ? 0.6 + Math.sin(g.time * 18) * 0.5 : 0.2;
    if (this.held) { this.pose(dt, 'held'); return; }
    if (g.mode !== 'build' && this.state !== 'home' && this.state !== 'return') this.startReturn();
    // 押し返された：すべるように後ろへ下がる（実際に位置が変わる）
    if (this.knock) {
      const k = this.knock; const st = Math.min(k.left, 9 * dt); k.left -= st;
      const nx = this.pos.x + k.x * st, nz = this.pos.z + k.z * st;
      if (g.stage.inBounds(nx, nz, 0.6) && !g.stage.blocked(nx, nz, 0.4)) { this.pos.x = nx; this.pos.z = nz; }
      this.group.rotation.z = Math.sin(g.time * 30) * 0.15;
      if (k.left <= 0) { this.knock = null; this.group.rotation.z = 0; }
      return;
    }
    if (this.stun > 0) { this.stun -= dt; this.group.rotation.y += dt * 3; this.pose(dt, 'stun'); if (this.stun <= 0 && this.retreatAfterStun) { this.retreatAfterStun = false; this.startReturn(); } return; }
    switch (this.state) {
      case 'home':
        this.pose(dt, 'idle');
        if (!this.active || g.mode !== 'build' || g.gachaActive) return;
        this.timer -= dt;
        if (this.timer <= 0) {
          this.target = this.chooseTarget();
          if (!this.target) { this.timer = 10; return; }
          this.state = 'warn'; this.timer = 2.5; this.hp = 3; this.shoves = 0;
          g.fx.floatAt(this.pos.clone().setY(2.6), '🤖 ピピッ！ いたずらロボットが起動した', 'warn', 2.5);
          g.audio.squeak && g.audio.squeak(0.6);
          g.onThreatWarn(this, this.target);
        }
        break;
      case 'warn':
        this.timer -= dt; this.pose(dt, 'warn');
        if (this.timer <= 0) this.state = 'go';
        break;
      case 'go': {
        const s = this.target;
        if (!s || !s.domino || !g.dominoes.isStandingAt(s.domino, s)) { this.target = this.chooseTarget(); if (!this.target) { this.startReturn(); break; } }
        const t = this.target;
        const nx = Math.cos(t.yaw), nz = -Math.sin(t.yaw);
        const side = ((this.pos.x - t.x) * nx + (this.pos.z - t.z) * nz) >= 0 ? 1 : -1;
        tmpV.set(t.x + nx * side * 0.9, 0, t.z + nz * side * 0.9);
        if (this.walkTo(tmpV, dt, 2.3)) { this.state = 'windup'; this.timer = 1.6; this.group.rotation.y = Math.atan2(t.x - this.pos.x, t.z - this.pos.z); g.fx.floatAt(this.pos.clone().setY(2.4), 'ウィーン…（腕を振り上げた！）', 'warn', 1.5); }
        break;
      }
      case 'windup': {
        this.timer -= dt; this.pose(dt, 'windup');
        if (this.timer <= 0) {
          const t = this.target;
          if (t && t.domino && g.dominoes.isStandingAt(t.domino, t)) {
            g.dominoes.push(t.domino, Math.sin(t.yaw), Math.cos(t.yaw), 0.07);
            g.stats.robotHits = (g.stats.robotHits || 0) + 1;
            g.fx.floatAt(this.pos.clone().setY(2.2), 'ドーン！', 'warn', 1.0);
            g.onThreatHit(this, t);
          }
          this.startReturn();
        }
        break;
      }
      case 'return':
        if (this.walkTo(this.home, dt, 2.6)) { this.state = 'home'; const [a, b] = this.def.interval || [70, 100]; this.timer = a + Math.random() * (b - a); this.trips++; this.group.rotation.y = 0; }
        break;
    }
  }
  startReturn() { this.state = 'return'; this.target = null; this.pf.reset(); }
  /** 防衛に当たった：dart（スポンジ弾）は3発で気絶→帰る／shove（押し返し）は後ろへ押されて気絶、2回で帰る */
  repel(from, kind) {
    if (this.state === 'home' || this.state === 'return' && kind === 'dart') return false;
    const g = this.game;
    const dx = this.pos.x - from.x, dz = this.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    if (kind === 'dart') {
      this.hp--;
      this.knock = { x: dx / d, z: dz / d, left: 0.5 };
      if (this.hp <= 0) { this.stun = 1.5; this.retreatAfterStun = true; this.repelled++; g.stats.robotRepelled = (g.stats.robotRepelled || 0) + 1; g.fx.floatAt(this.pos.clone().setY(2.4), 'ピピー…撤退します', 'coin', 1.6); }
      else if (this.state === 'windup') { this.state = 'go'; } // 振り上げを中断
    } else {
      this.shoves = (this.shoves || 0) + 1;
      this.knock = { x: dx / d, z: dz / d, left: 3.5 };
      this.stun = 1.2;
      if (this.state === 'windup') this.state = 'go';
      if (this.shoves >= 2) { this.retreatAfterStun = true; this.repelled++; g.stats.robotRepelled = (g.stats.robotRepelled || 0) + 1; g.fx.floatAt(this.pos.clone().setY(2.4), 'ピピー…撤退します', 'coin', 1.6); }
    }
    return true;
  }
  walkTo(p, dt, speed) {
    const g = this.game;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.2) return true;
    let sx = dx, sz = dz, sd = d;
    if (g.nav && d > 1.5) {
      const wp = this.pf.next(g.nav, this.pos, p, g.time);
      if (wp) { sx = wp.x - this.pos.x; sz = wp.z - this.pos.z; sd = Math.hypot(sx, sz) || 1; }
    }
    const st = Math.min(d, speed * dt);
    this.pos.x += (sx / sd) * st; this.pos.z += (sz / sd) * st;
    this.group.rotation.y = Math.atan2(sx, sz);
    this.pose(dt, 'walk');
    return false;
  }
  pose(dt, kind) {
    const u = this.group.userData, t = this.game.time;
    const s = kind === 'walk' ? Math.sin(t * 9) : 0;
    u.legs[0].position.y = 0.25 + Math.max(0, s) * 0.12; u.legs[1].position.y = 0.25 + Math.max(0, -s) * 0.12;
    let a = s * 0.4;
    if (kind === 'windup') a = -2.6 + Math.sin(t * 25) * 0.1;
    if (kind === 'warn') a = Math.sin(t * 12) * 0.5;
    if (kind === 'stun' || kind === 'held') a = -1.2 + Math.sin(t * 15) * 0.6;
    u.arms[0].rotation.x = a; u.arms[1].rotation.x = kind === 'walk' ? -a : a;
    this.group.position.y = kind === 'walk' ? Math.abs(s) * 0.05 : 0;
  }
  describe() {
    const st = { home: 'おもちゃ箱の前で充電中', warn: '起動中！', go: 'ドミノへ向かって歩いている！', windup: '腕を振り上げた！（押す直前）', return: 'おもちゃ箱へ帰り中' }[this.state];
    const rows = [['行動', this.stun > 0 ? '目を回している' : st], ['危険度', this.attacking ? '中（1枚押して連鎖事故）' : '低'], ['耐久', this.attacking ? `スポンジ弾あと${Math.max(0, this.hp)}発` : '—']];
    if (this.state === 'home' && this.active) rows.push(['次に動く', `あと約 ${Math.max(0, Math.ceil(this.timer))} 秒`]);
    if (!this.active) rows.push(['出現', `レベル${this.def.minLevel || 5}から`]);
    return { title: '🤖 いたずらロボット', rows, note: '対策：おもちゃの兵隊（撃退）／手でつかんで遠くへ／狙われた先のドミノを抜く。バリケードは回り込まれる', warn: this.attacking };
  }
  dispose() { this.game.scene.remove(this.group, this.box); }
}

function carModel() {
  const g = new THREE.Group();
  const red = MAT.plastic('#ff922b'), dark = MAT.plastic('#212529'), glass = MAT.plastic('#74c0fc');
  const body = new THREE.Mesh(rbox(0.9, 0.35, 1.6, 0.12), red); body.position.y = 0.32; g.add(body);
  const cab = new THREE.Mesh(rbox(0.7, 0.3, 0.7, 0.1), glass); cab.position.set(0, 0.62, -0.1); g.add(cab);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 12), dark); w.rotation.z = Math.PI / 2; w.position.set(sx * 0.48, 0.18, sz * 0.5); g.add(w); wheels.push(w); }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.5, 8), new THREE.MeshBasicMaterial({ color: '#ffd43b' })); flame.rotation.x = -Math.PI / 2; flame.position.set(0, 0.32, -1.0); flame.visible = false; g.add(flame);
  shadow(g);
  g.userData = { wheels, flame };
  return g;
}

export class RunawayCar {
  constructor(game, def) {
    this.game = game; this.def = def;
    this.name = '暴走ミニカー';
    this.garage = new THREE.Vector3(def.garage.x, 0, def.garage.z);
    this.group = carModel();
    this.group.position.copy(this.garage);
    game.scene.add(this.group);
    this.pos = this.group.position;
    // 車庫（小さなスロープつきのガレージ）
    const gar = new THREE.Group();
    gar.add(at(new THREE.Mesh(rbox(2.4, 0.08, 2.6, 0.03), MAT.plastic('#495057')), 0, 0.04, 0));
    for (const sx of [-1, 1]) gar.add(at(new THREE.Mesh(rbox(0.12, 1.2, 2.6, 0.04), MAT.plastic('#fab005')), sx * 1.2, 0.6, 0));
    gar.add(at(new THREE.Mesh(rbox(2.5, 0.12, 2.7, 0.04), MAT.plastic('#e03131')), 0, 1.25, 0));
    gar.position.copy(this.garage); shadow(gar); game.scene.add(gar); this.gar = gar;
    this.state = 'park';
    this.timer = def.firstDelay || 50;
    this.dir = new THREE.Vector3(1, 0, 0);
    this.speed = 0;
    this.pf = new PathFollower(1);
    // 走っている間だけ当たり判定（運動学的な箱）：ドミノを物理ではね飛ばす
    this.body = game.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.garage.x, -5, this.garage.z));
    game.physics.world.createCollider(R.ColliderDesc.cuboid(0.45, 0.25, 0.8).setFriction(0.3), this.body);
    this.arrow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0, depthWrite: false }));
    this.arrow.rotation.x = -Math.PI / 2; game.scene.add(this.arrow);
    this.bounces = 0;
  }
  get active() { return this.game.progress.level >= (this.def.minLevel || 7); }
  get attacking() { return this.state === 'warn' || this.state === 'drive'; }

  update(dt) {
    const g = this.game, u = this.group.userData;
    u.flame.visible = this.state === 'drive';
    if (this.held) { this.hideBody(); this.arrow.material.opacity = 0; return; }
    if (g.mode !== 'build' && this.state === 'warn') { this.state = 'park'; this.timer = 20; this.arrow.material.opacity = 0; }
    switch (this.state) {
      case 'park':
        this.hideBody();
        if (!this.active || g.mode !== 'build' || g.gachaActive) return;
        this.timer -= dt;
        if (this.timer <= 0) {
          const list = g.course.allSlots.filter((s) => s.order >= 0 && s.domino && g.dominoes.isStandingAt(s.domino, s) && (s.x - this.pos.x) ** 2 + (s.z - this.pos.z) ** 2 < 28 * 28);
          if (list.length < 10) { this.timer = 12; return; }
          const t = list[Math.floor(Math.random() * list.length)];
          this.dir.set(t.x - this.pos.x, 0, t.z - this.pos.z).normalize();
          this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
          this.state = 'warn'; this.timer = 3.0;
          g.fx.floatAt(this.pos.clone().setY(1.8), '🏎 ブロロロ…！ 暴走ミニカーが走り出しそう！', 'warn', 3);
          g.audio.squeak && g.audio.squeak(0.5);
          g.onThreatWarn(this, null);
        }
        break;
      case 'warn': {
        this.timer -= dt;
        const len = 18;
        this.arrow.scale.set(1.0, len, 1);
        this.arrow.position.set(this.pos.x + this.dir.x * len / 2, 0.05, this.pos.z + this.dir.z * len / 2);
        this.arrow.rotation.z = -Math.atan2(this.dir.x, this.dir.z);
        this.arrow.material.opacity = 0.25 + Math.abs(Math.sin(this.timer * 10)) * 0.3;
        this.group.position.y = Math.abs(Math.sin(this.timer * 40)) * 0.04;
        if (this.timer <= 0) { this.arrow.material.opacity = 0; this.state = 'drive'; this.speed = this.def.speed || 13; this.driveT = 0; this.bounces = 0; }
        break;
      }
      case 'drive': {
        this.driveT += dt;
        const step = this.speed * dt;
        const nx = this.pos.x + this.dir.x * step, nz = this.pos.z + this.dir.z * step;
        const fx = nx + this.dir.x * 0.9, fz = nz + this.dir.z * 0.9;
        if (g.barricadeHit(fx, fz, 0.2)) {
          // バリケードにぶつかった：跳ね返って、勢いが落ちる（実際に向きが変わる）
          this.dir.multiplyScalar(-1); this.speed *= 0.45; this.bounces++;
          g.stats.carBlocked = (g.stats.carBlocked || 0) + 1;
          g.fx.floatAt(this.pos.clone().setY(1.6), 'ガシャン！ バリケードで跳ね返った', 'coin', 1.6);
          g.audio.bonk && g.audio.bonk();
        } else if (!g.stage.inBounds(fx, fz, 0.5) || g.stage.blocked(fx, fz, 0)) {
          this.speed = 0; g.fx.floatAt(this.pos.clone().setY(1.6), 'ゴツン！', 'warn', 1);
        } else { this.pos.x = nx; this.pos.z = nz; }
        this.speed *= Math.exp(-dt * 0.35);
        this.group.rotation.y = Math.atan2(this.dir.x, this.dir.z);
        u.wheels.forEach((w) => (w.rotation.x += step * 4));
        this.body.setNextKinematicTranslation({ x: this.pos.x, y: 0.3, z: this.pos.z });
        this.body.setNextKinematicRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y));
        if (this.speed < 1.2 || this.driveT > 6) { this.state = 'return'; this.pf.reset(); this.hideBody(); this.trips = (this.trips || 0) + 1; if (this.bounces === 0) g.stats.carRuns = (g.stats.carRuns || 0) + 1; }
        break;
      }
      case 'return': {
        // ゆっくり車庫へ戻る（ドミノの列をよけて。当たり判定なし）
        this.hideBody();
        const dx = this.garage.x - this.pos.x, dz = this.garage.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.3) { this.state = 'park'; const [a, b] = this.def.interval || [80, 120]; this.timer = a + Math.random() * (b - a); break; }
        let sx = dx, sz = dz, sd = d;
        const wp = g.nav && d > 1.5 ? this.pf.next(g.nav, this.pos, this.garage, g.time) : null;
        if (wp) { sx = wp.x - this.pos.x; sz = wp.z - this.pos.z; sd = Math.hypot(sx, sz) || 1; }
        const st = Math.min(d, 4 * dt);
        this.pos.x += (sx / sd) * st; this.pos.z += (sz / sd) * st;
        this.group.rotation.y = Math.atan2(sx, sz);
        u.wheels.forEach((w) => (w.rotation.x += st * 4));
        break;
      }
    }
  }
  hideBody() { this.body.setNextKinematicTranslation({ x: this.pos.x, y: -5, z: this.pos.z }); }
  /** スポンジ弾・押し返しは速すぎて効かない（バリケードで止める敵） */
  repel() { return false; }
  describe() {
    const st = { park: '車庫で止まっている', warn: 'エンジンをふかしている！（矢印の方向へ走る）', drive: '暴走中！', return: '車庫へ戻り中' }[this.state];
    const rows = [['行動', st], ['危険度', this.state === 'drive' ? '高（当たったドミノをはね飛ばす）' : this.state === 'warn' ? '予告中' : '低']];
    if (this.state === 'park' && this.active) rows.push(['次に走る', `あと約 ${Math.max(0, Math.ceil(this.timer))} 秒`]);
    if (!this.active) rows.push(['出現', `レベル${this.def.minLevel || 7}から`]);
    return { title: '🏎 暴走ミニカー', rows, note: '対策：矢印の先にバリケード（跳ね返す）／予告中に手でつかんで向きを変える。兵隊のスポンジ弾は効かない', warn: this.attacking };
  }
  dispose() { this.game.scene.remove(this.group, this.arrow, this.gar); this.game.physics.world.removeRigidBody(this.body); }
}
