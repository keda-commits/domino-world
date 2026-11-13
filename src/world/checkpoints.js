import * as THREE from 'three';
import { CFG } from '../config.js';
import { MAT, rbox, shadow } from './props.js';
import { hingedPaddle } from './devices.js';

const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };

/**
 * 中間ゴール（通過式のおもちゃ装置）。
 * コース上のドミノを「幅広ドミノ」にし、本線の次のドミノと、横に立てたスイッチ板の両方を倒す。
 * スイッチ板（回転ジョイント）が物理的に倒れると装置が作動する。本線の連鎖はそのまま先へ進む。
 */
export class Checkpoint {
  constructor(scene, physics, slot, side, def, index) {
    this.scene = scene; this.physics = physics; this.slot = slot; this.side = side; this.def = def; this.index = index;
    this.done = false; // 報酬を受け取ったか（一度きり）
    this.fired = false; // この回の連鎖で作動したか
    const fx = Math.sin(slot.yaw), fz = Math.cos(slot.yaw);
    const nx = Math.cos(slot.yaw), nz = -Math.sin(slot.yaw);
    const yaw = slot.yaw + side * 0.3;
    const px = slot.x + fx * CFG.spacing * 0.95 + nx * side * 0.55;
    const pz = slot.z + fz * CFG.spacing * 0.95 + nz * side * 0.55;
    this.paddle = hingedPaddle(physics, { x: px, z: pz, yaw, y: slot.y || 0 }, 0.45, 0.95, 0.08, 0.2);
    const col = { bell: '#ffd21f', flag: '#ff4d6d', gacha: '#4dabf7', alarm: '#e8233f', switch: '#69db7c' }[def.type] || '#ffd21f';
    this.paddleMesh = mesh(rbox(0.45, 0.95, 0.08, 0.03), MAT.plastic(col));
    this.paddleMesh.castShadow = true;
    scene.add(this.paddleMesh);
    // 装置本体（スイッチ板の横）
    const toy = new THREE.Group();
    const tx = slot.x + fx * 0.6 + nx * side * 2.3, tz = slot.z + fz * 0.6 + nz * side * 2.3;
    toy.position.set(tx, slot.y || 0, tz);
    toy.rotation.y = slot.yaw;
    this.toy = toy;
    this.pos = new THREE.Vector3(tx, 0, tz);
    const wood = MAT.wood('#c98c55');
    toy.add(mesh(rbox(1.6, 0.3, 1.6, 0.08), wood, 0, 0.15, 0));
    // 板と装置をつなぐ棒
    const rod = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.9, 6), MAT.metal('#adb5bd'), -side * 1.0, 0.25, -0.1);
    rod.rotation.z = Math.PI / 2;
    toy.add(rod);
    this.anim = new THREE.Group();
    toy.add(this.anim);
    if (def.type === 'bell' || def.type === 'alarm') {
      toy.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), MAT.metal(), 0, 1.3, 0));
      toy.add(mesh(rbox(1.2, 0.12, 0.12, 0.03), wood, 0, 2.4, 0));
      const b = new THREE.Group();
      const bell = mesh(new THREE.CylinderGeometry(0.22, 0.55, 0.7, 20, 1, true), Object.assign(MAT.metal(def.type === 'alarm' ? '#e8233f' : '#f2c14e'), { side: THREE.DoubleSide }), 0, -0.4, 0);
      b.add(bell, mesh(new THREE.SphereGeometry(0.12, 10, 8), MAT.metal('#8a6d1f'), 0, -0.75, 0));
      b.position.y = 2.35;
      this.anim.add(b);
      this.swing = b;
      if (def.type === 'alarm') { this.lamp = mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff0000', emissiveIntensity: 0.2 }), 0, 2.7, 0); toy.add(this.lamp); }
    } else if (def.type === 'flag') {
      toy.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), MAT.metal(), 0.5, 1.75, 0));
      const f = mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ color: '#ff4d6d', side: THREE.DoubleSide }), 0.97, 0, 0);
      this.flag = new THREE.Group(); this.flag.add(f); this.flag.position.set(0, 0.6, 0);
      this.anim.add(this.flag);
    } else if (def.type === 'gacha') {
      toy.add(mesh(rbox(1.0, 1.0, 1.0, 0.12), MAT.plastic('#4dabf7'), 0, 0.8, 0));
      toy.add(mesh(new THREE.SphereGeometry(0.6, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0.8, thickness: 0.3 }), 0, 1.75, 0));
      ['#ffd43b', '#ff6b6b', '#69db7c', '#b197fc'].forEach((c, i) => toy.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), MAT.plastic(c), (i - 1.5) * 0.18, 1.6 + (i % 2) * 0.18, 0)));
      this.lever = mesh(rbox(0.1, 0.6, 0.1, 0.03), MAT.metal('#e9ecef'), 0.55, 1.0, 0.3);
      toy.add(this.lever);
      this.capsule = mesh(new THREE.SphereGeometry(0.2, 12, 10), MAT.plastic('#ffd43b'), 0, 0.4, 0.6);
      this.capsule.visible = false;
      toy.add(this.capsule);
    } else {
      this.knob = mesh(rbox(0.3, 0.5, 0.3, 0.06), MAT.plastic('#69db7c'), 0, 0.5, 0);
      toy.add(this.knob);
    }
    // 番号札
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const x = c.getContext('2d'); x.fillStyle = '#fff6e0'; x.fillRect(0, 0, 128, 64); x.strokeStyle = '#8a5a30'; x.lineWidth = 6; x.strokeRect(3, 3, 122, 58);
    x.fillStyle = '#4a3424'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(`中間${index + 1}`, 64, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.sign = mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshStandardMaterial({ map: t }), 0, 0.55, 0.81);
    toy.add(this.sign);
    shadow(toy);
    scene.add(toy);
    this.t = 0;
  }

  /** 毎フレーム：スイッチ板が物理的に倒れたか */
  update(dt) {
    this.paddle.sync(this.paddleMesh);
    if (!this.fired && this.paddle.angle() > 0.4) { this.fired = true; this.t = 0; if (this.onTrigger) this.onTrigger(this); }
    if (this.fired) {
      this.t += dt;
      const k = Math.min(1, this.t * 1.5);
      if (this.swing) this.swing.rotation.x = Math.sin(this.t * 14) * 0.6 * Math.exp(-this.t * 0.6);
      if (this.lamp) this.lamp.material.emissiveIntensity = 1 + Math.sin(this.t * 18);
      if (this.flag) this.flag.position.y = 0.6 + k * 2.6;
      if (this.lever) this.lever.rotation.x = -k * 1.1;
      if (this.capsule) { this.capsule.visible = this.t > 0.4; this.capsule.position.set(0, 0.4 + Math.abs(Math.sin(this.t * 6)) * 0.5 * Math.exp(-this.t), 0.6 + Math.min(1.5, this.t)); }
      if (this.knob) this.knob.position.y = 0.5 - k * 0.2;
    }
    this.sign.material.emissive = this.done ? new THREE.Color('#000') : new THREE.Color('#332200');
  }
  reset() {
    this.paddle.reset();
    this.fired = false; this.t = 0;
    if (this.swing) this.swing.rotation.x = 0;
    if (this.flag) this.flag.position.y = 0.6;
    if (this.lever) this.lever.rotation.x = 0;
    if (this.capsule) this.capsule.visible = false;
    if (this.knob) this.knob.position.y = 0.5;
    if (this.lamp) this.lamp.material.emissiveIntensity = 0.2;
  }
  dispose() { this.paddle.dispose(); this.scene.remove(this.toy, this.paddleMesh); }
}
