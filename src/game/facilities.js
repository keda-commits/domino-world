import * as THREE from 'three';
import { CFG } from '../config.js';
import { MAT, rbox, shadow, toyBox } from '../world/props.js';
import { trainMesh } from '../world/devices.js';
import { PathFollower } from './nav.js';
import { R } from '../core/physics.js';

const miniGeo = new THREE.BoxGeometry(CFG.dominoW * 0.7, CFG.dominoH * 0.7, CFG.dominoT * 0.9);
const miniMats = ['#ff3b3b', '#ffd21f', '#1fa8ff', '#3ccf5a', '#ff8a1f', '#6b5cff', '#ff5cb0'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }));

/** 倉庫（おもちゃ箱）。在庫は全倉庫で共通 */
export class Depot {
  constructor(game, x, z, i) {
    this.game = game;
    this.pos = new THREE.Vector3(x, 0, z);
    const cols = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5'];
    this.mesh = toyBox(cols[i % 4]);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = Math.atan2(-x, -z) + Math.PI; // 部屋の中央を向く
    game.scene.add(this.mesh);
    game.stage.obstacles.push({ x, z, hw: 3.4, hd: 3.4, yaw: 0, roomba: true, build: true });
  }
  spot(id, out) { const a = (id * 2.399) % (Math.PI * 2); return out.set(this.pos.x + Math.cos(a) * 4, 0, this.pos.z + Math.sin(a) * 4); }
  take(n) { const t = Math.min(n, this.game.stock); this.game.stock -= t; return t; }
  dispose() { this.game.scene.remove(this.mesh); }
}

/** 前線資材置き場：建設の最前線（未建設スロットの先頭）についていく */
export class Crate {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    const wood = MAT.wood('#c08a4e');
    this.group.add(new THREE.Mesh(rbox(2.4, 0.25, 1.8, 0.05), wood).translateY(0.12));
    for (const [x, z, w, d] of [[0, 0.85, 2.4, 0.12], [0, -0.85, 2.4, 0.12], [1.15, 0, 0.12, 1.8], [-1.15, 0, 0.12, 1.8]]) {
      const m = new THREE.Mesh(rbox(w, 0.5, d, 0.04), wood); m.position.set(x, 0.5, z); this.group.add(m);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2), MAT.metal()); pole.position.set(1.15, 1.1, 0); this.group.add(pole);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 3), MAT.plastic('#ff4d4d')); flag.rotation.z = -Math.PI / 2; flag.position.set(1.4, 2.1, 0); this.group.add(flag);
    this.minis = [];
    for (let i = 0; i < 24; i++) {
      const d = new THREE.Mesh(miniGeo, miniMats[i % miniMats.length]);
      d.position.set(-0.85 + (i % 6) * 0.34, 0.6 + Math.floor(i / 12) * 0.72, -0.35 + (Math.floor(i / 6) % 2) * 0.7);
      d.visible = false; this.group.add(d); this.minis.push(d);
    }
    shadow(this.group);
    game.scene.add(this.group);
    this.pos = this.group.position;
    this.count = 0;
    this.cap = 60;
    // 資材箱の当たり判定（ドミノや小物がぶつかる。動かすと一緒に動く）
    this.body = game.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -5, 0));
    game.physics.world.createCollider(R.ColliderDesc.cuboid(1.2, 0.38, 0.9).setTranslation(0, 0.38, 0).setFriction(0.6), this.body);
    this._v = new THREE.Vector3();
    this.moving = false;
  }
  spot(id, out) { const a = (id * 2.399) % (Math.PI * 2); return out.set(this.pos.x + Math.cos(a) * 1.6, 0, this.pos.z + Math.sin(a) * 1.4); }
  take(n) { const t = Math.min(n, this.count); this.count -= t; return t; }
  syncCollider() { this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }); this.body.setNextKinematicRotation(this.game.physics.quatYaw(this.group.rotation.y)); }
  update(dt) {
    const g = this.game;
    this.cap = 60 + 30 * g.level('basket') + (g.level('train') ? 60 : 0);
    const front = g.frontSlot();
    // プレイヤーが運んで置いたら、その場所に固定（建設の先頭を追わない）
    if (front && !this.pinned && !this.carried) {
      const tgt = g.sideOf(front, 3.2, this._v);
      // 置けない場所なら反対側
      if (g.stage.blocked(tgt.x, tgt.z, 1.4) || !g.stage.inBounds(tgt.x, tgt.z, 1.2)) g.sideOf(front, -3.2, tgt);
      const d = this.pos.distanceTo(tgt);
      if (d > 6) this.moving = true;
      if (this.moving) {
        const step = Math.min(d, 8 * g.odMult() * dt);
        if (d > 1e-3) this.pos.addScaledVector(tgt.sub(this.pos).normalize(), step);
        if (d < 0.1) this.moving = false;
      }
    }
    if (!this.carried) this.pos.y = g.stage.heightAt(this.pos.x, this.pos.z);
    this.syncCollider();
    const show = Math.min(24, Math.ceil(this.count / Math.max(1, this.cap / 24)));
    for (let i = 0; i < 24; i++) this.minis[i].visible = i < show;
  }
}

