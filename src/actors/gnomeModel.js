import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from '../config.js';

// 小人とストッパーズの見た目（頭・胴・手足）。パーツ毎に頂点カラーをつけて1メッシュにまとめる。
const SKIN = '#ffd2b0';

function colored(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const at = (geo, x, y, z) => { geo.translate(x, y, z); return geo; };
const half = (r, w = 18) => new THREE.SphereGeometry(r, w, 10, 0, Math.PI * 2, 0, Math.PI / 2);

export const ROLE_STYLE = {
  builder: { body: '#ff8c2a', hat: '#ffd21f', leg: '#3d4f8a', kind: 'hardhat' },
  carrier: { body: '#3b8cff', hat: '#2a5fd6', leg: '#4a3b2f', kind: 'cap' },
  collector: { body: '#45b85c', hat: '#e2453c', leg: '#5a4632', kind: 'gnome' },
  // ストッパーズ：青いヘルメットと安全装備
  stopperCrew: { body: '#1f5fd0', hat: '#1f6fe0', leg: '#1b2a4a', kind: 'stopper', vest: '#ffd21f' },
  restorer: { body: '#1f5fd0', hat: '#1f6fe0', leg: '#1b2a4a', kind: 'stopper', vest: '#ffffff', cross: true },
  guard: { body: '#16295a', hat: '#1f6fe0', leg: '#101a33', kind: 'stopper', vest: '#ff7a1a', badge: true },
  watchman: { body: '#1f5fd0', hat: '#1f6fe0', leg: '#1b2a4a', kind: 'stopper', vest: '#9be3ff' },
};

const cache = {};
export const gnomeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });

export function gnomeGeometries(role) {
  if (cache[role]) return cache[role];
  const st = ROLE_STYLE[role];
  const parts = [
    colored(new THREE.SphereGeometry(0.19, 20, 14), SKIN),
    colored(at(new THREE.SphereGeometry(0.032, 8, 6), -0.065, 0.025, 0.172), '#1d1410'),
    colored(at(new THREE.SphereGeometry(0.032, 8, 6), 0.065, 0.025, 0.172), '#1d1410'),
    colored(at(new THREE.SphereGeometry(0.012, 6, 4), -0.058, 0.035, 0.2), '#ffffff'),
    colored(at(new THREE.SphereGeometry(0.012, 6, 4), 0.072, 0.035, 0.2), '#ffffff'),
    colored(at(new THREE.SphereGeometry(0.045, 8, 6), 0, -0.025, 0.19), '#ff9580'),
    colored(at(new THREE.SphereGeometry(0.035, 8, 6), -0.11, -0.05, 0.135), '#ffaaa0'),
    colored(at(new THREE.SphereGeometry(0.035, 8, 6), 0.11, -0.05, 0.135), '#ffaaa0'),
  ];
  if (st.kind === 'hardhat') {
    parts.push(colored(at(half(0.205), 0, 0.03, 0), st.hat));
    parts.push(colored(at(new THREE.CylinderGeometry(0.255, 0.255, 0.025, 18), 0, 0.035, 0.025), st.hat));
    parts.push(colored(at(new THREE.BoxGeometry(0.045, 0.06, 0.34), 0, 0.22, 0), '#ffe680'));
  } else if (st.kind === 'cap') {
    parts.push(colored(at(half(0.2), 0, 0.04, 0), st.hat));
    parts.push(colored(at(new THREE.BoxGeometry(0.22, 0.025, 0.16), 0, 0.05, 0.22), st.hat));
    parts.push(colored(at(new THREE.SphereGeometry(0.035, 6, 4), 0, 0.24, 0), '#ffffff'));
  } else if (st.kind === 'gnome') {
    parts.push(colored(at(new THREE.ConeGeometry(0.2, 0.42, 16), 0, 0.24, -0.02), st.hat));
    parts.push(colored(at(new THREE.SphereGeometry(0.04, 6, 4), 0, 0.46, -0.02), '#ffffff'));
    const beard = new THREE.SphereGeometry(0.13, 10, 8); beard.scale(1, 0.8, 0.6);
    parts.push(colored(at(beard, 0, -0.12, 0.1), '#f4f0e8'));
  } else {
    // ストッパーズのヘルメット：青＋白ライン＋透明バイザー風＋耳あて
    parts.push(colored(at(half(0.215), 0, 0.02, 0), st.hat));
    parts.push(colored(at(new THREE.BoxGeometry(0.05, 0.03, 0.43), 0, 0.235, 0), '#ffffff'));
    parts.push(colored(at(new THREE.TorusGeometry(0.21, 0.02, 6, 20).rotateX(Math.PI / 2), 0, 0.03, 0), '#ffffff'));
    parts.push(colored(at(new THREE.BoxGeometry(0.3, 0.03, 0.12), 0, 0.03, 0.2), '#9be3ff'));
    parts.push(colored(at(new THREE.SphereGeometry(0.05, 8, 6), -0.2, -0.02, 0), st.hat));
    parts.push(colored(at(new THREE.SphereGeometry(0.05, 8, 6), 0.2, -0.02, 0), st.hat));
    // きりっとした眉
    parts.push(colored(at(new THREE.BoxGeometry(0.06, 0.012, 0.01), -0.065, 0.07, 0.18), '#3a2416'));
    parts.push(colored(at(new THREE.BoxGeometry(0.06, 0.012, 0.01), 0.065, 0.07, 0.18), '#3a2416'));
  }
  const head = mergeGeometries(parts);

  const bodyParts = [
    colored(at(new THREE.CapsuleGeometry(0.17, 0.16, 6, 14), 0, 0.55, 0), st.body),
    colored(at(new THREE.CylinderGeometry(0.175, 0.175, 0.05, 14), 0, 0.44, 0), '#5a3b26'),
  ];
  if (st.vest) {
    // 安全ベスト（反射材ライン）
    bodyParts.push(colored(at(new THREE.CylinderGeometry(0.185, 0.185, 0.2, 14, 1, true), 0, 0.58, 0), st.vest));
    bodyParts.push(colored(at(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 14, 1, true), 0, 0.55, 0), '#e0e0e0'));
    if (st.cross) {
      bodyParts.push(colored(at(new THREE.BoxGeometry(0.1, 0.03, 0.02), 0, 0.6, 0.19), '#e03131'));
      bodyParts.push(colored(at(new THREE.BoxGeometry(0.03, 0.1, 0.02), 0, 0.6, 0.19), '#e03131'));
    }
    if (st.badge) bodyParts.push(colored(at(new THREE.SphereGeometry(0.035, 6, 4), 0.08, 0.64, 0.17), '#ffd43b'));
  } else {
    bodyParts.push(colored(at(new THREE.SphereGeometry(0.025, 6, 4), 0, 0.6, 0.165), '#fff6d0'));
    bodyParts.push(colored(at(new THREE.SphereGeometry(0.025, 6, 4), 0, 0.5, 0.17), '#fff6d0'));
  }
  const body = mergeGeometries(bodyParts);
  const arm = mergeGeometries([
    colored(at(new THREE.CapsuleGeometry(0.045, 0.18, 4, 8), 0, -0.12, 0), st.body),
    colored(at(new THREE.SphereGeometry(0.055, 8, 6), 0, -0.26, 0), st.vest ? '#ffffff' : SKIN),
  ]);
  const leg = mergeGeometries([
    colored(at(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), 0, -0.13, 0), st.leg),
    colored(at(new THREE.BoxGeometry(0.12, 0.07, 0.18), 0, -0.3, 0.03), '#6b4226'),
  ]);
  cache[role] = { head, body, arm, leg };
  return cache[role];
}

