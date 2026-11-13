import * as THREE from 'three';
import { R } from '../core/physics.js';
import { CFG } from '../config.js';
import { makeCarryCollider } from './grabbables.js';

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
    // つかめるものにカーソルを合わせたときの目印（足元の輪）
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.85, depthWrite: false }));
    this.hoverRing.rotation.x = -Math.PI / 2; this.hoverRing.visible = false; this.hoverRing.renderOrder = 5; scene.add(this.hoverRing);
    this.heldObj = null; // ドミノ以外のつかんでいるもの
    this.falling = []; // 離して落下中の carry オブジェクト
  }

  // ================= ドミノ以外のつかめるもの =================
  /** カーソルの下で一番手前の「つかめるもの」：ドミノ・資材（1枚取り出す）・小物/人/設備 */
  pickAny(ray) {
    const g = this.game;
    const c = [];
    const dh = this.pickDomino(ray);
    if (dh) c.push({ type: 'domino', d: dh.d, point: dh.point, dist: ray.ray.origin.distanceTo(dh.point) });
    const eh = g.grabbables ? g.grabbables.pick(ray) : null;
    if (eh) {
      // 資材箱の中のドミノ（見えている小さなドミノ）をつかんだら1枚取り出す。縁・旗なら箱ごと運ぶ
      if (eh.entry === g.crateEntry && g.crate.minis.includes(eh.object) && g.crate.count > 0) c.push({ type: 'supply', supply: 'crate', point: eh.point, dist: eh.dist });
      else c.push({ type: 'entry', entry: eh.entry, point: eh.point, dist: eh.dist });
    }
    const dep = g.depots.map((d) => d.mesh);
    const hd = ray.intersectObjects(dep, true).find((x) => x.object.visible);
    if (hd) c.push({ type: 'supply', supply: g.stock > 0 ? 'depot' : 'empty', point: hd.point, dist: hd.distance });
    if (!c.length) return null;
    c.sort((a, b) => a.dist - b.dist);
    // ドミノは小さいので少しだけ優先（ほぼ同じ距離なら後ろのものよりドミノ）
    const d = c.find((x) => x.type === 'domino');
    return d && d.dist <= c[0].dist + 0.3 ? d : c[0];
  }
  /** カーソルを合わせたものの足元に輪を出す（つかめる目印） */
  highlight(h) {
    if (!h) { this.hoverRing.visible = false; return; }
    let p, r;
    if (h.type === 'domino') { const t = h.d.body.translation(); p = this._v.set(t.x, 0, t.z); r = 0.55; }
    else if (h.type === 'entry') { p = h.entry.getPos(); r = Math.max(0.5, h.entry.radius * 1.1); }
    else { p = this._v.copy(h.point); r = 0.6; }
    this.hoverRing.position.set(p.x, this.game.stage.heightAt(p.x, p.z) + 0.03, p.z);
    this.hoverRing.scale.setScalar(r);
    this.hoverRing.material.opacity = 0.55 + Math.sin(performance.now() * 0.01) * 0.3;
    this.hoverRing.visible = true;
  }

  /** 小物・人・設備をつかむ */
  grabEntry(e, point) {
    const g = this.game;
    if (this.held) this.release();
    if (this.heldObj) this.releaseObj();
    this.falling = this.falling.filter((f) => { if (f.entry === e) { if (f.collider) f.collider.dispose(); return false; } return true; });
    if (e.onGrab) e.onGrab();
    const base = e.getPos();
    const h = { entry: e, lift: e.mode === 'body' ? 0.5 : 0.9, grabOff: point ? Math.max(0, Math.min(e.height, point.y - base.y)) : 0 };
    if (e.mode === 'body') {
      const b = e.body;
      b.setGravityScale(0, true); b.wakeUp();
      h.hh = e.hh != null ? e.hh : e.radius;
      const r = b.rotation(); this._q.set(r.x, r.y, r.z, r.w); this._e.setFromQuaternion(this._q, 'YXZ'); h.yaw = this._e.y;
      const t = b.translation(); this.target.set(t.x, t.y, t.z);
    } else {
      h.pos = base.clone(); h.vel = new THREE.Vector3(); h.yaw = e.obj.rotation.y;
      h.collider = makeCarryCollider(g, e);
      this.target.copy(base);
    }
    this.heldObj = h;
    if (g.audio.pick) g.audio.pick();
    g.stats.objGrabs = (g.stats.objGrabs || 0) + 1;
    return e;
  }
  /** 離す：剛体はその速度のまま物理に、carry は落下させる */
  releaseObj() {
    const h = this.heldObj;
    if (!h) return null;
    this.heldObj = null;
    this.shadowMark.visible = false;
    const e = h.entry;
    if (e.mode === 'body') {
      const b = e.body;
      b.setGravityScale(1, true);
      const lv = b.linvel(); const v = this._v.set(lv.x, lv.y, lv.z);
      const sp = v.length();
      if (sp < 1.2) v.multiplyScalar(0.15); else if (sp > 18) v.setLength(18);
      b.setLinvel(v, true);
      if (e.onDrop) e.onDrop(e.getPos(), sp);
      return { entry: e, speed: sp };
    }
    const sp = h.vel.length();
    if (sp > 15) h.vel.setLength(15);
    if (sp < 1.2) h.vel.set(0, 0, 0);
    if (e.kind === 'worker') { const w = this.game.workers.list.find((x) => x.root === e.obj); if (w) w.state = 'falling'; }
    this.falling.push({ entry: e, pos: h.pos.clone(), vel: h.vel.clone(), collider: h.collider, speed: sp });
    return { entry: e, speed: sp };
  }
  /** carry オブジェクトの追従と落下 */
  updateObjects(dt) {
    const g = this.game, h = this.heldObj;
    if (h && this.cursorRay) {
      const e = h.entry;
      const floorY = g.stage.heightAt(this.target.x, this.target.z);
      const baseY = floorY + h.lift;
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(baseY + (e.mode === 'body' ? h.hh : 0) + h.grabOff * 0.5));
      const p = this.cursorRay.ray.intersectPlane(plane, this._v);
      if (p) {
        const b = g.stage.bounds, m = Math.max(0.4, e.radius * 0.6);
        this.target.set(Math.max(b.minX + m, Math.min(b.maxX - m, p.x)), baseY, Math.max(b.minZ + m, Math.min(b.maxZ - m, p.z)));
      }
      if (e.mode === 'carry') {
        const prev = h.pos.clone();
        h.pos.lerp(this.target, Math.min(1, dt * 14));
        h.vel.lerp(this._v.copy(h.pos).sub(prev).divideScalar(Math.max(dt, 1e-3)), 0.5);
        e.setPos(h.pos);
        if (e.obj && h.yaw != null) e.obj.rotation.y = h.yaw;
        h.collider.set(h.pos);
      }
      this.shadowMark.position.set(this.target.x, floorY + 0.015, this.target.z); this.shadowMark.scale.setScalar(Math.max(1, e.radius * 2)); this.shadowMark.visible = true;
    }
    // 落下中のもの：重力で落ち、床で少し跳ねて止まる
    for (const f of [...this.falling]) {
      f.vel.y -= 45 * dt;
      f.pos.addScaledVector(f.vel, dt);
      const b = g.stage.bounds, m = Math.max(0.4, f.entry.radius * 0.6);
      if (f.pos.x < b.minX + m || f.pos.x > b.maxX - m) { f.vel.x *= -0.4; f.pos.x = Math.max(b.minX + m, Math.min(b.maxX - m, f.pos.x)); }
      if (f.pos.z < b.minZ + m || f.pos.z > b.maxZ - m) { f.vel.z *= -0.4; f.pos.z = Math.max(b.minZ + m, Math.min(b.maxZ - m, f.pos.z)); }
      const fy = g.stage.heightAt(f.pos.x, f.pos.z);
      if (f.pos.y <= fy) {
        f.pos.y = fy;
        if (f.vel.y < -6) { f.vel.y *= -0.3; f.vel.x *= 0.6; f.vel.z *= 0.6; if (g.audio.drop) g.audio.drop(); }
        else {
          f.vel.multiplyScalar(Math.max(0, 1 - dt * 8)); f.vel.y = 0;
          if (f.vel.lengthSq() < 0.05) {
            f.entry.setPos(f.pos); if (f.collider) f.collider.dispose();
            this.falling.splice(this.falling.indexOf(f), 1);
            if (f.entry.onDrop) f.entry.onDrop(f.pos.clone(), f.speed);
            continue;
          }
        }
      }
      f.entry.setPos(f.pos); if (f.collider) f.collider.set(f.pos);
    }
  }
  /** 物理ステップごと：剛体の小物を目標へ（速度制御。ぬいぐるみ等は倒れないようヨーだけ回す） */
  stepObject() {
    const h = this.heldObj;
    if (!h || h.entry.mode !== 'body') return;
    const b = h.entry.body, t = b.translation();
    const v = this._v.set(this.target.x - t.x, this.target.y + h.hh - t.y, this.target.z - t.z).multiplyScalar(12);
    if (v.length() > 22) v.setLength(22);
    b.setLinvel(v, true);
    if (h.entry.kind === 'prop') { const r = b.rotation(); this._q.set(r.x, r.y, r.z, r.w); this._e.setFromQuaternion(this._q, 'YXZ'); let dy = h.yaw - this._e.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); b.setAngvel({ x: 0, y: dy * 8, z: 0 }, true); }
  }
  get holdingAny() { return !!this.held || !!this.heldObj; }
  releaseAny() { return this.held ? this.release() : this.releaseObj(); }


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
  adjustLift(dy) { const h = this.held || this.heldObj; if (h) h.lift = Math.max(0.02, Math.min(5, h.lift + dy)); }
  rotate(dyaw) { const h = this.held || this.heldObj; if (h) h.yaw = (h.yaw || 0) + dyaw; }
  tiltBy(dt) { if (this.held) this.held.tilt = Math.max(-1.4, Math.min(1.4, this.held.tilt + dt)); }

  /** 毎フレーム：目標位置とガイド */
  update(dt) {
    this.updateObjects(dt);
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
          const k = 0.5 * (1 - Math.hypot(x - sl.x, z - sl.z) / SNAP_R);
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
    this.stepObject();
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
  cancel() { if (this.held) this.release(); if (this.heldObj) this.releaseObj(); }
}
