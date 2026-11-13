import * as THREE from 'three';
import * as P from './props.js';
import { R } from '../core/physics.js';
import { pbr, fabricNormal, model } from './assets.js';

/**
 * ステージ定義。家具は「見た目」と「障害物（建設不可・ルンバが避ける）」と「物理コライダー」をまとめて登録する。
 * 障害物: {x,z,hw,hd,yaw} の矩形 または {x,z,r} の円
 */
export const STAGES = {
  1: {
    id: 1,
    name: 'STAGE 1　子ども部屋',
    title: 'はじめての大連鎖',
    goalText: 'スタートからの連鎖でゴールベルを鳴らす',
    target: 300, // 設計規模（クリア条件ではない）
    bounds: { minX: -32, maxX: 32, minZ: -24, maxZ: 24 },
    floor: { w: 120, d: 100, tone: 'light' },
    start: { x: -25, z: -8, yaw: Math.PI / 2 },
    goal: { x: 26.5, z: 18, yaw: Math.PI / 2, type: 'bell' },
    depots: [{ x: -26, z: -19.5 }, { x: 24, z: -4 }],
    markers: [],
    chests: [],
    gachaMachine: null,
    towerSpot: { x: 30, z: -12 }, hqSpot: { x: 10, z: 21 },
    gachaSpot: { x: -19, z: -21.3, yaw: 0 },
    guardPosts: [[-20, 0], [10, -2], [20, 14]],
    roomba: null,
    // 中間ゴール（at = コースの何番目のドミノか）。到達報酬は一度きり
    checkpoints: [
      { at: 50, type: 'bell', name: 'ちいさなベル' },
      { at: 130, type: 'gacha', name: 'ガチャマシンのレバー', category: 'build' },
      { at: 222, type: 'flag', name: '旗あげスイッチ' },
    ],
    // コースに組み込まれた特別なドミノ（倒すと一度だけ効果）
    specials: [{ at: 92, type: 'present' }, { at: 176, type: 'clover' }, { at: 262, type: 'present' }],
    suggested: [
      { name: 'おすすめ：部屋をひと巡りするルート', pts: [[-25, -8], [-21, -8], [-18, -9.5], [-14.2, -12.2], [-10, -14], [-6, -15.5], [-2, -17.8], [3, -18], [7, -17], [9, -14], [8, -11], [4, -9.5], [-1, -8.5], [-5, -7], [-8, -4], [-12, -1], [-15, 3], [-13, 7], [-8, 8], [-2, 8], [4, 7], [8, 6], [13, 5], [18, 3], [21, 5.5], [21.5, 9], [18.5, 11.5], [14, 12], [10, 12.5], [4, 12], [-2, 12.5], [-8, 13], [-11, 15.5], [-9, 18], [-3, 16], [4, 16.5], [10, 18], [16, 18], [21, 18], [24.5, 18]] },
    ],
    build: buildStage1,
  },
  2: {
    id: 2,
    name: 'STAGE 2　リビング',
    title: 'ルンバが来たぞ！',
    goalText: 'ルンバから守り抜き、連鎖で巨大からくり装置を起動する',
    target: 1300, // 設計規模（クリア条件ではない）
    bounds: { minX: -74, maxX: 74, minZ: -47, maxZ: 47 },
    floor: { w: 220, d: 160, tone: 'dark' },
    start: { x: -71.5, z: -42, yaw: 0 },
    goal: { x: 48, z: 41, yaw: Math.PI / 2, type: 'machine' },
    depots: [{ x: -66, z: 21.5 }, { x: -38, z: -42 }, { x: 27, z: -43.5 }, { x: 60, z: -20 }],
    markers: [],
    chests: [],
    gachaMachine: null,
    towerSpot: { x: -52, z: 10 }, hqSpot: { x: -44, z: 43.5 },
    gachaSpot: { x: -28, z: -41, yaw: 0 },
    guardPosts: [[-48, 14], [0, 25.5], [52, 10], [20, -36], [-30, -37]],
    roomba: {
      dock: { x: 62, z: -42, yaw: 0 },
      radius: 3.0,
      // 巡回パターン（交互に実行・事前に床へ予告表示）
      patterns: [
        { name: 'ソファ前の掃除', pts: [[50, -34], [-36, -30], [-36, -22], [40, -22], [52, -32]] },
        { name: 'テーブルまわりのスポット掃除', pts: [[46, -28], [20, -16], [5, -18], [-10, -12], [-10, -2], [5, 4], [20, -2], [20, -16], [48, -30]] },
        { name: '窓ぎわ手前の掃除（前列に接近！）', pts: [[50, -28], [46, 0], [30, 14], [12, 22], [8, 25.5], [-12, 25.5], [-20, 20], [-36, 16], [-36, 6], [30, 6], [48, -28]] },
      ],
      idleTime: 30,
    },
    checkpoints: [
      { at: 150, type: 'flag', name: '廊下の旗' },
      { at: 410, type: 'alarm', name: '警報ベル（ルンバを帰らせる）' },
      { at: 760, type: 'gacha', name: '防衛ガチャマシン', category: 'defense' },
      { at: 1060, type: 'alarm', name: '第2警報ベル' },
    ],
    specials: [{ at: 300, type: 'present' }, { at: 600, type: 'clover' }, { at: 930, type: 'present' }],
    suggested: [],
    build: buildStage2,
  },
};

