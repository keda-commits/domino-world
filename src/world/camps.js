import * as THREE from 'three';
import { MAT, rbox, shadow } from './props.js';
import { ITEM_MODELS, ITEM_KIND, ITEM_TAG } from './itemModels.js';

/**
 * 獲得物の行き先（Ver.0.4）
 * builders：建設隊の待機所／logistics：物流拠点／safety：防災詰所／machines：機械置き場／storage：倉庫（収納棚）
 * 看板と床の目印を置き、人は手が空くと自分の待機所へ戻る。小型パーツは収納棚に並ぶ。
 */
export const CAMP_INFO = {
  builders: { label: '建設隊 待機所', color: '#ff8c2a', icon: '👷' },
  logistics: { label: '物流拠点', color: '#3b8cff', icon: '📦' },
  safety: { label: '防災詰所', color: '#1f5fd0', icon: '🦺' },
  machines: { label: '機械置き場', color: '#868e96', icon: '🏗' },
  storage: { label: '倉庫（収納棚）', color: '#9c6b3a', icon: '🗄' },
};
// 役割 → 待機所
export const ROLE_CAMP = { builder: 'builders', carrier: 'logistics', collector: 'logistics', stopperCrew: 'safety', restorer: 'safety', guard: 'safety', soldier: 'safety', chief: 'builders', architect: 'builders', wrecker: 'logistics' };
// 小型パーツ（収納棚に並ぶもの）
export const SMALL_PARTS = ['boots', 'basket', 'level', 'clover', 'barricade', 'footbridge', 'gate'];

function labelTexture(text, color, icon) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#fffaf0'; x.fillRect(0, 0, 512, 160);
  x.fillStyle = color; x.fillRect(0, 0, 512, 26); x.fillRect(0, 134, 512, 26);
  x.fillStyle = '#2b2b2b'; x.font = 'bold 64px "M PLUS Rounded 1c", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`${icon} ${text}`, 256, 82);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** 看板＋床の丸い目印 */
export function campMarker(kind, r = 3.2) {
  const info = CAMP_INFO[kind];
  const g = new THREE.Group();
  const mat = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshStandardMaterial({ color: info.color, roughness: 0.9, transparent: true, opacity: 0.28, depthWrite: false }));
  mat.rotation.x = -Math.PI / 2; mat.position.y = 0.02; g.add(mat);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48), new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.7, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.025; g.add(ring);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), MAT.wood('#b98a55'));
  post.position.set(-r * 0.75, 1.2, -r * 0.75); g.add(post);
  const board = new THREE.Mesh(rbox(2.6, 0.82, 0.08, 0.04), [MAT.wood('#b98a55'), MAT.wood('#b98a55'), MAT.wood('#b98a55'), MAT.wood('#b98a55'), new THREE.MeshStandardMaterial({ map: labelTexture(info.label, info.color, info.icon), roughness: 0.7 }), MAT.wood('#b98a55')]);
  board.position.set(-r * 0.75, 2.3, -r * 0.75 + 0.06); g.add(board);
  shadow(g);
  g.userData.camp = kind;
  return g;
}

/**
 * 小人の暮らす所（Ver.0.6）：床に丸い目印を置くだけだった待機所を、小人サイズの「村」にする。
 * 家具の脚元や部屋の隅に、小人が自分たちで作った小さな生活空間。素材は積み木・糸巻き・布・ボタンなどのおもちゃ。
 * 小人の背丈は約1.1（≒5.5cm）。家の高さ2.4、戸口0.95、ベンチの座面0.35、ハンモックの高さ0.55。
 * 返り値の spots は、遊び・休憩の行動（campLife）が使う場所。obstacles は経路探索で避ける物。
 */
