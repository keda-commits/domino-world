import * as THREE from 'three';
import { CFG } from '../config.js';
import { MAT, rbox, shadow } from './props.js';
import { footbridgeMesh, barricadeMesh } from './devices.js';

/**
 * 獲得アイテムの実物展示（Ver.0.6）
 * 以前は色違いの箱を並べていたが、何を手に入れたのか分からないので、アイテムごとに専用の模型を作る。
 * それぞれ「何か」だけでなく「どう役立つか」が見える小さな情景（ジオラマ）にする：
 *   作業ブーツ＝赤い長靴と足あと／運搬カゴ＝ドミノがいっぱい入った背負いかご／水平器＝まっすぐ立った2枚のドミノに当てた水平器
 *   四つ葉＝鉢植えのクローバー／歩道橋＝ドミノの列をまたぐ橋と渡る小人／バリケード＝ミニカーを止める柵
 *   自動遮断ゲート＝ドミノの列の切れ目に下りる遮断機
 * 大きさは小人（背丈1.1）が使う道具の大きさ。棚の1区画（幅1.3×高さ1.3）に収まる。
 */
const dominoGeo = new THREE.BoxGeometry(CFG.dominoW, CFG.dominoH, CFG.dominoT);
const DCOL = ['#e8423b', '#ffb000', '#2f9e44', '#1c7ed6', '#7048e8'];
const m = (geo, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); return o; };
const plastic = (c) => MAT.plastic(c);

/** 小さな小人の人形（展示用。顔の向きは +z） */
function miniGnome(hat = '#ff8c2a', body = '#3b5bdb') {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.17, 0.19, 0.34, 12), plastic(body), 0, 0.42, 0));
  g.add(m(new THREE.SphereGeometry(0.17, 14, 10), plastic('#ffd8b5'), 0, 0.78, 0));
  g.add(m(new THREE.ConeGeometry(0.18, 0.32, 12), plastic(hat), 0, 1.0, 0));
  for (const x of [-0.08, 0.08]) g.add(m(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 6), plastic('#343a40'), x, 0.13, 0));
  return g;
}