// 円弧の点列（a0→a1、x = cx + r cos a, z = cz + r sin a）
function arc(cx, cz, r, a0, a1, n = 10) {
  const out = [];
  for (let i = 1; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([+(cx + r * Math.cos(a)).toFixed(2), +(cz + r * Math.sin(a)).toFixed(2)]); }
  return out;
}
const PI = Math.PI;

STAGES[2].suggested = [
  {
    name: 'A：廊下と窓ぎわを使う迂回ルート（安全・長い）',
    pts: [
      [-71.5, -42], [-71.5, 14], ...arc(-69.5, 14, 2, PI, 0),
      [-67.5, -40], ...arc(-65.5, -40, 2, PI, 2 * PI),
      [-63.5, 14], ...arc(-61.5, 14, 2, PI, 0),
      [-59.5, -40], ...arc(-57.75, -40, 1.75, PI, 2 * PI),
      [-56, 24], ...arc(-52, 24, 4, PI, PI / 2),
      [34, 28], ...arc(34, 30.3, 2.3, -PI / 2, PI / 2),
      [-55, 32.6], ...arc(-55, 34.8, 2.2, -PI / 2, -1.5 * PI),
      [40, 37], [43, 39.4], [46, 41],
    ],
  },
  {
    name: 'B：中央をジグザグに使うルート（長さを稼げるが要防衛）',
    pts: [
      [-71.5, -42], [-71.5, -4], ...arc(-67.5, -4, 4, PI, PI / 2),
      [-54, 0], [-50.5, -1], [-48.5, -3.5], [-48, -7],
      [-48, -28], ...arc(-46, -28, 2, PI, 1.5 * PI),
      [44, -30], ...arc(44, -27.5, 2.5, -PI / 2, PI / 2),
      [-40, -25], ...arc(-40, -22.5, 2.5, -PI / 2, -1.5 * PI),
      [44, -20], ...arc(44, -15, 5, -PI / 2, PI / 2, 16),
      [-40, -10], ...arc(-40, -5, 5, -PI / 2, -1.5 * PI, 16),
      [44, 0], ...arc(44, 4, 4, -PI / 2, PI / 2, 14),
      [-40, 8], ...arc(-40, 14, 6, -PI / 2, -1.5 * PI, 18),
      [28, 20], ...arc(28, 24, 4, -PI / 2, 0, 8), [32.5, 30], [35, 34.5], [40, 37], [43, 39.4], [46, 41],
    ],
  },
];

