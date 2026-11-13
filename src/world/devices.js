import * as THREE from 'three';
import { CFG } from '../config.js';
import { R } from '../core/physics.js';
import { MAT, rbox, shadow } from './props.js';

// ゴール装置・ポート付きピース（ミニカー/ビー玉/高架橋）・各種設備の見た目と物理。

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };

/** ローカル座標（yaw回転・原点 ox,oz）→ ワールド */
export function local(o, lx, lz) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  // ローカル +z = 進行方向 (sin yaw, cos yaw)、ローカル +x = (cos yaw, -sin yaw)
  return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c };
}

export function hingedPaddle(physics, pose, w, h, t, density = 0.3) {
  // 底辺を軸に前へ倒れる板（回転ジョイント）
  const base = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pose.x, pose.y || 0, pose.z).setRotation(physics.quatYaw(pose.yaw)));
  const body = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pose.x, (pose.y || 0) + h / 2 + 0.02, pose.z).setRotation(physics.quatYaw(pose.yaw)).setAngularDamping(0.4).setCanSleep(true));
  physics.world.createCollider(R.ColliderDesc.cuboid(w / 2, h / 2, t / 2).setDensity(density).setFriction(0.5), body);
  const jd = R.JointData.revolute({ x: 0, y: 0.02, z: 0 }, { x: 0, y: -h / 2, z: 0 }, { x: 1, y: 0, z: 0 });
  physics.world.createImpulseJoint(jd, base, body, true);
  body.sleep();
  return {
    body, base, pose, h,
    angle() { const r = body.rotation(); const up = 1 - 2 * (r.x * r.x + r.z * r.z); return Math.acos(Math.max(-1, Math.min(1, up))); },
    reset() {
      body.setTranslation({ x: pose.x, y: (pose.y || 0) + h / 2 + 0.02, z: pose.z }, true);
      body.setRotation(physics.quatYaw(pose.yaw), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.sleep();
    },
    sync(m) { const p = body.translation(), r = body.rotation(); m.position.set(p.x, p.y, p.z); m.quaternion.set(r.x, r.y, r.z, r.w); },
    dispose() { physics.world.removeRigidBody(body); physics.world.removeRigidBody(base); },
  };
}

// ======================= ゴール：ステージ1 ベル =======================
export class GoalBell {
  constructor(scene, physics, g) {
    this.scene = scene; this.physics = physics; this.port = g;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.paddle = hingedPaddle(physics, { x: g.x, z: g.z, yaw: g.yaw }, 1.1, 1.5, 0.14);
    this.paddleMesh = mesh(rbox(1.1, 1.5, 0.14, 0.05), MAT.plastic('#ff4d6d'));
    this.paddleMesh.castShadow = true;
    scene.add(this.paddleMesh);
    // ベル塔（パドルの後ろ）
    const tower = new THREE.Group();
    const wm = MAT.wood('#d9a066');
    tower.add(mesh(rbox(5, 0.6, 3, 0.2), wm, 0, 0.3, 0));
    for (const sx of [-1, 1]) tower.add(mesh(rbox(0.5, 7, 0.5, 0.15), wm, sx * 2, 3.8, 0));
    tower.add(mesh(rbox(5, 0.5, 0.8, 0.15), wm, 0, 7.4, 0));
    this.bell = new THREE.Group();
    const bellMesh = mesh(new THREE.CylinderGeometry(0.6, 1.6, 2.2, 28, 1, true), MAT.metal('#f2c14e'), 0, -1.4, 0);
    bellMesh.material.side = THREE.DoubleSide;
    this.bell.add(bellMesh, mesh(new THREE.SphereGeometry(0.6, 16, 10), MAT.metal('#f2c14e'), 0, -0.4, 0), mesh(new THREE.SphereGeometry(0.35, 12, 8), MAT.metal('#8a6d1f'), 0, -2.5, 0));
    this.bell.position.set(0, 7.1, 0);
    tower.add(this.bell);
    // ひも
    tower.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.5, 6), MAT.matte('#c92a2a'), 0, 3.6, -1.2));
    const flag = mesh(new THREE.PlaneGeometry(3, 1.4), new THREE.MeshStandardMaterial({ color: '#ff4d6d', side: THREE.DoubleSide }), 0, 9.2, 0);
    tower.add(flag, mesh(new THREE.CylinderGeometry(0.08, 0.08, 3, 8), MAT.metal(), -1.5, 8.6, 0));
    const p = local(g, 0, 2.6);
    tower.position.set(p.x, 0, p.z);
    tower.rotation.y = g.yaw;
    shadow(tower);
    this.group.add(tower);
    this.tower = tower;
    this.triggered = false;
    this.ringT = 0;
  }
  update(dt) {
    this.paddle.sync(this.paddleMesh);
    if (!this.triggered && this.paddle.angle() > 0.45) { this.triggered = true; this.ringT = 0; if (this.onTrigger) this.onTrigger(); }
    if (this.triggered) { this.ringT += dt; this.bell.rotation.x = Math.sin(this.ringT * 9) * 0.5 * Math.exp(-this.ringT * 0.3); }
  }
  focus() { return this.tower.position; }
  reset() { this.paddle.reset(); this.triggered = false; this.bell.rotation.x = 0; }
  dispose() { this.paddle.dispose(); this.scene.remove(this.group); this.scene.remove(this.paddleMesh); }
}