export const ITEM_MODELS = {
  /** 作業ブーツ：赤い長靴1足と、速く歩いた足あと */
  boots() {
    const g = new THREE.Group(), red = plastic('#e03131'), sole = MAT.matte('#3b2a20');
    for (const [x, rot] of [[-0.24, 0.15], [0.24, -0.1]]) {
      const b = new THREE.Group();
      b.add(m(rbox(0.32, 0.62, 0.34, 0.1), red, 0, 0.36, 0));
      b.add(m(rbox(0.34, 0.2, 0.62, 0.08), red, 0, 0.12, 0.13));
      b.add(m(rbox(0.36, 0.06, 0.66, 0.03), sole, 0, 0.03, 0.13));
      b.add(m(new THREE.TorusGeometry(0.17, 0.035, 6, 16).rotateX(Math.PI / 2), plastic('#fff3bf'), 0, 0.66, 0));
      b.position.x = x; b.rotation.y = rot; g.add(b);
    }
    // 速く歩いた足あと（後ろへ続く）＋風のすじ
    for (let i = 0; i < 3; i++) g.add(m(new THREE.BoxGeometry(0.16, 0.01, 0.26), MAT.matte('#8a5a30'), (i % 2 ? 0.14 : -0.14), 0.006, -0.5 - i * 0.32));
    for (const y of [0.3, 0.48]) g.add(m(rbox(0.05, 0.05, 0.5, 0.02), plastic('#a5d8ff'), -0.55, y, -0.15));
    return shadow(g);
  },
  /** 運搬カゴ：背負いひも付きのかごに、ドミノがたくさん */
  basket() {
    const g = new THREE.Group(), wick = MAT.wood('#c8913f');
    const body = m(new THREE.CylinderGeometry(0.46, 0.36, 0.7, 16, 1, true), wick, 0, 0.38, 0); body.material = wick.clone(); body.material.side = THREE.DoubleSide; g.add(body);
    for (let i = 0; i < 4; i++) g.add(m(new THREE.TorusGeometry(0.36 + i * 0.033, 0.02, 4, 20).rotateX(Math.PI / 2), MAT.wood('#9c6b2f'), 0, 0.08 + i * 0.2, 0));
    g.add(m(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16), wick, 0, 0.04, 0));
    for (let i = 0; i < 9; i++) { const d = m(dominoGeo, plastic(DCOL[i % 5]), -0.24 + (i % 3) * 0.24, 0.62 + Math.floor(i / 3) * 0.04, -0.15 + Math.floor(i / 3) * 0.15); d.scale.setScalar(0.42); d.rotation.z = (i % 2 ? 0.1 : -0.12); g.add(d); }
    for (const x of [-0.18, 0.18]) { const s = m(rbox(0.08, 0.8, 0.04, 0.02), MAT.matte('#5c3d1e'), x, 0.42, -0.44); s.rotation.x = 0.1; g.add(s); }
    return shadow(g);
  },
  /** 水平器：まっすぐに立った2枚のドミノの上に、緑の気泡が真ん中の水平器 */
  level() {
    const g = new THREE.Group();
    for (const x of [-0.42, 0.42]) { const d = m(dominoGeo, plastic(x < 0 ? '#1c7ed6' : '#ffb000'), x, 0.36, 0); d.scale.set(0.9, 0.72, 0.9); g.add(d); }
    g.add(m(rbox(1.25, 0.14, 0.18, 0.03), plastic('#ffd43b'), 0, 0.8, 0));
    const vial = m(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 12).rotateZ(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#b2f2bb', transmission: 0.5, roughness: 0.1 }), 0, 0.88, 0.0); g.add(vial);
    g.add(m(new THREE.SphereGeometry(0.035, 8, 6), plastic('#ffffff'), 0, 0.92, 0.0));
    for (const x of [-0.06, 0.06]) g.add(m(new THREE.BoxGeometry(0.01, 0.13, 0.13), MAT.matte('#212529'), x, 0.88, 0));
    // 床のまっすぐな線（並びがそろう）
    g.add(m(new THREE.BoxGeometry(1.2, 0.01, 0.04), plastic('#2f9e44'), 0, 0.006, 0.25));
    return shadow(g);
  },
  /** 四つ葉の加護：小さな鉢の四つ葉のクローバーと、きらきら */
  clover() {
    const g = new THREE.Group(), leaf = plastic('#2f9e44');
    g.add(m(new THREE.CylinderGeometry(0.28, 0.22, 0.34, 14), plastic('#d9480f'), 0, 0.17, 0));
    g.add(m(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 14), MAT.matte('#5c3d1e'), 0, 0.33, 0));
    g.add(m(new THREE.CylinderGeometry(0.02, 0.025, 0.45, 6), leaf, 0, 0.55, 0));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const l = m(new THREE.SphereGeometry(0.15, 12, 8), leaf, Math.cos(a) * 0.15, 0.8, Math.sin(a) * 0.15); l.scale.set(1, 0.25, 0.75); l.rotation.y = -a; g.add(l);
    }
    for (const [x, y, z] of [[0.35, 1.0, 0.1], [-0.3, 1.1, -0.1], [0.1, 1.2, 0.25]]) g.add(m(new THREE.OctahedronGeometry(0.06), new THREE.MeshStandardMaterial({ color: '#fff3bf', emissive: '#ffd43b', emissiveIntensity: 0.8 }), x, y, z));
    return shadow(g);
  },
  /** 歩道橋（試作B：採用）：ドミノの列の上をまたぐ橋と、渡っている小人 */
  footbridge() {
    const g = new THREE.Group();
    const br = footbridgeMesh(7.5, 2.0); br.scale.setScalar(0.2); br.rotation.y = Math.PI / 2; g.add(br);
    for (let i = 0; i < 5; i++) { const d = m(dominoGeo, plastic(DCOL[i]), -0.6 + i * 0.3, 0.14, 0); d.scale.setScalar(0.28); g.add(d); }
    const gn = miniGnome(); gn.scale.setScalar(0.4); gn.position.set(0, 0.41, 0); gn.rotation.y = 0; g.add(gn);
    return shadow(g);
  },
  /** 歩道橋（試作A：不採用）：橋だけ */
  footbridgeA() { const g = new THREE.Group(); const br = footbridgeMesh(7.5, 2.0); br.scale.setScalar(0.16); g.add(br); return shadow(g); },
  /** バリケード：暴走ミニカーを止めている柵 */
  barricade() {
    const g = new THREE.Group();
    const b = barricadeMesh(); b.scale.setScalar(0.2); g.add(b);
    const car = new THREE.Group();
    car.add(m(rbox(0.5, 0.18, 0.3, 0.06), plastic('#e8423b'), 0, 0.14, 0));
    car.add(m(rbox(0.26, 0.12, 0.26, 0.05), plastic('#a5d8ff'), -0.03, 0.27, 0));
    for (const [x, z] of [[-0.16, -0.15], [0.16, -0.15], [-0.16, 0.15], [0.16, 0.15]]) car.add(m(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10).rotateX(Math.PI / 2), MAT.matte('#212529'), x, 0.07, z));
    car.position.set(0, 0, 0.45); car.rotation.y = Math.PI / 2 + 0.3; g.add(car);
    g.add(m(new THREE.OctahedronGeometry(0.08), new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffd43b', emissiveIntensity: 0.7 }), 0.2, 0.45, 0.25));
    return shadow(g);
  },
  /** 自動遮断ゲート：ドミノの列の切れ目に下りた遮断機 */
  gate() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) { const d = m(dominoGeo, plastic(DCOL[i]), -0.6 + i * 0.3 + (i > 2 ? 0.15 : 0), 0.15, 0); d.scale.setScalar(0.3); g.add(d); }
    g.add(m(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), plastic('#fab005'), 0.13, 0.3, -0.35));
    const arm = new THREE.Group(); arm.position.set(0.13, 0.55, -0.35);
    for (let i = 0; i < 4; i++) arm.add(m(new THREE.BoxGeometry(0.06, 0.05, 0.16), plastic(i % 2 ? '#212529' : '#ffd43b'), 0, 0, 0.1 + i * 0.16));
    arm.rotation.x = 0.55; g.add(arm);
    g.add(m(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff6b6b', emissive: '#ff2020', emissiveIntensity: 1 }), 0.13, 0.65, -0.35));
    return shadow(g);
  },
};
/** 置いて使う道具（配置型）か、持っているだけで効く道具（能力強化型）か */
export const ITEM_KIND = { footbridge: 'place', barricade: 'place', gate: 'auto', boots: 'equip', basket: 'equip', level: 'equip', clover: 'luck' };
/** 展示の札：絵文字＋ひとことの効き目（名前を読まなくても分かる絵を主に） */
export const ITEM_TAG = {
  boots: ['👢', 'はやく歩ける'], basket: ['🧺', 'たくさん運べる'], level: ['📏', 'まっすぐ並ぶ'], clover: ['🍀', 'いいことが起きる'],
  footbridge: ['🌉', '列の上を渡れる'], barricade: ['🚧', '暴走を止める'], gate: ['🚦', '事故を止める'],
};