/** ドミノ自動設置機：計画コースの未建設スロットを順番に走りながら設置 */
export class Machine {
  constructor(game) {
    this.game = game;
    const g = (this.group = new THREE.Group());
    const yellow = MAT.plastic('#ffc21a');
    g.add(new THREE.Mesh(rbox(1.6, 1.0, 2.4, 0.15), yellow).translateY(0.85));
    const cab = new THREE.Mesh(rbox(1.4, 1.0, 1.0, 0.15), yellow); cab.position.set(0, 1.85, -0.6); g.add(cab);
    const win = new THREE.Mesh(rbox(1.45, 0.6, 0.8, 0.1), new THREE.MeshPhysicalMaterial({ color: '#8fe0ff', roughness: 0.05, transmission: 0.4 })); win.position.set(0, 1.95, -0.6); g.add(win);
    for (const x of [-0.9, 0.9]) { const t = new THREE.Mesh(rbox(0.4, 0.6, 2.8, 0.15), MAT.matte('#333')); t.position.set(x, 0.3, 0); g.add(t); }
    const hop = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.35, 0.9, 16, 1, true), MAT.plastic('#e8423b')); hop.material.side = THREE.DoubleSide; hop.position.set(0, 1.85, 0.6); g.add(hop);
    this.arm = new THREE.Group(); this.arm.position.set(0.7, 1.4, 0.9);
    const bar = new THREE.Mesh(rbox(1.1, 0.18, 0.18, 0.05), MAT.plastic('#e8423b')); bar.position.x = 0.55; this.arm.add(bar);
    this.held = new THREE.Mesh(miniGeo, miniMats[0]); this.held.position.set(1.05, -0.45, 0); this.arm.add(this.held);
    g.add(this.arm);
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshStandardMaterial({ color: '#ff7a00', emissive: '#ff5500', emissiveIntensity: 1 })); this.light.position.set(0, 2.45, -0.6); g.add(this.light);
    // 進化：高速建設ライン（ベルトコンベア＋青いライト）
    this.conveyor = new THREE.Group();
    const belt = new THREE.Mesh(rbox(0.7, 0.15, 2.6, 0.05), MAT.matte('#222')); belt.position.set(0, 2.4, 0.3); belt.rotation.x = -0.3; this.conveyor.add(belt);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.08, 8, 30), new THREE.MeshStandardMaterial({ color: '#4dd2ff', emissive: '#4dd2ff', emissiveIntensity: 1.5 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; this.conveyor.add(ring);
    this.conveyor.visible = false; g.add(this.conveyor);
    shadow(g);
    g.visible = false;
    game.scene.add(g);
    this.pos = g.position;
    this.hopper = 0; this.timer = 0; this.armT = 1; this.placed = 0; this.direct = 0; this.notice = 0;
    this._v = new THREE.Vector3();
  }
  rate() { const lv = this.game.machineActive() ? this.game.level('machine') : 0; return lv <= 0 ? 0 : (2.5 + 1.5 * (lv - 1)) * (this.game.evolved('fastLine') ? 2 : 1); }
  update(dt) {
    const g = this.game;
    const lv = g.machineActive() ? g.level('machine') : 0;
    this.group.visible = lv > 0;
    if (lv <= 0) {
      // 休止中（ステージ1・2）：ホッパーに残ったドミノは倉庫へ返す（総数は変えない）
      if (this.hopper > 0) { g.stock += this.hopper; this.hopper = 0; }
      return;
    }
    this.conveyor.visible = g.evolved('fastLine');
    const od = g.odMult();
    const cap = 20 + 12 * lv;
    if (g.mode !== 'build') { this.notice = 0; return; }
    if (this.hopper < cap && g.crate.count > 0 && this.pos.distanceTo(g.crate.pos) < 16) {
      const n = Math.min(g.crate.count, cap - this.hopper, Math.max(1, Math.round(30 * dt)));
      g.crate.count -= n; this.hopper += n;
    }
    this.direct += dt * lv * (g.evolved('fastLine') ? 4 : 1);
    while (this.direct >= 1) { this.direct -= 1; if (this.hopper < cap && g.stock > 0) { g.stock--; this.hopper++; } }
    const target = g.machineTarget();
    if (target) {
      const tgt = g.sideOf(target, -1.6, this._v);
      const d = this.pos.distanceTo(tgt);
      if (d > 0.05) this.pos.addScaledVector(tgt.clone().sub(this.pos).normalize(), Math.min(d, 9 * od * dt));
      let dy = target.yaw - this.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.group.rotation.y += dy * Math.min(1, dt * 8);
      this.timer = Math.min(this.timer + dt * this.rate() * od, 2);
      while (this.timer >= 1) {
        const slot = g.machineTarget();
        if (!slot || this.hopper <= 0 || this.pos.distanceTo(g.sideOf(slot, -1.6, this._v)) > 2.5) { this.timer = Math.min(this.timer, 1); break; }
        this.timer -= 1; this.hopper--; this.placed++;
        g.placeAt(slot, null);
        this.armT = 0;
      }
      this.notice -= dt;
      this.empty = this.hopper <= 0 ? (this.empty || 0) + dt : 0;
      if (this.empty > 3 && this.notice <= 0) { this.notice = 10; g.fx.floatAt(this.pos.clone().setY(2.6), '補給待ち…', 'warn', 1.5); }
    }
    this.armT = Math.min(1, this.armT + dt * 4);
    this.arm.rotation.z = -Math.sin(this.armT * Math.PI) * 0.5;
    this.held.visible = this.hopper > 0;
    this.light.material.emissiveIntensity = this.hopper > 0 ? 0.6 + Math.sin(performance.now() * 0.02) * 0.5 : 0.1;
    this.pos.y = g.stage.heightAt(this.pos.x, this.pos.z) + Math.abs(Math.sin(performance.now() * 0.03)) * 0.04;
  }
}

