import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from './config.js';

// 小人の見た目（頭・胴・手足）。パーツごとに頂点カラーで色をつけ、
// 頭や胴体は1メッシュにまとめて描画コストを抑える。

const SKIN = '#ffd2b0';

function colored(geo, color) {
  const g = geo.index ? geo : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const at = (geo, x, y, z) => { geo.translate(x, y, z); return geo; };

const ROLE_STYLE = {
  builder: { body: '#ff8c2a', hat: '#ffd21f', leg: '#3d4f8a' },
  carrier: { body: '#3b8cff', hat: '#2a5fd6', leg: '#4a3b2f' },
  collector: { body: '#45b85c', hat: '#e2453c', leg: '#5a4632' },
};

const cache = {};
export const gnomeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });

export function gnomeGeometries(role) {
  if (cache[role]) return cache[role];
  const st = ROLE_STYLE[role];
  // 頭（頭の中心が原点）
  const parts = [
    colored(new THREE.SphereGeometry(0.17, 16, 12), SKIN),
    colored(at(new THREE.SphereGeometry(0.028, 8, 6), -0.06, 0.03, 0.155), '#1d1410'),
    colored(at(new THREE.SphereGeometry(0.028, 8, 6), 0.06, 0.03, 0.155), '#1d1410'),
    colored(at(new THREE.SphereGeometry(0.04, 8, 6), 0, -0.02, 0.17), '#ff9580'),
    colored(at(new THREE.SphereGeometry(0.03, 8, 6), -0.1, -0.04, 0.12), '#ffaaa0'),
    colored(at(new THREE.SphereGeometry(0.03, 8, 6), 0.1, -0.04, 0.12), '#ffaaa0'),
  ];
  if (role === 'builder') {
    parts.push(colored(at(new THREE.SphereGeometry(0.185, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.03, 0), st.hat));
    parts.push(colored(at(new THREE.CylinderGeometry(0.23, 0.23, 0.025, 16), 0, 0.035, 0.02), st.hat));
    parts.push(colored(at(new THREE.BoxGeometry(0.04, 0.05, 0.3), 0, 0.2, 0), '#ffe680'));
  } else if (role === 'carrier') {
    parts.push(colored(at(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.04, 0), st.hat));
    parts.push(colored(at(new THREE.BoxGeometry(0.2, 0.025, 0.14), 0, 0.05, 0.2), st.hat));
    parts.push(colored(at(new THREE.SphereGeometry(0.03, 6, 4), 0, 0.22, 0), '#ffffff'));
  } else {
    parts.push(colored(at(new THREE.ConeGeometry(0.18, 0.38, 14), 0, 0.22, -0.02), st.hat));
    parts.push(colored(at(new THREE.SphereGeometry(0.035, 6, 4), 0, 0.42, -0.02), '#ffffff'));
    const beard = new THREE.SphereGeometry(0.12, 10, 8);
    beard.scale(1, 0.8, 0.6);
    parts.push(colored(at(beard, 0, -0.11, 0.09), '#f4f0e8'));
  }
  const head = mergeGeometries(parts);

  // 胴（足元が原点）
  const torso = new THREE.CapsuleGeometry(0.16, 0.16, 6, 12);
  const bodyParts = [
    colored(at(torso, 0, 0.55, 0), st.body),
    colored(at(new THREE.SphereGeometry(0.025, 6, 4), 0, 0.6, 0.155), '#fff6d0'),
    colored(at(new THREE.SphereGeometry(0.025, 6, 4), 0, 0.5, 0.16), '#fff6d0'),
    colored(at(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 12), 0, 0.44, 0), '#5a3b26'),
  ];
  const body = mergeGeometries(bodyParts);

  // 腕（肩が原点、下に伸びる）
  const arm = mergeGeometries([
    colored(at(new THREE.BoxGeometry(0.08, 0.24, 0.08), 0, -0.12, 0), st.body),
    colored(at(new THREE.SphereGeometry(0.05, 8, 6), 0, -0.26, 0), SKIN),
  ]);
  // 脚（股関節が原点）
  const leg = mergeGeometries([
    colored(at(new THREE.BoxGeometry(0.1, 0.28, 0.1), 0, -0.14, 0), st.leg),
    colored(at(new THREE.BoxGeometry(0.12, 0.07, 0.17), 0, -0.3, 0.03), '#6b4226'),
  ]);
  cache[role] = { head, body, arm, leg };
  return cache[role];
}

// 運んでいるドミノ（小さめの見た目）
const carryGeo = new THREE.BoxGeometry(CFG.dominoW * 0.8, CFG.dominoT * 0.9, CFG.dominoH * 0.55);
const carryMats = ['#ff4d4d', '#ffd93b', '#38b6ff', '#5ad46a', '#ff9a2e', '#7b6cff'].map(
  (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }),
);

export function buildGnome(role) {
  const g = gnomeGeometries(role);
  const root = new THREE.Group();
  const pivot = new THREE.Group(); // 転ぶ・かがむ用の回転軸（足元）
  root.add(pivot);
  const body = new THREE.Mesh(g.body, gnomeMaterial);
  body.castShadow = true;
  pivot.add(body);
  const head = new THREE.Mesh(g.head, gnomeMaterial);
  head.position.set(0, 0.88, 0);
  head.castShadow = true;
  pivot.add(head);
  const armL = new THREE.Mesh(g.arm, gnomeMaterial);
  armL.position.set(-0.21, 0.67, 0);
  const armR = new THREE.Mesh(g.arm, gnomeMaterial);
  armR.position.set(0.21, 0.67, 0);
  pivot.add(armL, armR);
  const legL = new THREE.Mesh(g.leg, gnomeMaterial);
  legL.position.set(-0.08, 0.36, 0);
  const legR = new THREE.Mesh(g.leg, gnomeMaterial);
  legR.position.set(0.08, 0.36, 0);
  pivot.add(legL, legR);

  const carry = new THREE.Group();
  carry.position.set(0, 0.62, 0.3);
  const stack = [];
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Mesh(carryGeo, carryMats[i % carryMats.length]);
    d.position.set((Math.random() - 0.5) * 0.04, i * 0.15, 0);
    d.rotation.y = (Math.random() - 0.5) * 0.3;
    d.visible = false;
    carry.add(d);
    stack.push(d);
  }
  pivot.add(carry);
  return { root, pivot, body, head, armL, armR, legL, legR, carry, stack };
}

export const looseGeo = new THREE.BoxGeometry(CFG.dominoW, CFG.dominoT, CFG.dominoH);
export const looseMats = carryMats;