// ------------------------------------------------------------
class StageRuntime {
  constructor(def, scene, physics) {
    this.def = def;
    Object.assign(this, { id: def.id, bounds: def.bounds, start: def.start, goal: def.goal, target: def.target });
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.obstacles = []; // 建設不可・ルンバが避ける
    this.surfaces = []; // {x,z,hw,hd,h, shape:'rect'|'ellipse'}
    this.colliders = [];
    this.lights = [];
  }
  add(obj, x = 0, z = 0, yaw = 0, y = 0) { obj.position.set(x, y, z); obj.rotation.y = yaw; this.group.add(obj); return obj; }
  rect(x, z, hw, hd, yaw = 0, h = 6, opts = {}) {
    this.obstacles.push({ x, z, hw, hd, yaw, h, roomba: opts.roomba !== false, build: opts.build !== false });
    if (opts.collider !== false) this.colliders.push(this.physics.staticBox(x, h / 2, z, hw, h / 2, hd, yaw));
  }
  circle(x, z, r, h = 6, opts = {}) {
    this.obstacles.push({ x, z, r, h, roomba: opts.roomba !== false, build: opts.build !== false });
    if (opts.collider !== false) this.colliders.push(this.physics.staticCylinder(x, h / 2, z, r, h / 2));
  }
  wall(x1, z1, x2, z2, h = 40, t = 1) {
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, len = Math.hypot(x2 - x1, z2 - z1);
    const yaw = Math.atan2(x2 - x1, z2 - z1);
    this.rect(cx, cz, t / 2, len / 2, yaw, h);
  }
  surface(x, z, hw, hd, h, shape = 'rect') {
    this.surfaces.push({ x, z, hw, hd, h, shape });
    if (shape === 'rect') this.colliders.push(this.physics.staticBox(x, h / 2, z, hw, h / 2, hd, 0, 0.7));
    else {
      const pts = [];
      for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(x + Math.cos(a) * hw, 0, z + Math.sin(a) * hd, x + Math.cos(a) * hw, h, z + Math.sin(a) * hd); }
      const d = R.ColliderDesc.convexHull(new Float32Array(pts));
      if (d) this.colliders.push(this.physics.world.createCollider(d.setFriction(0.7)));
    }
  }

  inBounds(x, z, m = 0) { const b = this.bounds; return x >= b.minX + m && x <= b.maxX - m && z >= b.minZ + m && z <= b.maxZ - m; }
  /** 建設できない場所か（家具・おもちゃ・設備） */
  blocked(x, z, m = 0, forRoomba = false) {
    for (const o of this.obstacles) {
      if (forRoomba ? !o.roomba : !o.build) continue;
      if (o.r != null) { if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + m) ** 2) return true; continue; }
      const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw);
      const dx = x - o.x, dz = z - o.z;
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (Math.abs(lx) < o.hw + m && Math.abs(lz) < o.hd + m) return true;
    }
    for (const e of this.extraBlockers || []) if (e(x, z, m, forRoomba)) return true;
    return false;
  }
  heightAt(x, z) {
    let h = 0;
    for (const s of this.surfaces) {
      const dx = (x - s.x) / s.hw, dz = (z - s.z) / s.hd;
      const inside = s.shape === 'rect' ? Math.abs(dx) <= 1 && Math.abs(dz) <= 1 : dx * dx + dz * dz <= 1;
      if (inside) h = Math.max(h, s.h);
    }
    return h;
  }
  dispose() {
    this.scene.remove(this.group);
    for (const c of this.colliders) this.physics.remove(c);
    for (const l of this.lights) this.scene.remove(l);
  }
}

function lighting(st, sunPos, sunColor = '#ffdcb0', intensity = 3.4) {
  // 窓から入る方向性のある光が主役。周りの光（半球光）は弱くして陰影を出す
  const hemi = new THREE.HemisphereLight('#ffeedd', '#5a3f2a', 0.22);
  const sun = new THREE.DirectionalLight(sunColor, intensity);
  sun.position.copy(sunPos);
  sun.castShadow = true;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  const fill = new THREE.DirectionalLight('#9fbfff', 0.18);
  fill.position.set(40, 30, 60);
  st.scene.add(hemi, sun, sun.target, fill);
  st.lights.push(hemi, sun, sun.target, fill);
  st.sun = sun;
  st.sunOffset = sunPos.clone();
}

