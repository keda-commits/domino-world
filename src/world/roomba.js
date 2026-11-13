import * as THREE from 'three';
import { R } from '../core/physics.js';
import { MAT, rbox, shadow } from './props.js';

/**
 * ステージ2の脅威：ロボット掃除機「ルンバ」。
 * - 充電台で待機（出動までのカウントダウンと次の巡回ルートを床に予告表示）
 * - 決まった巡回パターンを順番に実行（ジグザグ・外周・スポット掃除）
 * - 前方センサーで家具・バリケード・壁を検知すると後退して方向転換
 * - ドミノは低くて検知できない → 運動学剛体で実際に押し倒す
 * - 倒れて寝ているドミノは吸い込む（ダストボックス → 充電台に戻ると吐き出す）
 * - 特殊ベルが鳴ると充電台へ帰る
 */
export class Roomba {
  constructor(scene, physics, stage, def) {
    this.scene = scene; this.physics = physics; this.stage = stage; this.def = def;
    this.r = def.radius;
    this.h = 1.15;
    this.pos = new THREE.Vector3(def.dock.x, 0, def.dock.z + this.r + 0.5);
    this.yaw = Math.PI;
    this.state = 'dock';
    this.timer = def.idleTime * 0.6;
    this.patternIdx = 0;
    this.wp = 0;
    this.speed = 5;
    this.turnRate = 2.4;
    this.avoid = 0; // 回避中の残り時間
    this.reverse = 0;
    this.bin = 0; // 吸い込んだドミノ
    this.enabled = true;
    this.aggressive = false;
    this.paused = 0; // ベルで止まる時間
    this.sinceBump = 0;
    this.knocks = 0;

    // 物理（運動学剛体：ドミノを押し倒す）
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.h / 2, this.pos.z));
    physics.world.createCollider(R.ColliderDesc.cylinder(this.h / 2, this.r).setFriction(0.3), this.body);

    // 見た目：実物に近いロボット掃除機（艶のある黒い樹脂天板・金属リング・LiDAR 塔・前面バンパー・車輪）
    const g = new THREE.Group();
    const R0 = this.r, H = this.h;
    const resin = new THREE.MeshPhysicalMaterial({ color: '#16181c', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
    const darkPl = new THREE.MeshPhysicalMaterial({ color: '#24272d', roughness: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#b9c0c8', roughness: 0.22, metalness: 0.95 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.9 });
    const lathe = (pts, mat, seg = 64) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
    // 本体（側面は少し内側へすぼまる）
    g.add(lathe([[0, 0.12], [R0 * 0.94, 0.12], [R0, 0.3], [R0, H * 0.72], [R0 * 0.97, H * 0.8], [0, H * 0.8]], darkPl));
    // 艶のある天板
    const top = lathe([[0, H * 0.86], [R0 * 0.95, H * 0.86], [R0 * 0.97, H * 0.8], [R0 * 0.9, H * 0.79]], resin);
    g.add(top);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 0.95, R0 * 0.95, 0.03, 64), resin); plate.position.y = H * 0.86; g.add(plate);
    // 金属リング
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 * 0.62, 0.035, 8, 64), chrome); ring.rotation.x = Math.PI / 2; ring.position.y = H * 0.885; g.add(ring);
    // LiDAR 塔（回転して周りを“見る”）
    this.lidar = new THREE.Group(); this.lidar.position.set(0, H * 0.88, -R0 * 0.25);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.42, 32), resin); tower.position.y = 0.21; this.lidar.add(tower);
    const lcap = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 32), chrome); lcap.position.y = 0.44; this.lidar.add(lcap);
    this.scan = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.05), new THREE.MeshStandardMaterial({ color: '#ff2b2b', emissive: '#ff2b2b', emissiveIntensity: 3 }));
    this.scan.position.set(0, 0.22, 0.64); this.lidar.add(this.scan);
    g.add(this.lidar);
    // 操作ボタンと状態 LED（待機中は青、出動中は赤く脈打つ）
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 24), chrome); btn.position.set(0, H * 0.9, R0 * 0.45); g.add(btn);
    this.led = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 32), new THREE.MeshStandardMaterial({ color: '#3fa9ff', emissive: '#3fa9ff', emissiveIntensity: 2 }));
    this.led.rotation.x = Math.PI / 2; this.led.position.set(0, H * 0.885, R0 * 0.45); g.add(this.led);
    // 前面バンパー（半周）と赤外線センサー窓（赤い目）
    const bumper = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 1.025, R0 * 1.025, H * 0.48, 48, 1, true, -Math.PI / 2 - 0.2, Math.PI + 0.4), darkPl);
    bumper.position.y = H * 0.42; g.add(bumper);
    this.eye = new THREE.Mesh(new THREE.CylinderGeometry(R0 * 1.03, R0 * 1.03, 0.12, 48, 1, true, -0.55, 1.1), new THREE.MeshStandardMaterial({ color: '#ff2b2b', emissive: '#ff2b2b', emissiveIntensity: 2, side: THREE.DoubleSide }));
    this.eye.position.y = H * 0.5; g.add(this.eye);
    // 車輪（わずかに見える）
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 20), rubber); w.rotation.z = Math.PI / 2; w.position.set(sx * R0 * 0.78, 0.3, 0); g.add(w); }
    // サイドブラシ（3本の毛）
    this.brushes = [];
    for (const sx of [-1, 1]) {
      const br = new THREE.Group();
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.06), MAT.matte('#d8dde3')); b.position.x = 0.6; const piv = new THREE.Group(); piv.add(b); piv.rotation.y = (i / 3) * Math.PI * 2; br.add(piv); }
      br.position.set(sx * R0 * 0.62, 0.05, R0 * 0.68);
      g.add(br); this.brushes.push(br);
    }
    shadow(g);
    this.group = g;
    scene.add(g);

    // 危険エリアの予告表示（次のルート）
    this.preview = new THREE.Group();
    scene.add(this.preview);
    this.alertRing = new THREE.Mesh(new THREE.RingGeometry(this.r + 0.4, this.r + 1.2, 48), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.0, side: THREE.DoubleSide }));
    this.alertRing.rotation.x = -Math.PI / 2;
    scene.add(this.alertRing);
    this.buildPreview();
    this.sync();
  }

  get pattern() { return this.def.patterns[this.patternIdx % this.def.patterns.length]; }

  buildPreview() {
    this.preview.clear();
    const pts = this.pattern.pts;
    const mat = new THREE.MeshBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: 0.35, depthWrite: false });
    const dot = new THREE.CircleGeometry(0.35, 10);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < len; s += 2.2) {
        const m = new THREE.Mesh(dot, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(ax + ((bx - ax) * s) / len, 0.2, az + ((bz - az) * s) / len);
        this.preview.add(m);
      }
    }
    // 幅（ルンバの通り道）
    const band = new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.07, depthWrite: false });
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(this.r * 2, len), band);
      m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(bx - ax, bz - az);
      m.position.set((ax + bx) / 2, 0.19, (az + bz) / 2);
      this.preview.add(m);
    }
  }

  /** センサー：前方 dist の位置に障害物があるか */
  blockedAt(x, z) {
    const st = this.stage;
    if (!st.inBounds(x, z, this.r * 0.9)) return true;
    if (st.blocked(x, z, this.r * 0.85, true)) return true;
    return false;
  }

  update(dt, game) {
    this.sinceBump += dt;
    for (const br of this.brushes) br.rotation.y += dt * (this.state === 'dock' ? 0 : 18);
    if (!this.enabled) { this.sync(); return; }
    if (this.paused > 0) { this.paused -= dt; }
    switch (this.state) {
      case 'dock':
        this.timer -= dt;
        this.preview.visible = true;
        if (this.timer <= 3 && !this.warned) { this.warned = true; game.onRoombaWarn && game.onRoombaWarn(this); } // 出発の予告
        if (this.timer <= 0) { this.warned = false; this.state = 'leave'; this.leaveT = 1.2; this.trail = [this.pos.clone()]; game.onRoombaDepart && game.onRoombaDepart(this); }
        break;
      case 'leave':
        // 充電台からゆっくりバックで離れてから向きを変える
        this.leaveT -= dt;
        this.move(-1.4 * dt); // 充電台は背中側（yaw=π で台を向いて止まっている）
        if (this.leaveT <= 0) { this.state = 'patrol'; this.wp = 0; }
        break;
      case 'patrol':
      case 'return': {
        if (this.paused > 0 && this.state === 'patrol') break;
        const pts = this.state === 'patrol' ? this.pattern.pts : this.returnPath || [[this.def.dock.x, this.def.dock.z + this.r + 0.5]];
        const [tx, tz] = pts[Math.min(this.wp, pts.length - 1)];
        const dx = tx - this.pos.x, dz = tz - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          if (this.state === 'patrol') (this.trail ||= []).push(new THREE.Vector3(tx, 0, tz));
          this.wp++;
          if (this.wp >= pts.length) {
            if (this.state === 'patrol') this.beginReturn(game);
            else this.dockIn(game);
          }
          break;
        }
        // 目標に近づけない時間が続いたら（家具のすき間にはまったら）次の地点へ
        if (this.progWp !== this.wp || this.progState !== this.state) { this.progWp = this.wp; this.progState = this.state; this.bestDist = dist; this.progT = 0; }
        if (dist < this.bestDist - 0.5) { this.bestDist = dist; this.progT = 0; } else this.progT += dt;
        if (this.progT > 6 && this.state === 'patrol') { this.wp++; this.progT = 0; if (this.wp >= pts.length) this.beginReturn(game); break; }
        // 帰り道で行き詰まったら：切り返し（後退＋旋回）してから、通ってきた地点を1つ先へ（瞬間移動はしない）
        if (this.progT > 5 && this.state === 'return') { this.progT = 0; this.reverse = 0.9; this.avoidDir = Math.random() < 0.5 ? 1 : -1; this.stuckTries = (this.stuckTries || 0) + 1; if (this.stuckTries % 2 === 0 && this.wp < pts.length - 1) this.wp++; break; }
        let want = Math.atan2(dx, dz);
        const sp = this.speed * (this.aggressive ? 1.5 : 1) * (this.state === 'return' && this.recalled ? 1.6 : 1);
        if (this.reverse > 0) {
          this.reverse -= dt;
          this.move(-sp * 0.5 * dt);
          this.yaw += this.avoidDir * this.turnRate * 1.3 * dt;
          break;
        }
        if (this.avoid > 0) { this.avoid -= dt; want = this.yaw + this.avoidDir * 1.2; }
        // 前方センサー
        const ahead = this.r + 0.8;
        const fx = this.pos.x + Math.sin(this.yaw) * ahead, fz = this.pos.z + Math.cos(this.yaw) * ahead;
        if (this.blockedAt(fx, fz) || game.barricadeHit(fx, fz, this.r * 0.8)) {
          // 左右どちらが空いているか
          const l = this.probe(this.yaw + 1.0, ahead), r = this.probe(this.yaw - 1.0, ahead);
          this.avoidDir = l && !r ? 1 : r && !l ? -1 : (Math.random() < 0.5 ? 1 : -1);
          if (!l && !r) this.avoidDir = 1;
          this.reverse = 0.35; this.avoid = 0.9;
          if (this.sinceBump > 1.5) { game.onRoombaBump && game.onRoombaBump(this, game.barricadeHit(fx, fz, this.r * 0.8)); this.sinceBump = 0; }
          break;
        }
        let d = want - this.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.yaw += Math.max(-1, Math.min(1, d)) * this.turnRate * dt;
        // 曲がりながら減速（目標のまわりを回り続けないように）
        const turnSlow = Math.max(0.12, 1 - Math.abs(d) / 1.3);
        const nearSlow = Math.min(1, Math.max(0.35, dist / 4));
        this.move(sp * dt * turnSlow * nearSlow);
        break;
      }
    }
    this.sync();
    // 倒れているドミノは吸い込む
    if (this.state !== 'dock') this.bin += game.roombaSuck(this.pos, this.r * 0.85);
    // 警告リング
    this.alertRing.position.set(this.pos.x, 0.22, this.pos.z);
    this.alertRing.material.opacity = this.state === 'dock' ? 0 : 0.25 + Math.sin(performance.now() * 0.01) * 0.15;
    const t = performance.now() * 0.001, act = this.state !== 'dock';
    this.eye.material.emissiveIntensity = act ? 1.6 + Math.sin(t * 15) * 1.1 : 0.15;
    this.lidar.rotation.y += dt * (act ? 6 : 0.6);
    this.led.material.emissive.set(act ? '#ff2b2b' : '#3fa9ff'); this.led.material.color.copy(this.led.material.emissive);
    this.led.material.emissiveIntensity = act ? 2 + Math.sin(t * 9) * 1.2 : 1 + Math.sin(t * 2) * 0.6;
  }

  probe(yaw, dist) { return !this.blockedAt(this.pos.x + Math.sin(yaw) * dist, this.pos.z + Math.cos(yaw) * dist); }

  move(step) {
    this.pos.x += Math.sin(this.yaw) * step;
    this.pos.z += Math.cos(this.yaw) * step;
  }

  /** 帰り道：通ってきた地点を逆にたどって充電台へ（通れることが分かっている道） */
  beginReturn(game) {
    const dockPt = [this.def.dock.x, this.def.dock.z + this.r + 0.5];
    const back = (this.trail || []).slice().reverse().map((v) => [v.x, v.z]);
    // 今いる所から一番近い地点からたどる
    let best = 0, bd = Infinity;
    back.forEach(([x, z], i) => { const d = (x - this.pos.x) ** 2 + (z - this.pos.z) ** 2; if (d < bd) { bd = d; best = i; } });
    this.returnPath = [...back.slice(best), dockPt];
    this.state = 'return'; this.wp = 0; this.stuckTries = 0;
    game && game.onRoombaReturn && game.onRoombaReturn(this);
  }
  dockIn(game) {
    this.state = 'dock'; this.returnT = 0; this.returnPath = null; this.trail = [];
    game && game.onRoombaDock && game.onRoombaDock(this);
    this.timer = this.recalled ? Math.max(this.def.idleTime, this.recallTime || 45) : this.def.idleTime;
    this.recalled = false;
    this.patternIdx++;
    this.buildPreview();
    if (this.bin > 0) { game.roombaDump(this.bin, this.def.dock); this.bin = 0; }
  }

  /** 特殊ベル：充電台へ帰る */
  recall(time = 45) {
    this.recallTime = time;
    if (this.state === 'dock') { this.timer = Math.max(this.timer, time); return; }
    this.recalled = true; this.beginReturn(null);
  }

  sync() {
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.h / 2 + 0.02, z: this.pos.z });
    this.body.setNextKinematicRotation(this.physics.quatYaw(this.yaw));
    this.group.position.set(this.pos.x, 0, this.pos.z);
    this.group.rotation.y = this.yaw;
  }

  /** 次に動くまでの秒数 */
  eta() { return this.state === 'dock' ? this.timer : 0; }

  dispose() {
    this.physics.world.removeRigidBody(this.body);
    this.scene.remove(this.group, this.preview, this.alertRing);
  }
}
