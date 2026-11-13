import * as THREE from 'three';
import { R } from '../core/physics.js';
import { MAT, rbox, shadow } from './props.js';
import { local, hingedPaddle } from './devices.js';

const tmpE = new THREE.Euler();
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };

/**
 * ステージ2のゴール「巨大からくり装置」。すべて物理で伝わる：
 * 最終ドミノ → だんだん大きくなる巨大ドミノ3枚 → レバー（倒れるとビー玉のゲートが外れる）
 * → ビー玉が坂を転がる → 吊るした振り子を打つ → ベルが鳴り、巨大な旗が上がる
 * （近似：ゲートが外れる瞬間と、ベル・旗の動きはアニメーション）
 */
export class GoalMachine {
  constructor(scene, physics, g) {
    this.scene = scene; this.physics = physics; this.port = g;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cols = [];
    const yaw = g.yaw;
    const box = (lx, ly, lz, hx, hy, hz, pitch = 0, mat = MAT.wood('#c98c55')) => {
      const p = local(g, lx, lz);
      this.cols.push(physics.staticBox(p.x, ly, p.z, hx, hy, hz, yaw, 0.35, pitch));
      const m = mesh(rbox(hx * 2, hy * 2, hz * 2, 0.05, 2), mat, p.x, ly, p.z);
      tmpE.set(pitch, yaw, 0, 'YXZ'); m.quaternion.setFromEuler(tmpE);
      shadow(m); this.group.add(m);
    };
    // 1) 巨大ドミノ（1.4倍 → 1.9倍 → 2.5倍）
    const G = [[0.7, 1.4, 0.2, 0.12, '#ff3b3b'], [0.9, 1.9, 0.26, 0.98, '#ffd21f'], [1.1, 2.5, 0.32, 2.14, '#1fa8ff']];
    this.giants = G.map(([w, h, t, z, col]) => {
      const p = local(g, 0, z);
      const b = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, h / 2 + 0.002, p.z).setRotation(physics.quatYaw(yaw)).setCanSleep(true).setAngularDamping(0.2));
      physics.world.createCollider(R.ColliderDesc.roundCuboid(w / 2 - 0.03, h / 2 - 0.03, t / 2 - 0.03, 0.03).setDensity(0.7).setFriction(0.45), b);
      b.sleep();
      const m = mesh(rbox(w, h, t, 0.05), MAT.plastic(col)); m.castShadow = true; scene.add(m);
      return { b, m, p, h };
    });
    // 2) レバー
    const lp = local(g, 0, 3.75);
    this.p1 = hingedPaddle(physics, { x: lp.x, z: lp.z, yaw }, 1.3, 2.2, 0.16, 0.4);
    this.p1Mesh = mesh(rbox(1.3, 2.2, 0.16, 0.05), MAT.plastic('#ff8a1f')); this.p1Mesh.castShadow = true; scene.add(this.p1Mesh);
    // 3) ビー玉の台・ゲート・坂
    const topH = 2.6;
    box(0, topH / 2, 4.95, 0.9, topH / 2, 0.55, 0.03, MAT.wood('#d9a066'));
    const slope = Math.atan2(topH - 0.25, 8.2);
    box(0, topH / 2 + 0.06 - 0.12, 5.5 + 4.1, 0.7, 0.08, 4.15, slope, MAT.plastic('#4dabf7'));
    for (const sx of [-1, 1]) box(sx * 0.78, topH / 2 + 0.3, 5.5 + 4.1, 0.07, 0.3, 4.15, slope, MAT.plastic('#ffffff'));
    for (const sx of [-1, 1]) box(sx * 0.78, 0.25, 15.5, 0.07, 0.25, 1.9, 0, MAT.plastic('#ffffff'));
    box(0, 0.5, 18.2, 0.9, 0.5, 0.12, 0, MAT.plastic('#ffffff')); // 受け止め板
    const gp = local(g, 0, 5.55);
    this.gate = physics.staticBox(gp.x, topH + 0.45, gp.z, 0.7, 0.45, 0.05, yaw);
    this.gateMesh = mesh(rbox(1.4, 0.9, 0.1, 0.03), MAT.plastic('#ff4d4d'), gp.x, topH + 0.45, gp.z); this.gateMesh.rotation.y = yaw; this.group.add(this.gateMesh);
    this.marblePose = local(g, 0, 5.0);
    this.marbleY = topH + 0.47;
    this.marble = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(this.marblePose.x, this.marbleY, this.marblePose.z).setCcdEnabled(true).setAngularDamping(0.02));
    physics.world.createCollider(R.ColliderDesc.ball(0.45).setDensity(3).setFriction(0.3).setRestitution(0.15), this.marble);
    this.marble.sleep();
    this.marbleMesh = mesh(new THREE.SphereGeometry(0.45, 28, 20), new THREE.MeshPhysicalMaterial({ color: '#59c3ff', roughness: 0.02, transmission: 0.6, thickness: 0.9, ior: 1.5, clearcoat: 1 }));
    this.marbleMesh.castShadow = true; scene.add(this.marbleMesh);
    // 4) 吊るした振り子
    const pz = 16.4, pivotY = 4.4, rod = 3.9;
    const pp = local(g, 0, pz);
    this.pivotPose = { x: pp.x, z: pp.z, y: pivotY, rod };
    this.pivot = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pp.x, pivotY, pp.z).setRotation(physics.quatYaw(yaw)));
    this.pend = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pp.x, pivotY - rod / 2, pp.z).setRotation(physics.quatYaw(yaw)).setAngularDamping(0.1).setCanSleep(true));
    physics.world.createCollider(R.ColliderDesc.cuboid(0.08, rod / 2, 0.08).setDensity(0.3), this.pend);
    physics.world.createCollider(R.ColliderDesc.ball(0.55).setTranslation(0, -rod / 2 + 0.1, 0).setDensity(0.5), this.pend);
    physics.world.createImpulseJoint(R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: rod / 2, z: 0 }, { x: 1, y: 0, z: 0 }), this.pivot, this.pend, true);
    this.pend.sleep();
    const pm = new THREE.Group();
    pm.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, rod, 8), MAT.metal()));
    pm.add(mesh(new THREE.SphereGeometry(0.55, 20, 14), MAT.metal('#ff4d6d'), 0, -rod / 2 + 0.1, 0));
    shadow(pm); scene.add(pm); this.pendMesh = pm;
    // 5) 枠・ベル・旗
    const frame = new THREE.Group();
    const wm = MAT.wood('#b8814f');
    frame.add(mesh(rbox(9, 0.6, 7, 0.2), wm, 0, 0.3, 2));
    for (const sx of [-1, 1]) frame.add(mesh(rbox(0.7, 12, 0.7, 0.2), wm, sx * 3.6, 6, 0));
    frame.add(mesh(rbox(8, 0.7, 1, 0.2), wm, 0, 11.8, 0));
    frame.add(mesh(rbox(0.5, 0.5, 3, 0.1), wm, 0, pivotY + 0.2, -1.2));
    this.bell = new THREE.Group();
    const bm = mesh(new THREE.CylinderGeometry(1, 2.6, 3.4, 32, 1, true), MAT.metal('#f2c14e'), 0, -2, 0); bm.material.side = THREE.DoubleSide;
    this.bell.add(bm, mesh(new THREE.SphereGeometry(1, 16, 10), MAT.metal('#f2c14e'), 0, -0.4, 0));
    this.bell.position.set(0, 11.4, 0);
    frame.add(this.bell);
    this.gears = [];
    for (let i = 0; i < 3; i++) {
      const gear = mesh(new THREE.TorusGeometry(1.1 - i * 0.2, 0.3, 8, 12), MAT.metal(['#ffd43b', '#adb5bd', '#ff922b'][i]), -3.6 + i * 0.1, 3 + i * 2.2, 0.8);
      gear.rotation.y = Math.PI / 2; frame.add(gear); this.gears.push(gear);
    }
    frame.add(mesh(new THREE.CylinderGeometry(0.2, 0.25, 22, 12), MAT.metal(), 6, 11, 0));
    this.flag = new THREE.Group();
    const fl = mesh(new THREE.PlaneGeometry(7, 4, 10, 4), new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.8 }), 3.6, 0, 0);
    this.flagMesh = fl;
    const txt = document.createElement('canvas'); txt.width = 256; txt.height = 128;
    const cx = txt.getContext('2d'); cx.fillStyle = '#ff3b5c'; cx.fillRect(0, 0, 256, 128); cx.fillStyle = '#fff'; cx.font = 'bold 54px sans-serif'; cx.textAlign = 'center'; cx.fillText('CLEAR!', 128, 84);
    const tt = new THREE.CanvasTexture(txt); tt.colorSpace = THREE.SRGBColorSpace; fl.material.map = tt;
    this.flag.add(fl);
    this.flag.position.set(6, 2.5, 0);
    frame.add(this.flag);
    const fp = local(g, 0, pz + 1.2);
    frame.position.set(fp.x, 0, fp.z);
    frame.rotation.y = yaw;
    shadow(frame);
    this.group.add(frame);
    this.frame = frame;
    this.stage = 0; // 0:待機 1:巨大ドミノ 2:レバー（ゲート解放） 3:ビー玉 4:振り子→ベル→旗 5:完了
    this.t = 0;
  }
  pendAngle() { const r = this.pend.rotation(); return Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (r.x * r.x + r.z * r.z)))); }
  update(dt) {
    this.p1.sync(this.p1Mesh);
    const mp = this.marble.translation(), mr = this.marble.rotation();
    this.marbleMesh.position.set(mp.x, mp.y, mp.z); this.marbleMesh.quaternion.set(mr.x, mr.y, mr.z, mr.w);
    for (const gi of this.giants) { const p = gi.b.translation(), r = gi.b.rotation(); gi.m.position.set(p.x, p.y, p.z); gi.m.quaternion.set(r.x, r.y, r.z, r.w); }
    const pp = this.pend.translation(), pr = this.pend.rotation();
    this.pendMesh.position.set(pp.x, pp.y, pp.z); this.pendMesh.quaternion.set(pr.x, pr.y, pr.z, pr.w);
    const up = (b) => { const r = b.rotation(); return 1 - 2 * (r.x * r.x + r.z * r.z); };
    if (this.stage === 0 && up(this.giants[0].b) < 0.9) { this.stage = 1; this.onStep && this.onStep('giant', this.giants[1].m.position); }
    if (this.stage === 1 && this.p1.angle() > 0.18) {
      this.stage = 2;
      this.gate.setEnabled(false); this.gateMesh.visible = false;
      this.marble.wakeUp();
      this.marble.applyImpulse({ x: Math.sin(this.port.yaw) * 0.3, y: 0, z: Math.cos(this.port.yaw) * 0.3 }, true);
      this.onStep && this.onStep('lever', this.p1Mesh.position);
    }
    if (this.stage === 2) { const v = this.marble.linvel(); if (v.x * v.x + v.z * v.z > 2) { this.stage = 3; this.onStep && this.onStep('marble', this.marbleMesh.position); } }
    if (this.stage === 3 && this.pendAngle() > 0.22) { this.stage = 4; this.t = 0; this.onStep && this.onStep('bell', this.frame.position); }
    if (this.stage >= 4) {
      this.t += dt;
      this.bell.rotation.x = Math.sin(this.t * 8) * 0.45 * Math.exp(-this.t * 0.25);
      this.gears.forEach((gg, i) => (gg.rotation.z += dt * (2 + i) * (i % 2 ? -1 : 1)));
      this.flag.position.y = Math.min(19, 2.5 + this.t * 5.5);
      const pos = this.flagMesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin(x * 1.2 + this.t * 6) * 0.25 * (x + 3.5) / 7); }
      pos.needsUpdate = true;
      if (this.stage === 4 && this.flag.position.y >= 19) { this.stage = 5; if (this.onTrigger) this.onTrigger(); }
    }
  }
  get triggered() { return this.stage >= 5; }
  focus() { return this.frame.position; }
  reset() {
    this.p1.reset();
    this.gate.setEnabled(true); this.gateMesh.visible = true;
    this.marble.setTranslation({ x: this.marblePose.x, y: this.marbleY, z: this.marblePose.z }, true);
    this.marble.setLinvel({ x: 0, y: 0, z: 0 }, true); this.marble.setAngvel({ x: 0, y: 0, z: 0 }, true); this.marble.sleep();
    for (const gi of this.giants) {
      gi.b.setTranslation({ x: gi.p.x, y: gi.h / 2 + 0.002, z: gi.p.z }, true); gi.b.setRotation(this.physics.quatYaw(this.port.yaw), true);
      gi.b.setLinvel({ x: 0, y: 0, z: 0 }, true); gi.b.setAngvel({ x: 0, y: 0, z: 0 }, true); gi.b.sleep();
    }
    const pv = this.pivotPose;
    this.pend.setTranslation({ x: pv.x, y: pv.y - pv.rod / 2, z: pv.z }, true); this.pend.setRotation(this.physics.quatYaw(this.port.yaw), true);
    this.pend.setLinvel({ x: 0, y: 0, z: 0 }, true); this.pend.setAngvel({ x: 0, y: 0, z: 0 }, true); this.pend.sleep();
    this.stage = 0; this.t = 0; this.flag.position.y = 2.5; this.bell.rotation.x = 0;
  }
  dispose() {
    this.p1.dispose();
    this.physics.world.removeRigidBody(this.marble);
    this.physics.world.removeRigidBody(this.pend); this.physics.world.removeRigidBody(this.pivot);
    for (const gi of this.giants) { this.physics.world.removeRigidBody(gi.b); this.scene.remove(gi.m); }
    for (const c of this.cols) this.physics.remove(c);
    this.physics.remove(this.gate);
    this.scene.remove(this.group, this.p1Mesh, this.marbleMesh, this.pendMesh);
  }
}