// ======================= ポート付きピース =======================
// in: 入口（ここへ向かって連鎖が来る）、out: 出口（ここから線を引ける）
export class LauncherPiece {
  /** type: 'minicar' | 'marble' */
  constructor(scene, physics, type, pose, id) {
    this.scene = scene; this.physics = physics; this.type = type; this.id = id;
    this.x = pose.x; this.z = pose.z; this.yaw = pose.yaw;
    this.len = type === 'minicar' ? 11 : 12;
    const o = this;
    this.in = { x: o.x, z: o.z, yaw: o.yaw };
    const op = local(o, 0, this.len + 0.6);
    this.out = { x: op.x, z: op.z, yaw: o.yaw };
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cols = [];
    this.slots = [];
    this.footprint = { x: local(o, 0, this.len / 2).x, z: local(o, 0, this.len / 2).z, hw: 1.4, hd: this.len / 2 + 0.2, yaw: o.yaw };
    const box = (lx, ly, lz, hx, hy, hz, pitch, mat) => {
      const p = local(o, lx, lz);
      this.cols.push(physics.staticBox(p.x, ly, p.z, hx, hy, hz, o.yaw, type === 'minicar' ? 0.05 : 0.3, pitch));
      const m = mesh(rbox(hx * 2, hy * 2, hz * 2, 0.05, 2), mat, p.x, ly, p.z);
      tmpE.set(pitch, o.yaw, 0, 'YXZ'); m.quaternion.setFromEuler(tmpE);
      shadow(m); this.group.add(m);
    };
    // トリガー板（入口の連鎖が倒すと発射）
    this.trigger = hingedPaddle(physics, { x: o.x, z: o.z, yaw: o.yaw }, 0.9, 1.1, 0.1, 0.25);
    this.trigMesh = mesh(rbox(0.9, 1.1, 0.1, 0.03), MAT.plastic('#ffd21f')); this.trigMesh.castShadow = true; scene.add(this.trigMesh);
    if (type === 'minicar') {
      for (const sx of [-1, 1]) box(sx * 0.8, 0.2, this.len / 2 + 0.6, 0.08, 0.2, this.len / 2 - 0.4, 0, MAT.plastic('#ff922b'));
      box(0, 0.02, this.len / 2 + 0.6, 0.72, 0.02, this.len / 2 - 0.4, 0, MAT.plastic('#495057'));
      this.carStart = local(o, 0, 1.6);
      this.car = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(this.carStart.x, 0.4, this.carStart.z).setRotation(physics.quatYaw(o.yaw)).setCcdEnabled(true).setLinearDamping(0.02));
      physics.world.createCollider(R.ColliderDesc.cuboid(0.45, 0.3, 0.75).setDensity(1.5).setFriction(0.02), this.car);
      // 前の高い位置のバンパー（ドミノの上の方を押して倒す）
      physics.world.createCollider(R.ColliderDesc.cuboid(0.4, 0.12, 0.05).setTranslation(0, 0.6, 1.05).setDensity(0.5).setFriction(0.3), this.car);
      this.car.sleep();
      const cm = new THREE.Group();
      cm.add(mesh(rbox(0.9, 0.4, 1.5, 0.15), MAT.plastic('#e8233f'), 0, -0.05, 0));
      cm.add(mesh(rbox(0.75, 0.3, 0.7, 0.12), MAT.plastic('#9be3ff'), 0, 0.28, -0.1));
      cm.add(mesh(rbox(0.8, 0.24, 0.1, 0.04), MAT.plastic('#ffd21f'), 0, 0.6, 1.05));
      for (const sx of [-0.3, 0.3]) { const rod = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), MAT.metal(), sx, 0.45, 0.85); rod.rotation.x = 0.9; cm.add(rod); }
      const wg = new THREE.CylinderGeometry(0.2, 0.2, 0.15, 14); wg.rotateZ(Math.PI / 2);
      for (const [x, z] of [[-0.45, 0.45], [0.45, 0.45], [-0.45, -0.45], [0.45, -0.45]]) cm.add(mesh(wg, MAT.matte('#222'), x, -0.2, z));
      shadow(cm); this.scene.add(cm); this.carMesh = cm;
    } else {
      // ビー玉：高い台から坂を下る
      const topH = 2.2;
      box(0, topH / 2, 1.6, 0.9, topH / 2, 0.7, 0, MAT.wood('#d9a066'));
      const endH = 0.55;
      const slope = Math.atan2(topH - endH, 7.5);
      box(0, (topH + endH) / 2 - 0.08, 2.3 + 3.75, 0.6, 0.06, 3.85, slope, MAT.plastic('#69db7c'));
      for (const sx of [-1, 1]) box(sx * 0.66, (topH + endH) / 2 + 0.25, 2.3 + 3.75, 0.06, 0.25, 3.85, slope, MAT.plastic('#ffffff'));
      // 終点の台（ビー玉がドミノの上の方に当たる高さ）
      box(0, endH / 2, 11.0, 0.6, endH / 2, 1.2, 0, MAT.wood('#d9a066'));
      for (const sx of [-1, 1]) box(sx * 0.66, endH + 0.2, 11.0, 0.06, 0.2, 1.2, 0, MAT.plastic('#ffffff'));
      this.marbleStart = local(o, 0, 1.6);
      this.marbleY = topH + 0.42;
      // 発射前のストッパー（トリガーで外れる）
      const gp = local(o, 0, 2.35);
      this.gate = physics.staticBox(gp.x, topH + 0.4, gp.z, 0.6, 0.4, 0.05, o.yaw);
      this.gateMesh = mesh(rbox(1.2, 0.8, 0.1, 0.04), MAT.plastic('#ff4d4d'), gp.x, topH + 0.4, gp.z); this.gateMesh.rotation.y = o.yaw; this.group.add(this.gateMesh);
      this.ball = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(this.marbleStart.x, this.marbleY, this.marbleStart.z).setCcdEnabled(true));
      physics.world.createCollider(R.ColliderDesc.ball(0.4).setDensity(3).setFriction(0.3).setRestitution(0.15), this.ball);
      this.ball.sleep();
      this.ballMesh = mesh(new THREE.SphereGeometry(0.4, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#ff6bcb', roughness: 0.02, transmission: 0.5, thickness: 0.8, clearcoat: 1 }));
      this.ballMesh.castShadow = true; scene.add(this.ballMesh);
    }
    this.fired = false;
    // 台の看板
    const plate = mesh(rbox(1.6, 0.12, 0.8, 0.05), MAT.plastic(type === 'minicar' ? '#ff922b' : '#69db7c'), 0, 0.06, 0);
    const pp = local(o, 1.4, 0.2); plate.position.set(pp.x, 0.06, pp.z); plate.rotation.y = o.yaw; this.group.add(plate);
  }
  update() {
    this.trigger.sync(this.trigMesh);
    if (!this.fired && this.trigger.angle() > 0.35) this.fire();
    if (this.car) { const p = this.car.translation(), r = this.car.rotation(); this.carMesh.position.set(p.x, p.y, p.z); this.carMesh.quaternion.set(r.x, r.y, r.z, r.w); }
    if (this.ball) { const p = this.ball.translation(), r = this.ball.rotation(); this.ballMesh.position.set(p.x, p.y, p.z); this.ballMesh.quaternion.set(r.x, r.y, r.z, r.w); }
  }
  /** 発射（トリガー板が物理的に倒れたら呼ばれる） */
  fire() {
    this.fired = true;
    if (this.car) {
      // ばねの解放：ここだけ近似（初速を与える）。以降の走行と衝突は物理
      this.car.wakeUp();
      this.car.applyImpulse({ x: Math.sin(this.yaw) * 9, y: 0, z: Math.cos(this.yaw) * 9 }, true);
    } else {
      this.gate && this.gate.setEnabled(false);
      this.gateMesh.visible = false;
      this.ball.wakeUp();
      this.ball.applyImpulse({ x: Math.sin(this.yaw) * 0.6, y: 0, z: Math.cos(this.yaw) * 0.6 }, true);
    }
    if (this.onFire) this.onFire(this);
  }
  movingPos() { return this.car ? this.carMesh.position : this.ballMesh.position; }
  isMoving() {
    const b = this.car || this.ball;
    if (!this.fired || b.isSleeping()) return false;
    const v = b.linvel(); return v.x * v.x + v.z * v.z > 0.3;
  }
  reset() {
    this.trigger.reset();
    this.fired = false;
    if (this.car) {
      this.car.setTranslation({ x: this.carStart.x, y: 0.4, z: this.carStart.z }, true); this.car.setRotation(this.physics.quatYaw(this.yaw), true);
      this.car.setLinvel({ x: 0, y: 0, z: 0 }, true); this.car.setAngvel({ x: 0, y: 0, z: 0 }, true); this.car.sleep();
    } else {
      this.gate.setEnabled(true); this.gateMesh.visible = true;
      this.ball.setTranslation({ x: this.marbleStart.x, y: this.marbleY, z: this.marbleStart.z }, true);
      this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true); this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true); this.ball.sleep();
    }
  }
  dispose() {
    this.trigger.dispose();
    for (const c of this.cols) this.physics.remove(c);
    if (this.gate) this.physics.remove(this.gate);
    if (this.car) { this.physics.world.removeRigidBody(this.car); this.scene.remove(this.carMesh); }
    if (this.ball) { this.physics.world.removeRigidBody(this.ball); this.scene.remove(this.ballMesh); }
    this.scene.remove(this.group, this.trigMesh);
  }
}

