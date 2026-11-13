import RAPIER from '@dimforge/rapier3d-compat';
import { CFG } from '../config.js';

// Rapier の初期化と、固定タイムステップでの更新をまとめたラッパー。
export let R = null;
export async function initPhysics() {
  await RAPIER.init();
  R = RAPIER;
  return R;
}

export class Physics {
  constructor() {
    this.world = new R.World({ x: 0, y: -CFG.gravity, z: 0 });
    this.world.timestep = CFG.fixedDt;
    this.world.integrationParameters.numSolverIterations = CFG.solverIterations;
    this.acc = 0;
    this.time = 0;
    this.stepMs = 0; // 直近の1ステップ処理時間（計測用）
    this.stepsLastFrame = 0;
    this.listeners = [];
    // 床
    this.ground = this.world.createCollider(R.ColliderDesc.cuboid(400, 1, 400).setTranslation(0, -1, 0).setFriction(0.6));
  }

  onStep(fn) { this.listeners.push(fn); }

  /** 経過時間 dt を固定ステップで進める。返り値は実行したステップ数 */
  update(dt) {
    this.acc = Math.min(this.acc + dt, CFG.fixedDt * CFG.maxSubSteps);
    let n = 0;
    const t0 = performance.now();
    while (this.acc >= CFG.fixedDt) {
      for (const fn of this.listeners) fn(CFG.fixedDt);
      this.world.step();
      this.acc -= CFG.fixedDt;
      this.time += CFG.fixedDt;
      n++;
    }
    if (n) this.stepMs = (performance.now() - t0) / n;
    this.stepsLastFrame = n;
    return n;
  }

  quatYaw(yaw) { return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }; }
  quatYawPitch(yaw, pitch) {
    // Y回転のあとローカルX回転（YXZ）
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
  }

  /** 静的な箱（家具・障害物・台など） */
  staticBox(x, y, z, hx, hy, hz, yaw = 0, friction = 0.6, pitch = 0) {
    const d = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(pitch ? this.quatYawPitch(yaw, pitch) : this.quatYaw(yaw)).setFriction(friction);
    return this.world.createCollider(d);
  }
  staticCylinder(x, y, z, r, hh) {
    return this.world.createCollider(R.ColliderDesc.cylinder(hh, r).setTranslation(x, y, z));
  }
  remove(collider) { if (collider) this.world.removeCollider(collider, true); }
  removeBody(body) { if (body) this.world.removeRigidBody(body); }
}
