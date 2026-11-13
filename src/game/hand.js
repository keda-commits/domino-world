import * as THREE from 'three';
import { R } from '../core/physics.js';
import { CFG } from '../config.js';

/**
 * プレイヤーの「手」（Ver.0.4）
 * - ドミノをつかむ：立っている／倒れている／資材置き場（おもちゃ箱・前線の資材箱）から
 * - つかんでいる間：重力を切った剛体を、速度制御でカーソルへ追従させる（ワープしない・周りに当たる）
 * - 離す：その瞬間の速度のまま物理に任せる（向きや位置の自動補正なし）→ 置く・倒す・投げる
 * - デコピン：ドミノに瞬間的な衝撃
 * - 投げたドミノが人に当たると、人がリアクションする
 */
const MAX_THROW = 24; // 投擲速度の上限（単位/秒）
const MAX_FOLLOW = 30;
const SNAP_R = 0.55; // 設計図のマスへ寄せるガイドの半径（控えめ）

export class Hand {
  constructor(game, scene, camera) {
    this.game = game; this.scene = scene; this.camera = camera;
    this.held = null; // {d, lift, yaw, tilt, target, guide}
    this.flying = new Set(); // 手を離れて動いているドミノ（人との当たり判定用）
    this.ray = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._e = new THREE.Euler();
    this.target = new THREE.Vector3();
    this.cursorRay = null;
    // マスへのガイド（床の輪）
    this.guide = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 28), new THREE.MeshBasicMaterial({ color: '#8ff0a4', transparent: true, opacity: 0.7, depthWrite: false }));
    this.guide.rotation.x = -Math.PI / 2; this.guide.visible = false; scene.add(this.guide);
    // 持っているドミノの真下の影マーカー（高さが分かるように）
    this.shadowMark = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
    this.shadowMark.rotation.x = -Math.PI / 2; this.shadowMark.visible = false; scene.add(this.shadowMark);
  }

  get dominoes() { return this.game.dominoes; }

  /** レイの先にあるドミノ（手前優先） */
  pickDomino(ray) {
    const mesh = this.dominoes.mesh;
    const hits = ray.intersectObject(mesh, false);
    for (const h of hits) {
      const d = this.dominoes.byIdx.get(h.instanceId);
      if (d && !d.removed) return { d, point: h.point };
    }
    return null;
  }
  /** レイの先にある資材置き場 */
  pickSupply(ray) {
    const g = this.game;
    const objs = [...g.depots.map((d) => d.mesh), g.crate.group];
    const hits = ray.intersectObjects(objs, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !objs.includes(o)) o = o.parent;
    if (o === g.crate.group) return g.crate.count > 0 || g.stock > 0 ? { kind: 'crate', point: hits[0].point } : { kind: 'empty', point: hits[0].point };
    return g.stock > 0 ? { kind: 'depot', point: hits[0].point } : { kind: 'empty', point: hits[0].point };
  }

  /** つかむ */
  grab(d, point) {
    const g = this.game;
    if (this.held) this.release();
    if (d.slot && d.slot.domino === d && !d.toppled) g.onHandGrab && g.onHandGrab(d);
    if (d.slot && d.slot.domino === d) { d.slot.domino = null; g.unbuiltDirty = true; }
    d.slot = null; d.claim = null; d.accident = false; d.byRoomba = false;
    const b = d.body;
    if (d.frozen) { b.setBodyType(R.RigidBodyType.Dynamic, true); d.frozen = false; }
    b.setGravityScale(0, true); b.wakeUp();
    d.toppled = false; d.standing = false; d.held = true;
    // 今の向きから、ヨー（水平の向き）と傾きを読み取る（持ち上げた瞬間にくるっと回らないように）
    const r = b.rotation(); this._q.set(r.x, r.y, r.z, r.w);
    this._e.setFromQuaternion(this._q, 'YXZ');
    const t = b.translation();
    const up = this.dominoes.upY(d);
    this.held = {
      d, yaw: this._e.y, tilt: up > 0.5 ? this._e.x : 0, // 寝ているドミノは起こしながら持ち上げる
      lift: 0.35, // 持ち運ぶ高さ（床から少し浮かせる）。ホイールで変えられる
      grabOff: point ? Math.max(-0.4, Math.min(0.4, point.y - t.y)) : 0,
    };
    this.target.set(t.x, t.y, t.z);
    g.audio.pick && g.audio.pick();
    this.flying.add(d);
    return d;
  }
  /** 資材置き場からドミノを1枚取り出してつかむ */
  grabFromSupply(kind, point) {
    const g = this.game;
    if (kind === 'crate' && g.crate.count > 0) g.crate.count--;
    else if (g.stock > 0) g.stock--;
    else return null;
    const d = this.dominoes.create({ x: point.x, y: Math.max(0.6, point.y), z: point.z, yaw: 0 }, { kind: 'normal' });
    if (!d) return null;
    g.stats.fromSupply = (g.stats.fromSupply || 0) + 1;
    return this.grab(d, null);
  }

  /** カーソルのレイ（毎フレーム main から） */
  setRay(ray) { this.ray.ray.copy(ray.ray); this.cursorRay = this.ray; }
  adjustLift(dy) { if (this.held) this.held.lift = Math.max(0.02, Math.min(4, this.held.lift + dy)); }
  rotate(dyaw) { if (this.held) this.held.yaw += dyaw; }
  tiltBy(dt) { if (this.held) this.held.tilt = Math.max(-1.4, Math.min(1.4, this.held.tilt + dt)); }

  /** 毎フレーム：目標位置とガイド */
  update(dt) {
    const h = this.held;
    if (h && h.d.removed) { this.held = null; }
    if (this.held && this.cursorRay) {
      const g = this.game;
      const floorY = g.stage.heightAt(this.target.x, this.target.z);
      const cy = floorY + CFG.dominoH / 2 + h.lift;
      // つかんだ点の高さの水平面とカーソルのレイの交点
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(cy + h.grabOff));
      const p = this.cursorRay.ray.intersectPlane(plane, this._v);
      if (p) {
        let x = p.x, z = p.z;
        if (!g.stage.inBounds(x, z, 0.3)) { const b = g.stage.bounds; x = Math.max(b.minX + 0.3, Math.min(b.maxX - 0.3, x)); z = Math.max(b.minZ + 0.3, Math.min(b.maxZ - 0.3, z)); }
        // 空いている設計図のマスに近ければ、控えめに寄せる（位置と向き。離した後の補正はしない）
        const sl = h.lift < 0.7 ? g.nearestSlot(x, z, SNAP_R) : null;
        h.guide = sl && !sl.domino ? sl : null;
        if (h.guide) {
          const k = 0.35 * (1 - Math.hypot(x - sl.x, z - sl.z) / SNAP_R);
          x += (sl.x - x) * k; z += (sl.z - z) * k;
          let dy = sl.yaw - h.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          if (Math.abs(dy) > Math.PI / 2) dy = dy > 0 ? dy - Math.PI : dy + Math.PI; // 表裏どちら向きでもよい
          h.yaw += dy * Math.min(1, dt * 6);
          this.guide.position.set(sl.x, (sl.y || 0) + 0.02, sl.z); this.guide.visible = true;
        } else this.guide.visible = false;
        this.target.set(x, cy, z);
      }
      const t = h.d.body.translation();
      this.shadowMark.position.set(t.x, g.stage.heightAt(t.x, t.z) + 0.015, t.z); this.shadowMark.visible = true;
    } else { this.guide.visible = false; this.shadowMark.visible = false; }
    this.checkHits(dt);
  }

  /** 物理ステップごと：持っているドミノを目標へ（速度制御） */
  step(dt) {
    const h = this.held;
    if (!h || h.d.removed) return;
    const b = h.d.body, t = b.translation();
    const v = this._v.set(this.target.x - t.x, this.target.y - t.y, this.target.z - t.z).multiplyScalar(18);
    if (v.length() > MAX_FOLLOW) v.setLength(MAX_FOLLOW);
    b.setLinvel(v, true);
    // 姿勢：ヨー＋傾き（YXZ）へ角速度で寄せる
    this._q2.setFromEuler(this._e.set(h.tilt, h.yaw, 0, 'YXZ'));
    const r = b.rotation(); this._q.set(r.x, r.y, r.z, r.w);
    const dq = this._q2.clone().multiply(this._q.clone().invert());
    if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
    const ang = 2 * Math.acos(Math.min(1, dq.w));
    const s = Math.sqrt(1 - dq.w * dq.w);
    const w = s > 1e-4 ? { x: (dq.x / s) * ang * 14, y: (dq.y / s) * ang * 14, z: (dq.z / s) * ang * 14 } : { x: 0, y: 0, z: 0 };
    b.setAngvel(w, true);
    void dt;
  }

  /** 離す：今の速度のまま物理に任せる（投げる） */
  release() {
    const h = this.held;
    if (!h) return null;
    this.held = null;
    this.guide.visible = false; this.shadowMark.visible = false;
    const d = h.d;
    if (d.removed) return null;
    const b = d.body;
    b.setGravityScale(1, true);
    const lv = b.linvel();
    const v = this._v.set(lv.x, lv.y, lv.z);
    const sp = v.length();
    // ゆっくり離したら、その場に落とす（追従の小さな揺れを残さない）。速いときは上限まで
    if (sp < 1.2) v.multiplyScalar(0.15);
    else if (sp > MAX_THROW) v.setLength(MAX_THROW);
    b.setLinvel(v, true);
    // 回転はつかんでいる間の補正分を抑える（投げたときは少しだけ回す）
    const av = b.angvel();
    const k = sp > 4 ? 0.6 : 0.1;
    b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
    d.held = false;
    d.releasedAt = this.game.time;
    d.thrown = sp > 4;
    if (d.thrown) this.game.stats.throws = (this.game.stats.throws || 0) + 1;
    this.flying.add(d);
    return { d, speed: sp };
  }

  /** デコピン：当たった点に、カメラの向き（水平）へ瞬間的な衝撃 */
  flick(d, point) {
    if (!d || d.removed || d.held) return;
    const b = d.body;
    if (d.frozen) { b.setBodyType(R.RigidBodyType.Dynamic, true); d.frozen = false; }
    b.wakeUp();
    const dir = this._v.copy(point).sub(this.camera.position); dir.y = 0; dir.normalize();
    const t = b.translation();
    const hy = Math.max(t.y - 0.3, Math.min(t.y + CFG.dominoH * 0.45, point.y)); // 上の方を弾くほど倒れやすい
    b.applyImpulseAtPoint({ x: dir.x * 0.085, y: 0.004, z: dir.z * 0.085 }, { x: point.x, y: hy, z: point.z }, true);
    this.game.audio.flick && this.game.audio.flick();
    this.game.stats.flicks = (this.game.stats.flicks || 0) + 1;
    this.flying.add(d);
  }

  /** 投げた・持っているドミノが人に当たったか（人の簡易当たり判定：半径0.32・高さ1.25の円柱） */
  checkHits(dt) {
    const g = this.game;
    for (const d of [...this.flying]) {
      if (d.removed) { this.flying.delete(d); continue; }
      const b = d.body;
      const lv = b.linvel();
      const sp = Math.hypot(lv.x, lv.y, lv.z);
      if (!d.held && (sp < 0.3 || b.isSleeping())) { this.flying.delete(d); continue; }
      if (sp < 2.2) continue;
      const t = b.translation();
      for (const w of g.workers.list) {
        if (w.hitCool > 0) continue;
        const dx = t.x - w.pos.x, dz = t.z - w.pos.z;
        const reach = 0.32 + d.w * 0.35;
        if (dx * dx + dz * dz > reach * reach || t.y > (w.pos.y || 0) + 1.25 + 0.2 || t.y < (w.pos.y || 0) - 0.3) continue;
        // 当たった：人にリアクション、ドミノは跳ね返る
        const n = Math.hypot(dx, dz) || 1;
        w.hitBy(lv.x / (sp || 1), lv.z / (sp || 1), sp);
        const dot = (lv.x * dx + lv.z * dz) / n;
        if (dot < 0) b.setLinvel({ x: lv.x - 1.6 * (dot * dx) / n, y: Math.max(lv.y, 1.5), z: lv.z - 1.6 * (dot * dz) / n }, true);
        g.audio.bonk && g.audio.bonk();
        g.stats.hits = (g.stats.hits || 0) + 1;
      }
    }
    for (const w of g.workers.list) if (w.hitCool > 0) w.hitCool -= dt;
  }

  /** 今つかんでいるか */
  get holding() { return !!this.held; }
  cancel() { if (this.held) this.release(); }
}