/** 高架橋：小さな段差の階段で上り、デッキを渡り、下りる。デッキの下をルンバが通れる */
export class BridgePiece {
  constructor(scene, physics, pose, id) {
    this.scene = scene; this.physics = physics; this.type = 'bridge'; this.id = id;
    this.x = pose.x; this.z = pose.z; this.yaw = pose.yaw;
    const step = CFG.spacing, rise = 0.075, nUp = 22, deckN = 14;
    this.deckH = rise * nUp;
    const o = this;
    this.group = new THREE.Group(); scene.add(this.group);
    this.cols = [];
    this.slots = [];
    const wood = MAT.wood('#d9a066'), deckMat = MAT.plastic('#4dabf7');
    const addStep = (lz, h, mat) => {
      const p = local(o, 0, lz);
      this.cols.push(physics.staticBox(p.x, h / 2, p.z, 0.75, h / 2, step / 2, o.yaw, 0.6));
      const m = mesh(rbox(1.5, h, step, 0.03, 1), mat, p.x, h / 2, p.z); m.rotation.y = o.yaw; m.castShadow = m.receiveShadow = true; this.group.add(m);
    };
    let lz = 0;
    const total = nUp * 2 + deckN;
    for (let i = 0; i < total; i++) {
      let h;
      if (i < nUp) h = rise * (i + 1);
      else if (i < nUp + deckN) h = this.deckH;
      else h = rise * (total - i);
      lz = i * step + 0.1;
      const isDeck = i >= nUp && i < nUp + deckN;
      if (isDeck) {
        // デッキは薄い板（下をくぐれる）
        const p = local(o, 0, lz);
        this.cols.push(physics.staticBox(p.x, h - 0.1, p.z, 0.75, 0.1, step / 2, o.yaw, 0.6));
        const m = mesh(rbox(1.5, 0.2, step + 0.01, 0.03, 1), deckMat, p.x, h - 0.1, p.z); m.rotation.y = o.yaw; m.castShadow = m.receiveShadow = true; this.group.add(m);
      } else addStep(lz, h, wood);
      const sp = local(o, 0, lz);
      this.slots.push({ piece: this, i, x: sp.x, y: h, z: sp.z, yaw: o.yaw, pitch: 0, domino: null, claim: 0, kind: 'normal', order: -1, warn: false });
    }
    // 手すりと橋脚（デッキ両端）
    const s0 = nUp * step + 0.1, s1 = (nUp + deckN - 1) * step + 0.1;
    for (const lzp of [s0 - 0.3, s1 + 0.3]) for (const sx of [-1, 1]) {
      const p = local(o, sx * 0.9, lzp);
      const m = mesh(rbox(0.25, this.deckH + 1.2, 0.25, 0.05), MAT.plastic('#ffd21f'), p.x, (this.deckH + 1.2) / 2, p.z); m.castShadow = true; this.group.add(m);
    }
    for (const sx of [-1, 1]) {
      const p = local(o, sx * 0.9, (s0 + s1) / 2);
      const m = mesh(rbox(0.12, 0.12, s1 - s0 + 0.6, 0.04), MAT.plastic('#ffd21f'), p.x, this.deckH + 1.1, p.z); m.rotation.y = o.yaw; this.group.add(m);
    }
    this.len = lz + 0.1;
    this.in = { x: o.x, z: o.z, yaw: o.yaw };
    const op = local(o, 0, this.len + 0.5);
    this.out = { x: op.x, z: op.z, yaw: o.yaw };
    const c = local(o, 0, this.len / 2);
    this.footprint = { x: c.x, z: c.z, hw: 1.1, hd: this.len / 2, yaw: o.yaw };
    // ルンバにとっての障害物は「上り・下りの階段部分」だけ（デッキの下は通れる）
    const r1 = local(o, 0, (nUp * step) / 2 - 0.2), r2 = local(o, 0, this.len - (nUp * step) / 2 + 0.2);
    this.roombaBlocks = [
      { x: r1.x, z: r1.z, hw: 1.0, hd: (nUp * step) / 2, yaw: o.yaw },
      { x: r2.x, z: r2.z, hw: 1.0, hd: (nUp * step) / 2, yaw: o.yaw },
    ];
    this.underDeck = { x: c.x, z: c.z, hw: 1.0, hd: (deckN * step) / 2, yaw: o.yaw, h: this.deckH };
  }
  update() {}
  reset() {}
  dispose() { for (const c of this.cols) this.physics.remove(c); this.scene.remove(this.group); }
}

