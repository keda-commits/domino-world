import * as THREE from 'three';
import { R } from '../core/physics.js';
import { MAT, shadow } from './props.js';

/**
 * 小さな脅威（Ver.0.4）
 * - Mouse：ゼンマイ式のいたずらネズミ。巣穴から出てきて、建設中のドミノを1枚押して事故を起こし、巣へ逃げ帰る
 * - RollingBall：ゴムボール。予告のあと勢いよく転がり、家具に跳ね返りながらドミノに当たる（止まった場所に残る）
 * どちらも建設中だけ動く（本番中は巣・その場で待つ）。画面の中で突然消えたりワープしたりしない。
 */

function mouseModel() {
  const g = new THREE.Group();
  const grey = MAT.plastic('#9aa0a8'), pink = MAT.plastic('#ffb3c1'), dark = MAT.plastic('#222');
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), grey); body.scale.set(0.85, 0.75, 1.35); body.position.y = 0.34; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), grey); head.scale.set(1, 0.9, 1.25); head.position.set(0, 0.42, 0.55); g.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), pink); nose.position.set(0, 0.42, 0.86); g.add(nose);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16), pink); ear.rotation.x = Math.PI / 2; ear.position.set(sx * 0.17, 0.66, 0.46); g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), dark); eye.position.set(sx * 0.11, 0.5, 0.78); g.add(eye);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), dark); wheel.rotation.z = Math.PI / 2; wheel.position.set(sx * 0.3, 0.1, 0.1); g.add(wheel);
  }
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 6, 16, Math.PI * 1.2), pink); tail.rotation.y = Math.PI / 2; tail.position.set(0, 0.35, -0.75); g.add(tail);
  // ゼンマイ
  const key = new THREE.Group(); key.position.set(0, 0.68, -0.15);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), MAT.metal('#d4b05a')); shaft.position.y = 0.1; key.add(shaft);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), MAT.metal('#d4b05a')); w.position.set(sx * 0.11, 0.24, 0); key.add(w); }
  g.add(key);
  g.userData.key = key;
  shadow(g);
  return g;
}

