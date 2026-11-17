import * as THREE from 'three';

/**
 * Ver.0.5 防衛：おもちゃの兵隊のスポンジ弾。
 * 兵隊の手元から敵へ飛ぶ（少し追尾）。当たると enemy.repel(兵隊の位置, 'dart') で敵の動きが変わる。
 * 外れた弾・当たった弾は床に落ちて少しの間残る（突然消えない）。
 */
const dartGeo = new THREE.CapsuleGeometry(0.06, 0.22, 4, 8).rotateX(Math.PI / 2);
const dartMat = new THREE.MeshStandardMaterial({ color: '#ff922b', roughness: 0.8 });
const tipMat = new THREE.MeshStandardMaterial({ color: '#ffd43b', roughness: 0.9 });
const tipGeo = new THREE.SphereGeometry(0.075, 8, 6).translate(0, 0, 0.17);

export class Darts {
  constructor(game) { this.game = game; this.list = []; }
  fire(w, enemy, missChance = 0.12) {
    const g = this.game;
    const m = new THREE.Group();
    m.add(new THREE.Mesh(dartGeo, dartMat), new THREE.Mesh(tipGeo, tipMat));
    m.position.set(w.pos.x + Math.sin(w.yaw) * 0.35, (w.pos.y || 0) + 0.75, w.pos.z + Math.cos(w.yaw) * 0.35);
    g.scene.add(m);
    const miss = Math.random() < missChance;
    const off = miss ? new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3) : new THREE.Vector3();
    this.list.push({ m, enemy, from: w.pos.clone(), off, miss, t: 0, state: 'fly', vy: 0 });
    g.stats.dartsFired = (g.stats.dartsFired || 0) + 1;
    g.audio.pop ? g.audio.pop() : g.audio.pick && g.audio.pick();
  }
  update(dt) {
    const g = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.t += dt;
      if (d.state === 'fly') {
        const e = d.enemy.pos;
        const tx = e.x + d.off.x, tz = e.z + d.off.z, ty = 0.6;
        const dx = tx - d.m.position.x, dy = ty - d.m.position.y, dz = tz - d.m.position.z, dist = Math.hypot(dx, dy, dz);
        const step = 24 * dt;
        d.m.lookAt(tx, ty, tz);
        if (dist <= step || d.t > 1.5) {
          d.m.position.set(tx, ty, tz);
          if (!d.miss && d.t <= 1.5) {
            const ok = d.enemy.repel && d.enemy.repel(d.from, 'dart');
            if (ok) g.stats.dartHits = (g.stats.dartHits || 0) + 1;
            g.fx.floatAt(d.m.position.clone().setY(1.2), ok ? 'ポン！' : 'ポン', ok ? 'coin' : 'warn', 0.6);
          }
          d.state = 'fall'; d.vy = 2;
        } else d.m.position.addScaledVector(new THREE.Vector3(dx, dy, dz).divideScalar(dist), step);
      } else if (d.state === 'fall') {
        d.vy -= 18 * dt; d.m.position.y = Math.max(0.06, d.m.position.y + d.vy * dt);
        if (d.m.position.y <= 0.06) { d.state = 'floor'; d.t = 0; d.m.rotation.x = 0; }
      } else if (d.t > 4) { g.scene.remove(d.m); this.list.splice(i, 1); }
    }
  }
  clear() { for (const d of this.list) this.game.scene.remove(d.m); this.list = []; }
}