const carryGeo = new THREE.BoxGeometry(CFG.dominoW * 0.8, CFG.dominoT * 0.9, CFG.dominoH * 0.55);
const carryMats = ['#ff3b3b', '#ffd21f', '#1fa8ff', '#3ccf5a', '#ff8a1f', '#6b5cff'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }));
const bootMat = new THREE.MeshStandardMaterial({ color: '#e8233f', roughness: 0.4 });
const bootGeo = new THREE.BoxGeometry(0.14, 0.1, 0.2);
const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcf3a', metalness: 0.8, roughness: 0.25 });
const stopperHeld = new THREE.BoxGeometry(0.6, 0.45, 0.1);
const stopperHeldMat = new THREE.MeshStandardMaterial({ color: '#ffd21f', roughness: 0.5 });

export function buildGnome(role) {
  const g = gnomeGeometries(role);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const body = new THREE.Mesh(g.body, gnomeMaterial); body.castShadow = true; pivot.add(body);
  const head = new THREE.Mesh(g.head, gnomeMaterial); head.position.set(0, 0.9, 0); head.castShadow = true; pivot.add(head);
  const armL = new THREE.Mesh(g.arm, gnomeMaterial); armL.position.set(-0.22, 0.68, 0);
  const armR = new THREE.Mesh(g.arm, gnomeMaterial); armR.position.set(0.22, 0.68, 0);
  pivot.add(armL, armR);
  const legL = new THREE.Mesh(g.leg, gnomeMaterial); legL.position.set(-0.085, 0.36, 0);
  const legR = new THREE.Mesh(g.leg, gnomeMaterial); legR.position.set(0.085, 0.36, 0);
  pivot.add(legL, legR);
  const carry = new THREE.Group();
  carry.position.set(0, 0.62, 0.3);
  const stack = [];
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(carryGeo, carryMats[i % carryMats.length]);
    d.position.set((Math.random() - 0.5) * 0.04, i * 0.15, 0);
    d.rotation.y = (Math.random() - 0.5) * 0.3;
    d.visible = false;
    carry.add(d); stack.push(d);
  }
  pivot.add(carry);
  const held = new THREE.Mesh(stopperHeld, stopperHeldMat); held.position.set(0, 0.62, 0.3); held.visible = false; pivot.add(held);
  // アクセサリー（ブーツ・金ヘルメット・バックパック・アンテナ）
  const boots = [legL, legR].map((l) => { const b = new THREE.Mesh(bootGeo, bootMat); b.position.set(0, -0.28, 0.03); b.visible = false; l.add(b); return b; });
  const gold = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), goldMat);
  gold.position.set(0, 0.035, 0); gold.visible = false; head.add(gold);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.18), new THREE.MeshStandardMaterial({ color: '#8d5524', roughness: 0.7 }));
  pack.position.set(0, 0.6, -0.22); pack.visible = false; pivot.add(pack);
  const antenna = new THREE.Group();
  antenna.add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 4), new THREE.MeshStandardMaterial({ color: '#888' })));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff3b3b' }));
  tip.position.y = 0.16; antenna.add(tip);
  antenna.position.set(0.14, 0.32, -0.05); antenna.visible = false; head.add(antenna);
  return { root, pivot, body, head, armL, armR, legL, legR, carry, stack, held, boots, gold, pack, antenna };
}

export const looseMats = carryMats;