// ======================= ストッパー =======================
const stopperGeo = rbox(0.75, 0.6, 0.12, 0.04);
const stopperMat = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  for (let i = -2; i < 10; i++) { x.fillStyle = i % 2 ? '#ffd21f' : '#222'; x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16 + 48, 64); x.lineTo(i * 16 + 32, 64); x.fill(); }
  x.fillStyle = '#1f6fe0'; x.beginPath(); x.arc(64, 32, 18, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('S', 64, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
})();
const gateMat = new THREE.MeshStandardMaterial({ color: '#2fb36b', roughness: 0.4, emissive: '#0d4d2a', emissiveIntensity: 0.4 });

export class Stopper {
  constructor(scene, physics, slot, next, opts = {}) {
    this.scene = scene; this.physics = physics; this.slot = slot; this.next = next;
    this.x = (slot.x + next.x) / 2; this.z = (slot.z + next.z) / 2;
    this.y = Math.max(slot.y || 0, next.y || 0);
    this.yaw = Math.atan2(next.x - slot.x, next.z - slot.z);
    this.collider = physics.staticBox(this.x, this.y + 0.3, this.z, 0.37, 0.3, 0.05, this.yaw);
    this.mesh = new THREE.Mesh(stopperGeo, opts.gate ? gateMat : stopperMat);
    this.mesh.position.set(this.x, this.y + 0.3, this.z);
    this.mesh.rotation.y = this.yaw;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this.armed = true;
    this.locked = false; // プレイヤーが「本番でも外さない」に設定
    this.gate = !!opts.gate;
    this.emergency = !!opts.emergency;
    this.lift = 0;
    this.lockMesh = null;
  }
  setGate(g) { this.gate = g; this.mesh.material = g ? gateMat : stopperMat; }
  setLocked(l) {
    this.locked = l;
    if (l && !this.lockMesh) {
      this.lockMesh = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 6, 12), new THREE.MeshStandardMaterial({ color: '#e03131', emissive: '#e03131', emissiveIntensity: 0.6 }));
      this.lockMesh.position.set(this.x, this.y + 0.85, this.z);
      this.scene.add(this.lockMesh);
    } else if (!l && this.lockMesh) { this.scene.remove(this.lockMesh); this.lockMesh = null; }
  }
  release() { if (!this.armed || this.locked) return false; this.armed = false; this.collider.setEnabled(false); return true; }
  arm() { this.armed = true; this.collider.setEnabled(true); }
  update(dt) {
    const target = this.armed ? 0 : 1;
    this.lift += (target - this.lift) * Math.min(1, dt * 6);
    this.mesh.position.y = this.y + 0.3 + this.lift * 1.6;
    this.mesh.rotation.z = this.lift * 0.6;
    this.mesh.visible = this.lift < 0.98;
  }
  dispose() { this.physics.remove(this.collider); this.scene.remove(this.mesh); if (this.lockMesh) this.scene.remove(this.lockMesh); }
}

