import * as THREE from 'three';
import { R } from '../core/physics.js';

/**
 * 「つかめるオブジェクト」の共通システム（Ver.0.4.1）
 * どれも同じ形のエントリーとして登録し、手（Hand）が同じ操作でつかむ・運ぶ・離す。
 *
 * entry = {
 *   name, kind,            // 表示名・種類（prop / worker / facility / piece / threat）
 *   obj,                   // レイ判定と表示に使う Object3D
 *   mode: 'body' | 'carry',// body：Rapier の動的剛体を速度制御で運ぶ／carry：位置を直接運び、離すと落下する
 *   radius, height,        // 足元の輪・運ぶときの当たり判定の大きさ
 *   getPos(), setPos(v),   // 足元（床の高さ）の位置
 *   body,                  // mode=body のとき
 *   onGrab(), onDrop(pos), // つかんだ／着地したとき（AI の一時停止と復帰、障害物の更新など）
 *   canGrab()              // いまつかめるか（本番中などは false）
 * }
 */
function shown(o, root) {
  for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === root) break; }
  return true;
}
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
/** 小さくて動き回るもの（人・ネズミ）をつかみやすくする、透明な当たり用の筒 */
export function addHitProxy(obj, r, h) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), proxyMat);
  m.position.y = h / 2; m.userData.hitProxy = true;
  obj.add(m);
  return m;
}

export class Grabbables {
  constructor(game) { this.game = game; this.list = []; }
  clear() { this.list = []; }
  add(e) { e.canGrab ||= () => true; this.list.push(e); return e; }
  remove(e) { this.list = this.list.filter((x) => x !== e); }
  /** レイの先で一番手前のエントリー */
  pick(ray) {
    let best = null, bd = Infinity;
    for (const e of this.list) {
      if (!e.obj || !e.obj.visible || !e.canGrab()) continue;
      // 見えていない部品（空の資材箱の中身など）は当たり判定から外す。当たり用の透明な筒（hitProxy）は対象
      const h = ray.intersectObject(e.obj, true).find((x) => shown(x.object, e.obj));
      if (h && h.distance < bd) { bd = h.distance; best = { entry: e, point: h.point, dist: h.distance, object: h.object }; }
    }
    return best;
  }
}

/** ステージの小物（積み木・ぬいぐるみ・ボール・ミニカー・リングタワー・植木鉢など）を動かせるようにする */
export function propEntry(game, p) {
  // p = { obj, obstacle, collider, name, r?, hw?, hd?, h }
  const st = game.stage;
  const e = {
    name: p.name, kind: 'prop', obj: p.obj, mode: 'body', radius: p.r || Math.max(p.hw, p.hd), height: p.h,
    getPos: () => p.obj.position.clone(),
    body: null,
    ensureBody() {
      if (e.body) return e.body;
      // 静的な当たり判定を、動かせる剛体（転がらないよう回転はヨーだけ）に置き換える
      if (p.collider) { game.physics.remove(p.collider); st.colliders = st.colliders.filter((c) => c !== p.collider); p.collider = null; }
      const hh = Math.min(p.h, 3) / 2;
      const o = p.obj.position;
      const b = game.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(o.x, o.y + hh + 0.02, o.z).setRotation(game.physics.quatYaw(p.obj.rotation.y)).setLinearDamping(0.6).setAngularDamping(2).enabledRotations(false, true, false).setCanSleep(true));
      const cd = p.r ? R.ColliderDesc.cylinder(hh, p.r * 0.9) : R.ColliderDesc.cuboid(p.hw * 0.9, hh, p.hd * 0.9);
      game.physics.world.createCollider(cd.setDensity(0.25).setFriction(0.7).setRestitution(0.15), b);
      e.body = b; e.hh = hh;
      game.dynamicProps.add(e);
      return b;
    },
    // 毎フレーム：剛体 → 見た目・障害物（ルンバや建設の判定）
    sync() {
      if (!e.body) return;
      const t = e.body.translation(), q = e.body.rotation();
      p.obj.position.set(t.x, t.y - e.hh, t.z);
      p.obj.quaternion.set(q.x, q.y, q.z, q.w);
      if (p.obstacle) { p.obstacle.x = t.x; p.obstacle.z = t.z; p.obstacle.yaw = p.obj.rotation.y; }
    },
    onGrab() { e.ensureBody(); },
    onDrop() {},
    serialize() { const o = p.obj.position; return [+o.x.toFixed(2), +o.z.toFixed(2), +p.obj.rotation.y.toFixed(3)]; },
    restore([x, z, yaw]) {
      p.obj.position.x = x; p.obj.position.z = z; p.obj.rotation.y = yaw || 0;
      if (p.obstacle) { p.obstacle.x = x; p.obstacle.z = z; }
      if (p.collider) { game.physics.remove(p.collider); st.colliders = st.colliders.filter((c) => c !== p.collider); p.collider = null; }
      e.ensureBody(); e.body.setTranslation({ x, y: e.hh + 0.02, z }, true); e.body.setRotation(game.physics.quatYaw(yaw || 0), true); e.sync();
    },
  };
  return e;
}

/** 位置を直接運ぶもの（人・資材箱・設置機・製造機・ベル等）の共通部分 */
export function carryEntry(game, opts) {
  const e = {
    mode: 'carry', radius: 0.6, height: 1.2, ...opts,
    getPos: opts.getPos || (() => opts.obj.position.clone()),
    setPos: opts.setPos || ((v) => opts.obj.position.copy(v)),
  };
  return e;
}

/** 運んでいる・落下中の carry オブジェクトに付ける一時的な当たり判定（ドミノを押しのける） */
export function makeCarryCollider(game, e) {
  const b = game.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
  const hh = Math.min(e.height, 2.5) / 2;
  game.physics.world.createCollider(R.ColliderDesc.cylinder(hh, Math.max(0.25, e.radius * 0.8)).setFriction(0.4), b);
  return { body: b, hh, set(p) { b.setNextKinematicTranslation({ x: p.x, y: p.y + hh, z: p.z }); }, dispose() { game.physics.world.removeRigidBody(b); } };
}

export const tmpV = new THREE.Vector3();
