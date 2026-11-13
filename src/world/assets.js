import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// 外部素材（Poly Haven / CC0）の読み込み。public/assets 以下。
const BASE = `${import.meta.env.BASE_URL}assets/`;
const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const cache = new Map();

function tex(path, srgb, repeat) {
  const t = texLoader.load(BASE + path);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

/** PBR 素材（diff / nor_gl / rough）。repeat はテクスチャを何回繰り返すか */
export function pbr(name, repeat, opts = {}) {
  const has = (m) => (opts.maps || ['diff', 'nor_gl', 'rough']).includes(m);
  const m = new THREE.MeshStandardMaterial({
    map: has('diff') ? tex(`textures/${name}/${name}_diff_1k.jpg`, true, repeat) : null,
    normalMap: has('nor_gl') ? tex(`textures/${name}/${name}_nor_gl_1k.jpg`, false, repeat) : null,
    roughnessMap: has('rough') ? tex(`textures/${name}/${name}_rough_1k.jpg`, false, repeat) : null,
    roughness: opts.roughness ?? 1,
    envMapIntensity: opts.env ?? 1,
    metalness: 0,
    color: opts.color || '#ffffff',
  });
  if (m.normalMap) m.normalScale.set(opts.normal ?? 1, opts.normal ?? 1);
  return m;
}

/** 布の凹凸だけを使う（色はキャンバスで描いた模様） */
export function fabricNormal(repeat) { return tex('textures/cotton_jersey/cotton_jersey_nor_gl_1k.jpg', false, repeat); }

/**
 * GLB/GLTF モデルを読み込んで、横幅 width に合わせて置く。
 * 返り値は Group（読み込み完了後に中身が入る）
 */
export function model(name, { width, x = 0, z = 0, yaw = 0, y = 0, fit = 'x' }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  const url = `${BASE}models/${name}/${name}.gltf`;
  let p = cache.get(url);
  if (!p) { p = new Promise((res, rej) => gltfLoader.load(url, (gl) => res(gl.scene), undefined, rej)); cache.set(url, p); }
  p.then((src) => {
    const m = src.clone(true);
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m, true);
    const size = bb.getSize(new THREE.Vector3());
    const s = width / (fit === 'z' ? size.z : size.x);
    // 中心を原点・底を床に合わせてから拡大
    const wrap = new THREE.Group();
    m.position.x -= (bb.min.x + bb.max.x) / 2; m.position.y -= bb.min.y; m.position.z -= (bb.min.z + bb.max.z) / 2;
    wrap.add(m);
    wrap.scale.setScalar(s);
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 1; } });
    g.add(wrap);
    g.userData.size = size.clone().multiplyScalar(s);
    g.dispatchEvent({ type: 'loaded' });
  }).catch((e) => console.warn('model load failed', name, e));
  return g;
}