/** 運搬列車：倉庫 ⇔ 前線資材置き場（高速建設ラインでは設置機へ直結） */
export class Train {
  constructor(game) {
    this.game = game;
    this.mesh = trainMesh();
    this.mesh.visible = false;
    game.scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.load = 0; this.state = 'load'; this.timer = 0;
  }
  update(dt) {
    const g = this.game, lv = g.level('train');
    this.mesh.visible = lv > 0;
    if (lv <= 0) return;
    const cap = 20 * (lv + 1);
    const home = g.depots[0].pos;
    const dest = g.evolved('fastLine') && g.machineActive() && g.level('machine') ? g.machine.pos : g.crate.pos;
    // ドミノの列・家具・資材箱をよけて走る（車体が大きいので、障害物から1単位以上離れた道だけ）
    this.pf ||= new PathFollower(2);
    const go = (tgt, sp) => {
      const d = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z);
      if (d < 2.4) { this.pf.reset(); return true; }
      const wp = g.nav ? this.pf.next(g.nav, this.pos, tgt, g.time) : tgt;
      if (!wp) {
        // 道がない：ドミノの列や家具を貫通せず、その場で待つ（荷物は倉庫に戻す）
        this.waitT = (this.waitT || 0) + dt;
        if (this.waitT > 6 && this.load > 0) { g.stock += this.load; this.load = 0; this.state = 'load'; g.fx.floatAt(this.pos.clone().setY(2.4), '🚂 線路がふさがれて届けられない…', 'warn', 2); }
        if (this.waitT > 6) this.waitT = 0;
        return false;
      }
      this.waitT = 0;
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, dd = Math.hypot(dx, dz) || 1;
      this.pos.x += (dx / dd) * Math.min(dd, sp * dt); this.pos.z += (dz / dd) * Math.min(dd, sp * dt);
      let dy = Math.atan2(dx, dz) - this.mesh.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.mesh.rotation.y += dy * Math.min(1, dt * 6);
      return false;
    };
    const sp = 9 * g.odMult();
    if (this.state === 'load') {
      if (go(home, sp)) {
        this.timer += dt;
        if (this.timer > 0.6 && g.stock > 0 && g.unbuiltCount() > 0) { this.load = Math.min(cap, g.stock); g.stock -= this.load; this.state = 'deliver'; this.timer = 0; g.audio.toot(); }
      }
    } else if (go(dest, sp)) {
      this.timer += dt;
      if (this.timer > 0.4) {
        if (dest === g.machine.pos) { g.machine.hopper += this.load; }
        else { const put = Math.min(this.load, Math.max(0, g.crate.cap - g.crate.count)); g.crate.count += put; g.stock += this.load - put; }
        this.load = 0; this.state = 'load'; this.timer = 0;
      }
    }
    this.mesh.userData.cargo.visible = this.load > 0;
    this.pos.y = g.stage.heightAt(this.pos.x, this.pos.z);
  }
}

