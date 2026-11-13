import * as THREE from 'three';
import { MAT, rbox, shadow } from './props.js';

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
export const ROLE_CAMP = { builder: 'builders', carrier: 'logistics', collector: 'logistics', stopperCrew: 'safety', restorer: 'safety', guard: 'safety' };
// 小型パーツ（収納棚に並ぶもの）
export const SMALL_PARTS = ['boots', 'basket', 'level', 'clover', 'magnet', 'rewind', 'bell', 'barricade', 'sensor'];

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

/** 倉庫の収納棚：小型パーツの箱が並ぶ */
export class StorageShelf {
  constructor(scene, spot) {
    const g = (this.group = new THREE.Group());
    const wood = MAT.wood('#a77445');
    for (const y of [0.1, 1.5, 2.9]) { const s = new THREE.Mesh(rbox(7, 0.16, 1.6, 0.04), wood); s.position.y = y; g.add(s); }
    for (const x of [-3.4, 3.4]) { const s = new THREE.Mesh(rbox(0.16, 3.2, 1.6, 0.04), wood); s.position.set(x, 1.5, 0); g.add(s); }
    g.add(new THREE.Mesh(rbox(7, 3.2, 0.1, 0.02), wood).translateY(1.5).translateZ(-0.75));
    this.boxes = [];
    shadow(g);
    g.position.set(spot.x, 0, spot.z); g.rotation.y = spot.yaw || 0;
    scene.add(g);
    this.scene = scene;
    this.items = new Map();
  }
  /** 持っている小型パーツを棚に並べる */
  sync(game) {
    const owned = SMALL_PARTS.filter((id) => game.level(id) > 0);
    owned.forEach((id, i) => {
      if (this.items.has(id)) return;
      const col = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc', '#ffa94d', '#f783ac', '#63e6be', '#e599f7'][i % 9];
      const box = new THREE.Mesh(rbox(1.2, 1.0, 1.0, 0.12), MAT.plastic(col));
      const slot = i;
      box.position.set(-2.5 + (slot % 5) * 1.25, 0.18 + 0.5 + Math.floor(slot / 5) * 1.4, 0.1);
      box.castShadow = true;
      this.group.add(box);
      this.items.set(id, box);
    });
  }
  /** 新しい箱の位置（ガチャのあとカメラで見せる） */
  posOf(id) { const b = this.items.get(id); return b ? b.getWorldPosition(new THREE.Vector3()) : this.group.position.clone(); }
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
