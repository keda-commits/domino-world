// Uターン（直線→半円→直線）を繰り返すコースでの連鎖成功率を、摩擦・半径・重力ごとに比較する
// node tools/uturn-probe.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const H = 1.0, W = 0.5, T = 0.15, S = 0.6;

function course(R, rows = 6, len = 20) {
  const pts = [];
  let x = 0, z = 0, dir = 1;
  for (let r = 0; r < rows; r++) {
    const steps = Math.round(len / S);
    for (let i = 0; i < steps; i++) { pts.push({ x, z, yaw: dir > 0 ? Math.PI / 2 : -Math.PI / 2 }); x += S * dir; }
    // 半円
    const n = Math.max(2, Math.round((Math.PI * R) / S));
    const cx = x, cz = z + R;
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (Math.PI * k) / n;
      const px = cx + dir * R * Math.cos(a), pz = cz + R * Math.sin(a);
      const ta = a + Math.PI / 2; // 接線方向
      const tx = dir * -Math.sin(a) * -1, tz = Math.cos(a);
      pts.push({ x: px, z: pz, yaw: Math.atan2(dir * -Math.sin(a) * -1 * 1, Math.cos(a)) });
      void ta; void tx; void tz;
    }
    x = cx; z = cz + R; dir = -dir;
  }
  // yaw を隣接点から計算し直す
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    pts[i].yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }
  return pts;
}

function run(pts, { friction = 0.45, g = 80, iters = 4, restitution = 0.05 } = {}) {
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = 1 / 120;
  world.integrationParameters.numSolverIterations = iters;
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.6));
  const bodies = pts.map((p) => {
    const q = { x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) };
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, H / 2 + 0.002, p.z).setRotation(q).setCanSleep(true).setLinearDamping(0.05).setAngularDamping(0.2));
    world.createCollider(RAPIER.ColliderDesc.roundCuboid(W / 2 - 0.025, H / 2 - 0.025, T / 2 - 0.025, 0.025).setDensity(0.7).setFriction(friction).setRestitution(restitution), b);
    return b;
  });
  world.step(); bodies.forEach((b) => b.sleep());
  const b0 = bodies[0]; b0.wakeUp();
  const p0 = pts[0];
  b0.applyImpulseAtPoint({ x: Math.sin(p0.yaw) * 0.07, y: 0, z: Math.cos(p0.yaw) * 0.07 }, { x: p0.x, y: 0.9, z: p0.z }, true);
  const top = new Array(bodies.length).fill(-1);
  let t = 0, last = 0;
  const frozen = new Set();
  while (t < 200) {
    world.step(); t += 1 / 120;
    bodies.forEach((b, i) => {
      if (frozen.has(i) || b.isSleeping()) return;
      const r = b.rotation(); const up = 1 - 2 * (r.x * r.x + r.z * r.z);
      if (top[i] < 0 && up < 0.75) { top[i] = t; last = t; }
      if (top[i] >= 0 && t - top[i] > 1.0) { b.setBodyType(RAPIER.RigidBodyType.Fixed, false); frozen.add(i); }
    });
    if (t - last > 3 && t > 1) break;
  }
  let c = 0; while (c < bodies.length && top[c] >= 0) c++;
  return { reached: c, of: bodies.length };
}

for (const R of [2.0, 2.5, 3.5]) {
  const pts = course(R);
  for (const friction of [0.45, 0.3, 0.2]) {
    const r = run(pts, { friction });
    console.log(`R=${R} friction=${friction}`.padEnd(24), `${r.reached}/${r.of}`);
  }
}
