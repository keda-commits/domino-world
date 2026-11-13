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

    // 見た目：大きな円盤の怪物
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(this.r, this.r * 0.98, this.h * 0.7, 48), MAT.plastic('#2b2f36'));
    top.position.y = this.h * 0.55; g.add(top);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(this.r * 1.01, this.r * 1.01, this.h * 0.35, 48), MAT.metal('#8c939c'));
    rim.position.y = this.h * 0.2; g.add(rim);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(this.r * 0.75, this.r * 0.75, 0.06, 40), MAT.plastic('#3a3f48'));
    lid.position.y = this.h * 0.92; g.add(lid);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 20), MAT.metal('#d0d4da'));
    btn.position.set(0, this.h * 0.96, this.r * 0.3); g.add(btn);
    this.eye = new THREE.Mesh(new THREE.BoxGeometry(this.r * 0.9, 0.18, 0.12), new THREE.MeshStandardMaterial({ color: '#ff2b2b', emissive: '#ff2b2b', emissiveIntensity: 2 }));
    this.eye.position.set(0, this.h * 0.6, this.r * 0.98); g.add(this.eye);
    const bumper = new THREE.Mesh(new THREE.TorusGeometry(this.r * 1.0, 0.12, 8, 40, Math.PI), MAT.plastic('#15181c'));
    bumper.rotation.x = Math.PI / 2; bumper.rotation.z = Math.PI; bumper.position.y = this.h * 0.35; g.add(bumper);
    this.brushes = [];
    for (const sx of [-1, 1]) {
      const br = new THREE.Group();
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.08), MAT.matte('#e9ecef')); b.position.x = 0.7; b.rotation.y = (i / 3) * Math.PI * 2; const piv = new THREE.Group(); piv.add(b); piv.rotation.y = (i / 3) * Math.PI * 2; br.add(piv); }
      br.position.set(sx * this.r * 0.6, 0.05, this.r * 0.7);
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
        if (this.timer <= 0) { this.state = 'patrol'; this.wp = 0; game.onRoombaDepart && game.onRoombaDepart(this); }
        break;
      case 'patrol':
      case 'return': {
        if (this.paused > 0 && this.state === 'patrol') break;
        const pts = this.state === 'patrol' ? this.pattern.pts : [[this.def.dock.x, this.def.dock.z + this.r + 0.5]];
        const [tx, tz] = pts[Math.min(this.wp, pts.length - 1)];
        const dx = tx - this.pos.x, dz = tz - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          this.wp++;
          if (this.wp >= pts.length) {
            if (this.state === 'patrol') { this.state = 'return'; this.wp = 0; }
            else this.dockIn(game);
          }
          break;
        }
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
        this.move(sp * dt * (Math.abs(d) > 1.2 ? 0.3 : 1));
        break;
      }
    }
    this.sync();
    // 倒れているドミノは吸い込む
    if (this.state !== 'dock') this.bin += game.roombaSuck(this.pos, this.r * 0.85);
    // 警告リング
    this.alertRing.position.set(this.pos.x, 0.22, this.pos.z);
    this.alertRing.material.opacity = this.state === 'dock' ? 0 : 0.25 + Math.sin(performance.now() * 0.01) * 0.15;
    this.eye.material.emissiveIntensity = this.state === 'dock' ? 0.5 : 1.5 + Math.sin(performance.now() * 0.015) * 1;
  }

  probe(yaw, dist) { return !this.blockedAt(this.pos.x + Math.sin(yaw) * dist, this.pos.z + Math.cos(yaw) * dist); }

  move(step) {
    this.pos.x += Math.sin(this.yaw) * step;
    this.pos.z += Math.cos(this.yaw) * step;
  }

  dockIn(game) {
    this.state = 'dock';
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
    this.state = 'return'; this.wp = 0; this.recalled = true;
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