export class Mouse {
  constructor(game, def) {
    this.game = game; this.def = def;
    this.name = 'いたずらネズミ';
    this.den = new THREE.Vector3(def.den.x, 0, def.den.z);
    this.group = mouseModel();
    this.group.position.copy(this.den);
    this.group.visible = false; // 巣穴の中
    game.scene.add(this.group);
    this.pos = this.group.position;
    this.state = 'den';
    this.timer = 25;
    this.trips = 0;
    this.tutorial = false;
    this.body = game.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.den.x, -5, this.den.z));
    game.physics.world.createCollider(R.ColliderDesc.cylinder(0.3, 0.42).setFriction(0.4), this.body);
    this.warnEl = null;
  }
  get active() { return this.game.mouseUnlocked(); }

  /** 次にいたずらするドミノ（建設済みで立っているもの） */
  chooseTarget() {
    const g = this.game;
    const sorted = g.course.allSlots.filter((s) => s.order >= 0 && s.domino && g.dominoes.isStandingAt(s.domino, s)).sort((a, b) => a.order - b.order);
    if (sorted.length < 12) return null;
    // 初回（チュートリアル）：建設の先頭の少し手前 → 倒れるのは数枚〜十数枚
    if (this.tutorial) { const f = g.frontSlot(); const fo = f ? f.order : sorted[sorted.length - 1].order; return sorted.filter((s) => s.order < fo - 6 && s.order > fo - 16).pop() || sorted[sorted.length - 8]; }
    return sorted[Math.floor(sorted.length * (0.2 + Math.random() * 0.75))];
  }

  update(dt) {
    const g = this.game;
    this.group.userData.key.rotation.y += dt * (this.state === 'den' ? 0 : 9);
    if (this.held) { this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 0.32, z: this.pos.z }); return; } // つかまれている間はじたばたするだけ
    if (g.mode !== 'build') { if (this.state === 'go' || this.state === 'warn') this.startReturn(); }
    switch (this.state) {
      case 'den':
        if (!this.active || g.mode !== 'build' || g.gachaActive) return;
        this.timer -= dt;
        if (this.timer <= 0) {
          this.target = this.chooseTarget();
          if (!this.target) { this.timer = 8; return; }
          this.tutorial = !g.flags.mouseTutorialDone;
          if (this.tutorial) this.target = this.chooseTarget();
          this.state = 'warn'; this.timer = 2.4;
          this.group.visible = true; this.pos.copy(this.den);
          g.audio.squeak(1.8); setTimeout(() => g.audio.squeak(2.1), 180);
          g.fx.floatAt(this.den.clone().setY(1.6), '🐭 チュー！ いたずらネズミが出てきた', 'warn', 2.4);
          g.onThreatWarn(this, this.target);
        }
        break;
      case 'warn':
        this.timer -= dt;
        this.group.position.y = Math.abs(Math.sin(this.timer * 14)) * 0.08;
        if (this.timer <= 0) { this.state = 'go'; this.goT = 0; }
        break;
      case 'go': {
        const t = this.target;
        if (!t || !t.domino || !g.dominoes.isStandingAt(t.domino, t)) { this.target = this.chooseTarget(); if (!this.target) { this.startReturn(); break; } }
        const s = this.target;
        // ドミノの横（列に直角な方向）から近づく
        const nx = Math.cos(s.yaw), nz = -Math.sin(s.yaw);
        const side = ((this.pos.x - s.x) * nx + (this.pos.z - s.z) * nz) >= 0 ? 1 : -1;
        const goal = this._g || (this._g = new THREE.Vector3());
        goal.set(s.x + nx * side * 0.55, 0, s.z + nz * side * 0.55);
        if (this.moveTo(goal, dt, 5.5)) {
          // ドミノを列の進む向きに押す（＝先へ連鎖する事故）
          const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
          g.dominoes.push(s.domino, fx, fz, 0.06);
          g.stats.mouseHits = (g.stats.mouseHits || 0) + 1;
          g.fx.floatAt(this.pos.clone().setY(1.4), 'えいっ！', 'warn', 1.0);
          g.onThreatHit(this, s);
          this.startReturn();
        }
        break;
      }
      case 'return':
        if (this.moveTo(this.den, dt, 6.5)) { this.state = 'den'; this.group.visible = false; this.body.setNextKinematicTranslation({ x: this.den.x, y: -5, z: this.den.z }); const [a, b] = this.def.interval || [55, 85]; this.timer = a + Math.random() * (b - a); this.trips++; }
        break;
    }
  }
  startReturn() { this.state = 'return'; this.target = null; }
  moveTo(p, dt, speed) {
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.15) return true;
    const st = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * st; this.pos.z += (dz / d) * st;
    this.group.rotation.y = Math.atan2(dx, dz);
    this.group.position.y = Math.abs(Math.sin(performance.now() * 0.03)) * 0.05;
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: 0.32, z: this.pos.z });
    return false;
  }
  describe() {
    const st = { den: '巣穴でひと休み', warn: '巣穴から顔を出した！', go: 'ドミノへ一直線！', return: '巣穴へ逃げ帰り中' }[this.state];
    const rows = [['行動', st], ['危険度', this.state === 'go' ? '中（1枚押して連鎖事故）' : '低']];
    if (this.state === 'den' && this.active) rows.push(['次に出てくる', `あと約 ${Math.max(0, Math.ceil(this.timer))} 秒`]);
    return { title: '🐭 いたずらネズミ（ゼンマイ式）', rows, note: '対策：先のドミノを1枚抜く／ストッパー設置係（自動）／自動事故防止チーム（先回りして隔離）', warn: this.state === 'go' };
  }
  dispose() { this.game.scene.remove(this.group); this.game.physics.world.removeRigidBody(this.body); }
}