function buildStage1(st) {
  const b = st.bounds;
  st.scene.background = new THREE.Color('#1d1612');
  st.scene.fog = null;
  lighting(st, new THREE.Vector3(-30, 62, -60));
  const lamp = new THREE.PointLight('#ffb36b', 260, 70, 1.8);
  lamp.position.set(16, 22, -14);
  st.scene.add(lamp); st.lights.push(lamp);

  // 床：本物の木目（1単位 ≒ 5cm、テクスチャ1枚 ≒ 2m）
  st.add(floor(120, 100, pbr('wood_floor', [3, 2.5], { color: '#e6d2bc', normal: 0.8, roughness: 1.3, env: 0.6 })));
  const wallMat = (w, h, c) => pbr('beige_wall_001', [w / 30, h / 30], { maps: ['diff', 'nor_gl'], color: c, roughness: 0.92, normal: 0.6 });
  const back = st.add(new THREE.Mesh(new THREE.PlaneGeometry(120, 50), wallMat(120, 50, '#f4e2cf')), 0, b.minZ - 1); back.position.y = 25; back.receiveShadow = true;
  const left = st.add(new THREE.Mesh(new THREE.PlaneGeometry(100, 50), wallMat(100, 50, '#f4e2cf')), b.minX - 1, 0, Math.PI / 2); left.position.y = 25; left.receiveShadow = true;
  const right = st.add(new THREE.Mesh(new THREE.PlaneGeometry(100, 50), wallMat(100, 50, '#dfe9f2')), b.maxX + 1, 0, -Math.PI / 2); right.position.y = 25; right.receiveShadow = true;
  st.wall(b.minX - 1, -60, b.minX - 1, 60); st.wall(-80, b.minZ - 1, 80, b.minZ - 1); st.wall(b.maxX + 1, -60, b.maxX + 1, 60);
  const base = P.MAT.matte('#ffffff');
  const bb1 = new THREE.Mesh(P.rbox(120, 2, 0.8, 0.2), base); st.add(bb1, 0, b.minZ - 0.6, 0, 1);
  const bb2 = new THREE.Mesh(P.rbox(0.8, 2, 100, 0.2), base); st.add(bb2, b.minX - 0.6, 0, 0, 1);
  const win = st.add(P.windowFrame(26, 18), -4, b.minZ - 0.8); win.position.y = 24;
  // ドア（ステージ2への廊下）
  const door = new THREE.Mesh(P.rbox(0.6, 22, 12, 0.3), P.MAT.wood('#e0b07a')); st.add(door, b.maxX + 0.7, 14, 0, 11);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), P.MAT.metal('#d8b46a')); st.add(knob, b.maxX + 0.2, 10, 0, 10);

  const rugM = st.add(P.rug(14, 10, ['#d9534f', '#f0c05a', '#3f8f8a', '#7a5ea8', '#f0c05a']), 1, 2);
  rugM.material.normalMap = fabricNormal([6, 6]); rugM.material.normalScale.set(1.5, 1.5); rugM.material.roughness = 1;
  st.surface(1, 2, 14, 10, 0.08, 'ellipse');

  st.add(P.bed(16, 12), -23, 17); st.rect(-23, 17, 8.2, 6.2, 0, 6);
  st.group.add(model('SchoolDesk_01', { width: 18, x: 18, z: -19.5 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) st.rect(18 + sx * 7.6, -19 + sz * 3.1, 0.9, 0.9, 0, 10);
  st.group.add(model('SchoolChair_01', { width: 8, x: 15, z: -10, yaw: Math.PI }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) st.rect(15 + sx * 3, -9.5 + sz * 3, 0.6, 0.6, 0, 8);
  st.add(P.blocks(3, 0), 6, -3); st.circle(6, -3, 2.2, 9);
  st.add(P.blocks(2, 3), -27, -12); st.circle(-27, -12, 2.2, 6);
  st.add(P.teddy(0.9), 28, 7, -1.9); st.circle(28, 7, 4.8, 14);
  st.add(P.toyCar('#e8423b', 0.8), -5, 20.5, 0.3); st.rect(-5, 20.5, 3.8, 2.1, 0.3, 4);
  st.add(P.ballToy(3.5), -28, 3); st.circle(-28, 3, 3.6, 7);
  st.add(P.ringTower(), -11, -19); st.circle(-11, -19, 3.2, 9);
}

function buildStage2(st) {
  const b = st.bounds;
  st.scene.background = new THREE.Color('#1d1612');
  st.scene.fog = null;
  lighting(st, new THREE.Vector3(40, 80, -80), '#ffe6c4', 3.4);
  const lamp = new THREE.PointLight('#ffcf8f', 520, 120, 1.7);
  lamp.position.set(-20, 30, 10);
  st.scene.add(lamp); st.lights.push(lamp);

  st.add(floor(220, 160, pbr('herringbone_parquet', [5.5, 4], { color: '#d9c0a2', normal: 0.9, roughness: 1.6, env: 0.45 })));
  const wallMat = (w, h, c) => pbr('plastered_wall_02', [w / 30, h / 30], { maps: ['diff', 'nor_gl'], color: c, roughness: 0.92, normal: 0.6 });
  const back = st.add(new THREE.Mesh(new THREE.PlaneGeometry(220, 60), wallMat(220, 60, '#efe6da')), 0, b.minZ - 1); back.position.y = 30; back.receiveShadow = true;
  const left = st.add(new THREE.Mesh(new THREE.PlaneGeometry(160, 60), wallMat(160, 60, '#efe6da')), b.minX - 1, 0, Math.PI / 2); left.position.y = 30; left.receiveShadow = true;
  const right = st.add(new THREE.Mesh(new THREE.PlaneGeometry(160, 60), wallMat(160, 60, '#efe6da')), b.maxX + 1, 0, -Math.PI / 2); right.position.y = 30; right.receiveShadow = true;
  st.wall(b.minX - 1, -80, b.minX - 1, 80); st.wall(-100, b.minZ - 1, 100, b.minZ - 1); st.wall(b.maxX + 1, -80, b.maxX + 1, 80);
  // 廊下の仕切り壁
  const pw = new THREE.Mesh(P.rbox(1.5, 30, 40, 0.3), P.MAT.matte('#f6efe4'));
  st.add(pw, -54, -27, 0, 15);
  st.rect(-54, -27, 0.75, 20, 0, 30);
  const sign = new THREE.Mesh(P.rbox(10, 3, 0.3, 0.2), P.MAT.wood('#e0b07a')); st.add(sign, -54, -8, 0, 22);
  for (let i = 0; i < 3; i++) { const w = st.add(P.windowFrame(22, 20), -40 + i * 45, b.minZ - 0.8); w.position.y = 28; }

  const cp = st.add(new THREE.Mesh(P.rbox(56, 0.14, 40, 0.05, 2), pbr('poly_wool_herringbone', [6, 4.5], { maps: ['diff', 'nor_gl'], color: '#9fb0d6', normal: 1.2 })), 5, -8); cp.position.y = 0.07; cp.receiveShadow = true;
  st.surface(5, -8, 28, 20, 0.14, 'rect');

  st.group.add(model('sofa_02', { width: 36, x: 5, z: -40.5 })); st.rect(5, -40, 17, 6, 0, 10);
  st.group.add(model('modern_coffee_table_01', { width: 18, fit: 'z', x: 5, z: -10 }));
  for (const sz of [-1, 1]) st.rect(5, -10 + sz * 8.4, 4.5, 0.6, 0, 6); // V字の脚（両端）。間はルンバが通れる
  st.add(P.tvStand(28, 6), 70, 0, -Math.PI / 2); st.rect(70, 0, 3, 14, 0, 30);
  st.group.add(model('wooden_bookshelf_worn', { width: 16, x: 40, z: -44.3 })); st.rect(40, -44.5, 8.2, 2.2, 0, 18);
  st.add(P.plant(1), -48, -42); st.circle(-48, -42, 3.2, 10);
  st.add(P.plant(1.1), 68, -36); st.circle(68, -36, 3.4, 10);
  st.add(P.plant(0.9), -68, 44); st.circle(-68, 44, 3, 10);
  st.group.add(model('ArmChair_01', { width: 15, x: 48, z: 26, yaw: -2.3 })); st.rect(48, 26, 7.5, 6.5, -2.3, 10);
  st.add(P.toyCar('#1c7ed6', 0.9), -30, 44, 1.2); st.rect(-30, 44, 4.2, 2.4, 1.2, 4);
  st.add(P.blocks(4, 2), 30, 12); st.circle(30, 12, 2.4, 12);
  st.add(P.teddy(0.7), -64, 30, 1.0); st.circle(-64, 30, 3.6, 10);
  st.add(P.dock(), 62, -44.5); st.rect(62, -44.5, 3.2, 1.2, 0, 3, { roomba: false });
}

function floor(w, d, mat) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  f.rotation.x = -Math.PI / 2;
  f.receiveShadow = true;
  return f;
}

export function createStage(id, scene, physics) {
  const def = STAGES[id];
  const st = new StageRuntime(def, scene, physics);
  def.build(st);
  return st;
}


// ステージのコースは CPU（ゲーム側）が設計した固定コース。
// （自由設計用の suggested は将来のエンドレスモード用に残している）
STAGES[1].course = STAGES[1].suggested[0].pts;
STAGES[2].course = STAGES[2].suggested[1].pts;