/** 製造機（見た目）＋ 基本補充 */
export class Factory {
  constructor(game, pos) {
    this.game = game;
    const g = (this.group = new THREE.Group());
    g.add(new THREE.Mesh(rbox(5, 3.6, 4, 0.3), MAT.plastic('#5c7cfa')).translateY(1.8));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2, 4), MAT.plastic('#e8423b')); roof.position.y = 4.6; roof.rotation.y = Math.PI / 4; g.add(roof);
    const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2.4, 12), MAT.metal('#868e96')); chim.position.set(1.5, 5.2, -0.8); g.add(chim);
    // 歯車（大小2つがかみ合って回る。製造中だけ回る）
    const gearGeo = (r, n) => {
      const sh = new THREE.Group();
      sh.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.2, 20), MAT.metal('#ffd43b')));
      for (let i = 0; i < n; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.3), MAT.metal('#ffd43b')); const a = (i / n) * Math.PI * 2; t.position.set(Math.cos(a) * (r + 0.12), 0, Math.sin(a) * (r + 0.12)); t.rotation.y = -a; sh.add(t); }
      const holder = new THREE.Group(); holder.add(sh); holder.rotation.x = Math.PI / 2; holder.userData.spin = sh; return holder;
    };
    this.gear = gearGeo(0.8, 10); this.gear.position.set(-0.9, 2.4, 2.1); g.add(this.gear);
    this.gear2 = gearGeo(0.5, 7); this.gear2.position.set(0.55, 2.95, 2.1); g.add(this.gear2);
    // 出口とベルトコンベア（工場の右側 → ドミノ箱）
    g.add(new THREE.Mesh(rbox(0.9, 1.0, 0.2, 0.05), MAT.plastic('#343a40')).translateX(2.55).translateY(0.95).translateZ(1.0));
    const belt = new THREE.Mesh(rbox(3.4, 0.12, 0.9, 0.04), MAT.plastic('#495057')); belt.position.set(4.2, 0.75, 1.0); g.add(belt);
    this.rollers = [];
    for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.95, 8), MAT.metal('#adb5bd')); r.rotation.x = Math.PI / 2; r.position.set(2.7 + i * 0.6, 0.62, 1.0); g.add(r); this.rollers.push(r); }
    for (const x of [2.8, 5.6]) for (const z of [0.6, 1.4]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 6), MAT.metal('#868e96')).translateX(x).translateY(0.31).translateZ(z));
    // ドミノ箱（できたドミノがたまる。中身が見える）
    const box = new THREE.Group(); box.position.set(6.6, 0, 1.0);
    const wood = MAT.wood('#c98c55');
    box.add(new THREE.Mesh(rbox(1.6, 0.1, 1.4, 0.03), wood).translateY(0.05));
    for (const [x, z, w, d] of [[-0.78, 0, 0.08, 1.4], [0.78, 0, 0.08, 1.4], [0, -0.68, 1.6, 0.08], [0, 0.68, 1.6, 0.08]]) box.add(new THREE.Mesh(rbox(w, 0.7, d, 0.02), wood).translateX(x).translateY(0.35).translateZ(z));
    g.add(box); this.boxObj = box;
    this.pile = [];
    for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(miniGeo, miniMats[i % miniMats.length]); m.rotation.set(Math.PI / 2, 0, (Math.random() - 0.5) * 0.6); m.position.set(-0.5 + (i % 4) * 0.33, 0.14 + Math.floor(i / 12) * 0.12, -0.45 + (Math.floor(i / 4) % 3) * 0.45); m.visible = false; box.add(m); this.pile.push(m); }
    this.items = []; // ベルトの上を流れるドミノ
    shadow(g);
    g.position.copy(pos);
    g.visible = false;
    game.scene.add(g);
    this.acc = 0; this.baseAcc = 0;
    this.box = 0; // ドミノ箱の中身（総数に含める）
    this.made = 0; this.running = false;
  }
  /** 基本補充（おもちゃ箱から、工場なしでも）＋工場の製造 */
  rate() { return CFG.baseSupplyRate + 0.8 * this.game.level('factory'); }
  factoryRate() { return 0.8 * this.game.level('factory'); }
  /** ドミノ箱の受け取り場所（運搬担当が取りに来る） */
  boxPos(out = new THREE.Vector3()) { this.group.updateMatrixWorld(); return out.set(6.6, 0, 2.4).applyMatrix4(this.group.matrixWorld); }
  take(n) { const k = Math.min(n, this.box); this.box -= k; return k; }
  update(dt) {
    const g = this.game;
    const lv = g.level('factory');
    this.group.visible = lv > 0;
    const need = g.unbuiltCount() + g.loosePlannedNeed() + 30;
    const short = g.stock + g.crate.count + this.box + this.items.length < need;
    // 基本補充（工場とは別。倉庫に直接）
    if (short) {
      this.baseAcc += dt * CFG.baseSupplyRate * g.odMult();
      while (this.baseAcc >= 1) { this.baseAcc -= 1; g.stock++; g.stats.produced++; }
    }
    // 工場：足りないときだけ動く（歯車が回り、1枚ずつベルトに乗る）
    this.running = lv > 0 && short && g.mode === 'build' && this.box < 60;
    if (this.running) {
      this.acc += dt * this.factoryRate() * g.odMult();
      while (this.acc >= 1) { this.acc -= 1; this.spawnItem(); }
    }
    const sp = this.running || this.items.length ? 1 : 0;
    this.gear.userData.spin.rotation.y += dt * 2.2 * sp; this.gear2.userData.spin.rotation.y -= dt * 3.5 * sp;
    for (const r of this.rollers) r.rotation.y += dt * 6 * sp;
    // ベルトの上を流れて、箱に落ちる（落ちた瞬間に箱の数が増える）
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const x = 2.6 + Math.min(1, it.t / 1.6) * 3.4;
      it.m.position.set(x, 0.92, 1.0);
      if (it.t > 1.6) {
        const k = Math.min(1, (it.t - 1.6) / 0.25);
        it.m.position.set(6.0 + 0.6 * k, 0.92 - 0.7 * k, 1.0);
        it.m.rotation.z = -k * 1.2;
        if (k >= 1) { this.group.remove(it.m); this.items.splice(i, 1); this.box++; this.made++; g.stats.produced++; }
      }
    }
    // 運搬担当がいないときは、工場の係がゆっくり倉庫へ送る（止まらない保証）
    if (this.box > 0 && g.level('carrier') === 0) { this.chute = (this.chute || 0) + dt * 0.6; while (this.chute >= 1 && this.box > 0) { this.chute -= 1; this.box--; g.stock++; } }
    for (let i = 0; i < this.pile.length; i++) this.pile[i].visible = i < Math.min(this.box, 24);
  }
  spawnItem() {
    const m = new THREE.Mesh(miniGeo, miniMats[(this.made + this.items.length) % miniMats.length]);
    m.rotation.set(Math.PI / 2, 0, 0); m.castShadow = true;
    this.group.add(m);
    this.items.push({ m, t: 0 });
  }
}