const VILLAGE_DECOR = {
  builders: 'workbench', logistics: 'crates', safety: 'firstaid', machines: 'workbench',
};
export function campVillage(kind) {
  const info = CAMP_INFO[kind];
  const g = new THREE.Group();
  const col = info.color;
  const wood = MAT.wood('#d9a066'), darkWood = MAT.wood('#8a5a30');
  // 地面：小人が敷いたハンカチのパッチワーク（四角い布をつなぎ合わせた縄張り。丸い目印ではない）
  const PATCH = ['#f3d9b1', '#e9c46a', '#f4a261', '#e9d8b4', '#cdb4db', '#a8dadc'];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const pc = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.02, 2.25), MAT.fabric(PATCH[(i * 3 + j * 5) % PATCH.length]));
    pc.position.set(-3.4 + i * 2.27, 0.012, -3.4 + j * 2.27); pc.receiveShadow = true; g.add(pc);
  }
  for (let k = 0; k < 5; k++) for (const vert of [0, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(vert ? 0.03 : 9.1, 0.012, vert ? 9.1 : 0.03), MAT.matte('#fffaf0')); st.position.set(vert ? -4.53 + k * 2.27 : 0, 0.026, vert ? 0 : -4.53 + k * 2.27); g.add(st); }
  const felt = g.children[0], ring = g.children[1];
  // 家（積み木の家）：奥の左
  const house = new THREE.Group(); house.position.set(-2.2, 0, -2.3);
  house.add(new THREE.Mesh(rbox(2.4, 1.6, 2.0, 0.08), MAT.plastic('#fff4e0')).translateY(0.8));
  // 切妻屋根（2枚の板）と、三角の妻壁
  for (const sx of [-1, 1]) { const r = new THREE.Mesh(rbox(1.5, 0.12, 2.3, 0.04), MAT.plastic(col)); r.position.set(sx * 0.62, 1.95, 0); r.rotation.z = -sx * 0.62; house.add(r); }
  const gable = new THREE.Shape([new THREE.Vector2(-1.2, 0), new THREE.Vector2(1.2, 0), new THREE.Vector2(0, 0.85)]);
  for (const z of [-0.99, 0.99]) { const gm = new THREE.Mesh(new THREE.ShapeGeometry(gable), MAT.plastic('#fff4e0')); gm.material.side = THREE.DoubleSide; gm.position.set(0, 1.6, z); house.add(gm); }
  house.add(new THREE.Mesh(rbox(0.7, 0.95, 0.06, 0.05), MAT.wood('#a0522d')).translateY(0.48).translateZ(1.02)); // 戸口（小人が入れる高さ）
  house.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), MAT.metal('#ffd43b')).translateX(0.22).translateY(0.5).translateZ(1.07));
  for (const x of [-0.75, 0.75]) { const w = new THREE.Mesh(rbox(0.45, 0.45, 0.06, 0.04), new THREE.MeshPhysicalMaterial({ color: '#a5d8ff', roughness: 0.1, transmission: 0.3 })); w.position.set(x, 1.05, 1.02); house.add(w); const f = new THREE.Mesh(rbox(0.52, 0.06, 0.08, 0.02), darkWood); f.position.set(x, 0.8, 1.04); house.add(f); }
  const chim = new THREE.Mesh(rbox(0.3, 0.7, 0.3, 0.04), MAT.plastic('#c92a2a')); chim.position.set(0.6, 2.4, -0.3); house.add(chim);
  // 看板（家の前）
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), darkWood); post.position.set(1.5, 0.75, 1.3); house.add(post);
  const board = new THREE.Mesh(rbox(1.9, 0.6, 0.06, 0.03), [darkWood, darkWood, darkWood, darkWood, new THREE.MeshStandardMaterial({ map: labelTexture(info.label, col, info.icon), roughness: 0.7 }), darkWood]);
  board.position.set(1.5, 1.45, 1.34); house.add(board);
  g.add(house);

  // 小さな庭：奥の右。ボタンの花とつまようじの柵
  const garden = new THREE.Group(); garden.position.set(2.3, 0, -2.4);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.08, 20), MAT.fabric('#5c940d')); soil.position.y = 0.04; garden.add(soil);
  const FL = ['#ff6b6b', '#ffd43b', '#f783ac', '#74c0fc', '#ffffff'];
  for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 0.25 + (i % 3) * 0.3; const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5), MAT.plastic('#2b8a3e')); stem.position.set(Math.cos(a) * r, 0.25, Math.sin(a) * r); garden.add(stem); const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 12), MAT.plastic(FL[i % 5])); btn.position.set(Math.cos(a) * r, 0.44, Math.sin(a) * r); btn.rotation.x = 0.4; garden.add(btn); }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const pk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), MAT.wood('#f1dfc0')); pk.position.set(Math.cos(a) * 1.25, 0.2, Math.sin(a) * 1.25); garden.add(pk); }
  const wateringCan = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.25, 10), MAT.plastic('#4dabf7')); wateringCan.position.set(1.0, 0.13, 1.0); garden.add(wateringCan);
  g.add(garden);

  // ハンモック：手前の右。2本の柱（鉛筆）の間に布
  const ham = new THREE.Group(); ham.position.set(2.7, 0, 1.6);
  for (const z of [-1.0, 1.0]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), MAT.plastic(z < 0 ? '#fab005' : '#40c057')); p.position.set(0, 0.6, z); ham.add(p); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), MAT.wood('#f1dfc0')); tip.position.set(0, 1.29, z); ham.add(tip); }
  // 布：両端の柱から垂れ下がった形（まん中が一番低い）
  const clothM = MAT.fabric('#e64980');
  for (let i = 0; i < 10; i++) {
    const z0 = -0.92 + (i / 10) * 1.84, z1 = -0.92 + ((i + 1) / 10) * 1.84;
    const y = (z) => 0.5 + 0.38 * (z / 0.92) ** 2;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, Math.hypot(z1 - z0, y(z1) - y(z0)) + 0.01), clothM);
    seg.position.set(0, (y(z0) + y(z1)) / 2, (z0 + z1) / 2); seg.rotation.x = -Math.atan2(y(z1) - y(z0), z1 - z0); ham.add(seg);
  }
  for (const z of [-0.96, 0.96]) { const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), MAT.matte('#f8f0e3')); rope.position.set(0, 1.03, z); ham.add(rope); }
  g.add(ham);

  // 休憩所：手前の左。糸巻きのテーブルと、積み木のベンチ2つ
  const rest = new THREE.Group(); rest.position.set(-2.4, 0, 1.7);
  const spool = new THREE.Group();
  spool.add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 18), wood).translateY(0.04));
  spool.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 14), MAT.fabric('#4dabf7')).translateY(0.33));
  spool.add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 18), wood).translateY(0.62));
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.12, 10), MAT.plastic('#ffffff')); cup.position.set(0.2, 0.72, 0.1); spool.add(cup);
  rest.add(spool);
  for (const x of [-1.15, 1.15]) { const b = new THREE.Mesh(rbox(0.45, 0.35, 1.1, 0.06), MAT.plastic(x < 0 ? '#ff8787' : '#ffd43b')); b.position.set(x, 0.18, 0); rest.add(b); }
  g.add(rest);

  // 遊び道具：ボール（ビーズ玉）と、道具置き場（役目ごと）
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), MAT.plastic('#ff922b'));
  ball.position.set(0.2, 0.17, 0.3); g.add(ball);
  const deco = new THREE.Group(); deco.position.set(0, 0, -3.3);
  const decoKind = VILLAGE_DECOR[kind];
  if (decoKind === 'workbench') {
    deco.add(new THREE.Mesh(rbox(1.4, 0.08, 0.6, 0.03), wood).translateY(0.55));
    for (const x of [-0.6, 0.6]) deco.add(new THREE.Mesh(rbox(0.08, 0.55, 0.5, 0.02), darkWood).translateX(x).translateY(0.27));
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.01, 0.4), MAT.matte('#4dabf7')); bp.position.set(-0.2, 0.6, 0); deco.add(bp);
    const hm = new THREE.Mesh(rbox(0.08, 0.08, 0.35, 0.02), MAT.metal('#868e96')); hm.position.set(0.4, 0.64, 0); deco.add(hm);
  } else if (decoKind === 'crates') {
    for (const [x, y] of [[-0.4, 0.25], [0.35, 0.25], [0, 0.73]]) { const c = new THREE.Mesh(rbox(0.6, 0.48, 0.5, 0.04), wood); c.position.set(x, y, 0); deco.add(c); }
  } else {
    const kit = new THREE.Mesh(rbox(0.7, 0.45, 0.45, 0.06), MAT.plastic('#ffffff')); kit.position.y = 0.23; deco.add(kit);
    for (const [w, h] of [[0.36, 0.1], [0.1, 0.36]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), MAT.plastic('#e03131')); c.position.set(0, 0.25, 0.235); deco.add(c); }
  }
  g.add(deco);
  shadow(g);
  felt.castShadow = false; ring.castShadow = false;
  g.userData.camp = kind;
  // 行動に使う場所（村の中心からの相対位置）
  const spots = {
    ball, ballHome: new THREE.Vector3(0.2, 0.17, 0.3),
    playA: new THREE.Vector3(-0.6, 0, 0.0), playB: new THREE.Vector3(1.3, 0, 0.9),
    hammock: new THREE.Vector3(2.7, 0.55, 2.05), hammockSide: new THREE.Vector3(1.75, 0, 1.6), hammockYaw: 0,
    seats: [new THREE.Vector3(-3.55, 0.35, 1.7), new THREE.Vector3(-1.25, 0.35, 1.7)],
    door: new THREE.Vector3(-2.2, 0, -1.0), greet: new THREE.Vector3(-0.6, 0, -0.6),
  };
  const obstacles = [
    { x: -2.2, z: -2.3, hw: 1.3, hd: 1.1 }, // 家
    { x: 2.3, z: -2.4, hw: 1.3, hd: 1.3 }, // 庭
    { x: -2.4, z: 1.7, hw: 0.7, hd: 0.7 }, // テーブル
    { x: 2.7, z: 1.6, hw: 0.35, hd: 1.15 }, // ハンモック
    { x: 0, z: -3.3, hw: 0.8, hd: 0.4 }, // 道具置き場
  ];
  return { group: g, spots, obstacles };
}

