// Rapier のドミノ連鎖パラメータ検証（node tools/physics-probe.mjs）
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();
const H = 1.0, W = 0.5, T = 0.15;

function run({ n = 300, spacing = 0.6, g = 60, curveR = 0, stopperAt = -1, gapAt = -1, dt = 1 / 120, iters = 4, wiggle = 0, freeze = true }) {
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = dt;
  world.integrationParameters.numSolverIterations = iters;
  world.createCollider(RAPIER.ColliderDesc.cuboid(1500, 0.5, 1500).setTranslation(0, -0.5, 0).setFriction(0.6));
  const bodies = [];
  let x = 0, z = 0, yaw = 0;
  for (let i = 0; i < n; i++) {
    if (i === gapAt) { x += Math.sin(yaw) * spacing * 1.9; z += Math.cos(yaw) * spacing * 1.9; }
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const jx = wiggle ? (Math.random() - 0.5) * wiggle : 0;
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(x + jx, H / 2, z).setRotation(q).setCanSleep(true).setSleeping(true)
      .setLinearDamping(0.05).setAngularDamping(0.2);
    const b = world.createRigidBody(bd);
    world.createCollider(RAPIER.ColliderDesc.roundCuboid(W / 2 - 0.02, H / 2 - 0.02, T / 2 - 0.02, 0.02).setDensity(0.7).setFriction(0.45).setRestitution(0.05), b);
    bodies.push(b);
    if (i === stopperAt) {
      // ストッパー: 次のドミノとの間に固定ブロック
      const sx = x + Math.sin(yaw) * spacing * 0.5, sz = z + Math.cos(yaw) * spacing * 0.5;
      world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2 + 0.05, 0.35, 0.08).setTranslation(sx, 0.35, sz).setRotation(q));
    }
    if (curveR > 0) yaw += (Math.floor(i / Math.round(Math.PI * curveR / spacing)) % 2 ? -1 : 1) * spacing / curveR;
    x += Math.sin(yaw) * spacing;
    z += Math.cos(yaw) * spacing;
  }
  world.step(); for (const b of bodies) b.sleep();
  bodies[0].wakeUp();
  bodies[0].applyImpulseAtPoint({ x: Math.sin(0) * 0.06, y: 0, z: 0.06 }, { x: 0, y: H * 0.9, z: 0 }, true);
  const toppled = new Array(n).fill(-1);
  let t = 0, steps = 0, last = 0, awakeMax = 0;
  const t0 = performance.now();
  while (t < 120) {
    world.step(); t += dt; steps++;
    let awake = 0;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (freeze && toppled[i] >= 0 && !b.isFixed() && t - toppled[i] > 1.2) { b.setBodyType(RAPIER.RigidBodyType.Fixed, false); continue; }
      if (b.isSleeping() || b.isFixed()) continue;
      awake++;
      if (toppled[i] < 0) {
        const r = b.rotation();
        const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
        if (upY < 0.7) { toppled[i] = t; last = t; }
      }
    }
    awakeMax = Math.max(awakeMax, awake);
    if (t - last > 2 && t > 1) break;
  }
  const ms = performance.now() - t0;
  let count = 0; while (count < n && toppled[count] >= 0) count++;
  const total = toppled.filter((v) => v >= 0).length;
  return { contiguous: count, total, simTime: +last.toFixed(2), rate: +(count / last).toFixed(1), msPerStep: +(ms / steps).toFixed(3), awakeMax };
}

const cases = [
  ['curve R=6', { curveR: 6 }],
  ['straight 300', {}],
  ['g=40', { g: 40 }],
  ['g=100', { g: 100 }],
  ['spacing .5', { spacing: 0.5 }],
  ['spacing .75', { spacing: 0.75 }],
  ['spacing .9', { spacing: 0.9 }],
  ['curve R=3', { curveR: 3 }],
  ['curve R=1.5', { curveR: 1.5 }],
  ['curve R=0.8', { curveR: 0.8 }],
  ['wiggle .1', { wiggle: 0.1 }],
  ['stopper@100', { stopperAt: 100 }],
  ['gap@150', { gapAt: 150 }],
  ['1500 straight', { n: 1500, g: 60 }],
  ['1500 stop@40', { n: 1500, stopperAt: 40 }],
];
for (const [name, opt] of cases) console.log(name.padEnd(16), JSON.stringify(run(opt)));