function ballModel(r) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  const cols = ['#ff5a5f', '#ffd166', '#06d6a0', '#118ab2', '#ffffff', '#ff8fab'];
  for (let i = 0; i < 6; i++) { x.fillStyle = cols[i]; x.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 128); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.35, clearcoat: 0.6 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export class RollingBall {
  constructor(game, def) {
    this.game = game; this.def = def;
    this.r = def.radius || 1.3;
    this.group = new THREE.Group();
    this.mesh = ballModel(this.r); this.group.add(this.mesh);
    game.scene.add(this.group);
    this.body = game.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(def.rest.x, this.r, def.rest.z).setLinearDamping(0.35).setAngularDamping(0.4).setCanSleep(true));
    game.physics.world.createCollider(R.ColliderDesc.ball(this.r).setDensity(0.12).setRestitution(0.55).setFriction(0.6), this.body);
    this.state = 'rest';
    this.timer = def.firstDelay || 70;
    this.arrow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0, depthWrite: false }));
    this.arrow.rotation.x = -Math.PI / 2; game.scene.add(this.arrow);
    this.sync();
  }
  get pos() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  sync() { const t = this.body.translation(), q = this.body.rotation(); this.group.position.set(t.x, t.y, t.z); this.mesh.quaternion.set(q.x, q.y, q.z, q.w); }
  update(dt) {
    const g = this.game;
    this.sync();
    if (this.state === 'rest') {
      if (g.mode !== 'build' || g.gachaActive) return;
      this.timer -= dt;
      if (this.timer <= 0) {
        // 次に転がる向き：部屋の中央寄りの、ドミノの列を横切る向き
        const p = this.pos;
        const tgt = this.def.targets[Math.floor(Math.random() * this.def.targets.length)];
        this.dir = new THREE.Vector3(tgt[0] - p.x, 0, tgt[1] - p.z).normalize();
        this.state = 'warn'; this.timer = 2.2;
        g.fx.floatAt(p.clone().setY(this.r * 2 + 1), '⚽ ボールが転がってくる！', 'warn', 2.2);
        g.audio.squeak(0.8);
        g.onThreatWarn(this, null);
      }
    } else if (this.state === 'warn') {
      this.timer -= dt;
      const p = this.pos;
      const len = 14;
      this.arrow.scale.set(1.2, len, 1);
      this.arrow.position.set(p.x + this.dir.x * len / 2, 0.05, p.z + this.dir.z * len / 2);
      this.arrow.rotation.z = -Math.atan2(this.dir.x, this.dir.z);
      this.arrow.material.opacity = 0.25 + Math.abs(Math.sin(this.timer * 10)) * 0.3;
      // ちょっと揺れてから
      this.group.position.x += Math.sin(this.timer * 30) * 0.05;
      if (this.timer <= 0) {
        this.arrow.material.opacity = 0;
        const sp = this.def.speed || 13;
        this.body.wakeUp();
        this.body.setLinvel({ x: this.dir.x * sp, y: 0, z: this.dir.z * sp }, true);
        this.state = 'roll'; this.timer = 0;
        g.audio.bonk && g.audio.bonk();
      }
    } else if (this.state === 'roll') {
      this.timer += dt;
      const v = this.body.linvel();
      if ((Math.hypot(v.x, v.z) < 0.4 && this.timer > 1.5) || this.timer > 14) {
        this.state = 'rest'; const [a, b] = this.def.interval || [70, 100]; this.timer = a + Math.random() * (b - a);
      }
    }
  }
  describe() {
    const st = { rest: '床の上で止まっている', warn: '転がり出しそう！', roll: '転がっている！' }[this.state];
    const rows = [['行動', st], ['危険度', this.state === 'roll' ? '高（当たった所から連鎖事故）' : this.state === 'warn' ? '予告中' : '低']];
    if (this.state === 'rest' && this.game.mode === 'build') rows.push(['次に転がる', `あと約 ${Math.max(0, Math.ceil(this.timer))} 秒`]);
    return { title: '⚽ ゴムボール', rows, note: '短時間・局所的な脅威。予告の矢印の先のドミノを抜く／ストッパーで被害を区切る', warn: this.state !== 'rest' };
  }
  dispose() { this.game.scene.remove(this.group, this.arrow); this.game.physics.world.removeRigidBody(this.body); }
}