/** 道具の展示棚（Ver.0.6）：手に入れた道具を「実物の模型」で並べる。
 *  中段＝持っているだけで効く道具（ブーツ・カゴ・水平器・四つ葉）／下段＝置いて使う・自動で働く道具（歩道橋・バリケード・遮断ゲート） */
const EQUIP_SLOTS = { boots: -2.5, basket: -0.85, level: 0.85, clover: 2.5 };
const PLACE_SLOTS = { footbridge: -2.3, barricade: 0, gate: 2.3 };
function tagTexture(emoji, text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#fffaf0'; x.fillRect(0, 0, 256, 96); x.fillStyle = color; x.fillRect(0, 0, 256, 10);
  x.font = '48px sans-serif'; x.textBaseline = 'middle'; x.fillText(emoji, 8, 54);
  x.fillStyle = '#2b2b2b'; let fs = 30; do { x.font = `bold ${fs}px "M PLUS Rounded 1c", sans-serif`; fs -= 2; } while (x.measureText(text).width > 184 && fs > 16); x.fillText(text, 64, 56);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function headerTexture(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 512, 64);
  x.fillStyle = '#ffffff'; x.font = 'bold 36px "M PLUS Rounded 1c", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export class StorageShelf {
  constructor(scene, spot) {
    const g = (this.group = new THREE.Group());
    const wood = MAT.wood('#a77445');
    for (const y of [0.1, 1.5, 2.9]) { const s = new THREE.Mesh(rbox(7, 0.16, 1.6, 0.04), wood); s.position.y = y; g.add(s); }
    for (const x of [-3.4, 3.4]) { const s = new THREE.Mesh(rbox(0.16, 3.2, 1.6, 0.04), wood); s.position.set(x, 1.5, 0); g.add(s); }
    g.add(new THREE.Mesh(rbox(7, 3.2, 0.1, 0.02), wood).translateY(1.5).translateZ(-0.75));
    // 段の見出し（棚板の前のふち）
    // 段の見出し：それぞれの段の奥の板（道具の後ろ、上の方）に貼る
    for (const [y, text, col] of [[2.62, '持っているだけで効く道具', '#e8590c'], [0.98, '置いて使う・自動で働く道具', '#1971c2']]) {
      const h = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.36), new THREE.MeshStandardMaterial({ map: headerTexture(text, col), roughness: 0.8 }));
      h.position.set(0, y, -0.69); g.add(h);
    }
    shadow(g);
    g.position.set(spot.x, 0, spot.z); g.rotation.y = spot.yaw || 0;
    scene.add(g);
    this.scene = scene;
    this.items = new Map();
  }
  /** 持っている道具を、実物の模型で棚に並べる */
  sync(game) {
    const want = [...Object.entries(EQUIP_SLOTS).map(([k, v]) => [k, v, 1.58]), ...Object.entries(PLACE_SLOTS).map(([k, v]) => [k, v, 0.18])];
    for (const [id, x, y] of want) {
      if (this.items.has(id) || !(game.level(id) > 0) || !ITEM_MODELS[id]) continue;
      const o = ITEM_MODELS[id]();
      const box = new THREE.Group(); box.add(o);
      box.position.set(x, y, 0.05);
      const [emo, text] = ITEM_TAG[id] || ['', ''];
      const kind = ITEM_KIND[id];
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.43), new THREE.MeshStandardMaterial({ map: tagTexture(emo, text, kind === 'place' ? '#1971c2' : kind === 'auto' ? '#2f9e44' : '#e8590c'), roughness: 0.8 }));
      tag.scale.setScalar(0.85); tag.position.set(0, -0.06, 0.82); box.add(tag); // 棚板の前のふち（道具の下）
      this.group.add(box);
      this.items.set(id, box);
    }
  }
  /** 新しい道具の位置（ガチャのあとカメラで見せる） */
  posOf(id) { const b = this.items.get(id); return b ? b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5, 0)) : this.group.position.clone(); }
  dispose() { this.scene.remove(this.group); }
}

/** ガチャ専用の展示スペース（低い柵と床のマット） */
export function gachaStage() {
  const g = new THREE.Group();
  const mat = new THREE.Mesh(rbox(12, 0.05, 11, 0.02), new THREE.MeshStandardMaterial({ color: '#f6d6e8', roughness: 0.9 }));
  mat.position.set(0, 0.03, 4.5); g.add(mat);
  const rail = MAT.plastic('#ff7aa8');
  for (const [x, z, w, d] of [[-6, 4.5, 0.2, 11], [6, 4.5, 0.2, 11]]) { const m = new THREE.Mesh(rbox(w, 0.6, d, 0.06), rail); m.position.set(x, 0.3, z); g.add(m); }
  shadow(g);
  return g;
}