// ======================= 小物：バリケード・センサー・ベル・宝箱・ガチャマシン・印・塔・本部 =======================
export function barricadeMesh() {
  const g = new THREE.Group();
  const leg = MAT.plastic('#ff922b');
  g.add(mesh(rbox(5, 0.5, 0.3, 0.1), stopperMat, 0, 1.3, 0));
  g.add(mesh(rbox(5, 0.5, 0.3, 0.1), stopperMat, 0, 0.6, 0));
  for (const sx of [-1, 1]) g.add(mesh(rbox(0.3, 1.8, 0.8, 0.1), leg, sx * 2.2, 0.9, 0));
  return shadow(g);
}
export function sensorMesh() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.25, 2.6, 10), MAT.metal('#adb5bd'), 0, 1.3, 0));
  const dish = mesh(new THREE.SphereGeometry(0.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.plastic('#e9ecef'), 0, 2.7, 0);
  dish.rotation.x = Math.PI / 2.4; g.add(dish);
  const led = mesh(new THREE.SphereGeometry(0.18, 10, 8), MAT.glow('#3cff8a'), 0, 3.0, 0); g.add(led);
  g.userData.led = led;
  g.add(mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 16), MAT.plastic('#1f6fe0'), 0, 0.1, 0));
  return shadow(g);
}
export function bellPieceMesh() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8), MAT.metal(), 0, 1.1, 0));
  const b = new THREE.Group();
  b.add(mesh(new THREE.CylinderGeometry(0.25, 0.6, 0.8, 18, 1, true), Object.assign(MAT.metal('#f2c14e'), { side: THREE.DoubleSide }), 0, -0.4, 0));
  b.position.y = 2.3; g.add(b); g.userData.bell = b;
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 14), MAT.wood('#c98c55'), 0, 0.1, 0));
  return shadow(g);
}
export function chestMesh(big = false) {
  const g = new THREE.Group();
  const s = big ? 1.6 : 1;
  const wood = MAT.wood('#a86b35'), gold = MAT.metal('#f2c14e');
  g.add(mesh(rbox(3 * s, 1.8 * s, 2 * s, 0.15), wood, 0, 0.9 * s, 0));
  const lid = new THREE.Group();
  lid.add(mesh(new THREE.CylinderGeometry(1 * s, 1 * s, 3 * s, 16, 1, false, 0, Math.PI), wood, 0, 0, 0));
  lid.children[0].rotation.z = Math.PI / 2;
  lid.add(mesh(rbox(3.1 * s, 0.25 * s, 0.3 * s, 0.05), gold, 0, 0.9 * s, 0));
  lid.position.set(0, 1.8 * s, -1 * s);
  lid.children.forEach((c) => (c.position.z += 1 * s));
  g.add(lid); g.userData.lid = lid;
  for (const sx of [-1, 1]) g.add(mesh(rbox(0.3 * s, 1.85 * s, 2.05 * s, 0.05), gold, sx * 1.2 * s, 0.9 * s, 0));
  g.add(mesh(rbox(0.5 * s, 0.6 * s, 0.2 * s, 0.05), gold, 0, 1.4 * s, 1.02 * s));
  const glow = mesh(new THREE.SphereGeometry(1.2 * s, 16, 10), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0 }), 0, 2 * s, 0);
  g.add(glow); g.userData.glow = glow;
  return shadow(g);
}
export function gachaMachineMesh(color = '#ff6b6b') {
  const g = new THREE.Group();
  g.add(mesh(rbox(3, 3.2, 3, 0.3), MAT.plastic(color), 0, 1.6, 0));
  g.add(mesh(new THREE.SphereGeometry(1.8, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0.85, thickness: 0.3 }), 0, 4.6, 0));
  const cols = ['#ffd43b', '#4dabf7', '#ff6b6b', '#69db7c', '#b197fc'];
  for (let i = 0; i < 9; i++) g.add(mesh(new THREE.SphereGeometry(0.42, 12, 8), MAT.plastic(cols[i % 5]), (Math.random() - 0.5) * 1.8, 3.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.8));
  const handle = mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 16), MAT.metal('#e9ecef'), 0, 1.9, 1.55); g.add(handle); g.userData.handle = handle;
  g.add(mesh(rbox(0.9, 0.7, 0.3, 0.1), MAT.matte('#222'), 0, 0.8, 1.5));
  // レバー（ドミノが倒すと回る）
  return shadow(g);
}
export function markerMesh(type) {
  const g = new THREE.Group();
  const col = type === 'present' ? '#ffcf3a' : type === 'clover' ? '#3fd16b' : '#9be3ff';
  const ring = mesh(new THREE.RingGeometry(0.9, 1.2, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide }), 0, 0.03, 0);
  ring.rotation.x = -Math.PI / 2; g.add(ring);
  if (type === 'present') {
    const box = mesh(rbox(0.9, 0.9, 0.9, 0.08), MAT.plastic('#ffcf3a'), 0, 1.4, 0);
    box.add(mesh(rbox(0.95, 0.2, 0.95, 0.04), MAT.plastic('#e8233f'), 0, 0, 0));
    box.add(mesh(rbox(0.2, 0.95, 0.95, 0.04), MAT.plastic('#e8233f'), 0, 0, 0));
    g.add(box); g.userData.spin = box;
  } else if (type === 'clover') {
    const c = new THREE.Group();
    for (let i = 0; i < 4; i++) { const l = mesh(new THREE.SphereGeometry(0.32, 12, 8), MAT.plastic('#3fd16b'), Math.cos(i * Math.PI / 2) * 0.32, 0, Math.sin(i * Math.PI / 2) * 0.32); l.scale.y = 0.3; c.add(l); }
    c.position.y = 1.3; c.rotation.x = Math.PI / 2.5; g.add(c); g.userData.spin = c;
  }
  return g;
}
export function orbMesh() {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), new THREE.MeshStandardMaterial({ color: '#7fe3ff', emissive: '#39b8ff', emissiveIntensity: 1.4, roughness: 0.2 }));
  return m;
}
export function towerMesh() {
  const g = new THREE.Group();
  const wm = MAT.wood('#b8814f');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(rbox(0.3, 6, 0.3, 0.05), wm, sx * 0.9, 3, sz * 0.9));
  g.add(mesh(rbox(2.6, 0.3, 2.6, 0.08), wm, 0, 6, 0));
  g.add(mesh(new THREE.ConeGeometry(2, 1.4, 4), MAT.plastic('#1f6fe0'), 0, 8.4, 0));
  for (const sx of [-1, 1]) g.add(mesh(rbox(0.12, 1.6, 0.12, 0.03), wm, sx * 1.2, 7, 1.2));
  const siren = mesh(new THREE.SphereGeometry(0.35, 12, 8), MAT.glow('#ff3b3b'), 0, 9.3, 0); g.add(siren); g.userData.siren = siren;
  return shadow(g);
}
export function hqMesh() {
  const g = new THREE.Group();
  g.add(mesh(rbox(9, 6, 7, 0.4), MAT.plastic('#1f6fe0'), 0, 3, 0));
  g.add(mesh(rbox(9.6, 0.8, 7.6, 0.2), MAT.plastic('#ffffff'), 0, 6.3, 0));
  g.add(mesh(rbox(3, 3, 0.3, 0.1), MAT.matte('#ffd21f'), 0, 2, 3.55));
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#1f6fe0'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.fillText('STOPPERS HQ', 128, 46);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  g.add(mesh(new THREE.PlaneGeometry(7, 1.7), new THREE.MeshBasicMaterial({ map: t }), 0, 5.1, 3.52));
  const siren = mesh(new THREE.SphereGeometry(0.5, 12, 8), MAT.glow('#ff3b3b'), 0, 7.2, 0); g.add(siren); g.userData.siren = siren;
  const ant = mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), MAT.metal(), 3.5, 8.5, -2.5); g.add(ant);
  return shadow(g);
}
export function startPadMesh() {
  const g = new THREE.Group();
  g.add(mesh(rbox(3, 0.4, 3, 0.15), MAT.wood('#e8c59a'), 0, 0.2, -1.6));
  const arm = new THREE.Group();
  arm.add(mesh(rbox(0.25, 0.25, 1.6, 0.05), MAT.metal(), 0, 0, -0.8));
  const glove = mesh(new THREE.SphereGeometry(0.42, 16, 12), MAT.plastic('#e8233f'), 0, 0, 0.1); glove.scale.set(1, 0.9, 1.1); arm.add(glove);
  arm.position.set(0, 0.85, -1.8);
  g.add(arm); g.userData.arm = arm;
  g.add(mesh(rbox(1.2, 1.2, 0.9, 0.1), MAT.plastic('#1f6fe0'), 0, 1, -2.6));
  const btn = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16), MAT.glow('#ff3b3b'), 0, 1.7, -2.6); g.add(btn);
  return shadow(g);
}
export function piggyMesh() {
  const g = new THREE.Group();
  const pink = MAT.plastic('#ff9ec4');
  const body = mesh(new THREE.SphereGeometry(1.2, 24, 18), pink, 0, 1.3, 0); body.scale.set(1.25, 1, 1); g.add(body);
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.4, 16), pink, 1.5, 1.4, 0).rotateZ(Math.PI / 2));
  for (const [x, z] of [[-0.7, 0.6], [0.7, 0.6], [-0.7, -0.6], [0.7, -0.6]]) g.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 10), pink, x, 0.3, z));
  for (const z of [-0.5, 0.5]) g.add(mesh(new THREE.ConeGeometry(0.3, 0.5, 8), pink, 0.8, 2.3, z));
  g.add(mesh(rbox(0.8, 0.08, 0.2, 0.03), MAT.matte('#333'), 0, 2.31, 0));
  g.userData.body = body;
  return shadow(g);
}
export function trainMesh() {
  const g = new THREE.Group();
  const loco = new THREE.Group();
  loco.add(mesh(rbox(1.6, 1.4, 3, 0.2), MAT.plastic('#e8233f'), 0, 1.1, 0));
  loco.add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 2, 16), MAT.plastic('#222'), 0, 1.6, 0.5).rotateX(Math.PI / 2));
  loco.add(mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 10), MAT.plastic('#222'), 0, 2.4, 1.1));
  loco.add(mesh(rbox(1.6, 1.4, 1, 0.2), MAT.plastic('#1fa8ff'), 0, 2, -1));
  g.add(loco);
  const wg = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 14); wg.rotateZ(Math.PI / 2);
  for (const z of [-1, 0.2, 1.2]) for (const sx of [-1, 1]) g.add(mesh(wg, MAT.matte('#333'), sx * 0.85, 0.4, z));
  const car = new THREE.Group();
  car.add(mesh(rbox(1.6, 0.9, 2.4, 0.2), MAT.plastic('#ffd21f'), 0, 0.8, 0));
  car.position.z = -3.2; g.add(car);
  const cargo = new THREE.Group(); car.add(cargo); g.userData.cargo = cargo;
  const cols = ['#ff3b3b', '#1fa8ff', '#3ccf5a', '#ff8a1f'];
  for (let i = 0; i < 12; i++) cargo.add(mesh(rbox(0.25, 0.5, 0.08, 0.02, 1), MAT.plastic(cols[i % 4]), -0.5 + (i % 4) * 0.33, 1.5, -0.8 + Math.floor(i / 4) * 0.8));
  return shadow(g);
}
