import * as THREE from 'three';

// 部屋の床をうねうね一周する閉じた建設ルート。
// 極座標 r(θ) で作るので自己交差しない。
export function radiusAt(th) {
  return 28 + 6 * Math.sin(4 * th + 0.5) + 2 * Math.sin(7 * th + 1.3);
}
export const X_SCALE = 1.35;

export function curvePoint(th) {
  const r = radiusAt(th);
  return new THREE.Vector3(Math.cos(th) * r * X_SCALE, 0, Math.sin(th) * r);
}

export function buildRoute(spacing) {
  const N = 6000;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(curvePoint((i / N) * Math.PI * 2));
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[N];
  const L = Math.floor(total / spacing);
  const step = total / L;

  const pos = new Float32Array(L * 3);
  const yaw = new Float32Array(L);
  const nrm = new Float32Array(L * 3); // 外向きの法線
  const tan = new Float32Array(L * 3);
  let j = 0;
  const sample = (s) => {
    while (j < N - 1 && cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j]);
    return pts[j].clone().lerp(pts[j + 1], f);
  };
  const samples = [];
  for (let k = 0; k < L; k++) samples.push(sample(k * step));
  for (let k = 0; k < L; k++) {
    const p = samples[k];
    const a = samples[(k - 1 + L) % L];
    const b = samples[(k + 1) % L];
    const t = b.clone().sub(a).normalize();
    pos[k * 3] = p.x; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = p.z;
    tan[k * 3] = t.x; tan[k * 3 + 2] = t.z;
    yaw[k] = Math.atan2(t.x, t.z);
    let nx = t.z, nz = -t.x;
    if (nx * p.x + nz * p.z < 0) { nx = -nx; nz = -nz; }
    nrm[k * 3] = nx; nrm[k * 3 + 2] = nz;
  }
  return {
    length: L, pos, yaw, nrm, tan, total,
    point(i, out = new THREE.Vector3()) { const k = ((i % L) + L) % L; return out.set(pos[k * 3], 0, pos[k * 3 + 2]); },
    // 側方オフセット：side>0 で外側、side<0 で内側
    side(i, side, out = new THREE.Vector3()) {
      const k = ((i % L) + L) % L;
      return out.set(pos[k * 3] + nrm[k * 3] * side, 0, pos[k * 3 + 2] + nrm[k * 3 + 2] * side);
    },
    yawAt(i) { return yaw[((i % L) + L) % L]; },
  };
}

// コースの床テープ（帯）メッシュ
export function buildRouteRibbon(route) {
  const L = route.length;
  const w = 0.55;
  const positions = [], uvs = [], idx = [];
  for (let k = 0; k <= L; k++) {
    const i = k % L;
    const px = route.pos[i * 3], pz = route.pos[i * 3 + 2];
    const nx = route.nrm[i * 3], nz = route.nrm[i * 3 + 2];
    positions.push(px + nx * w, 0.012, pz + nz * w, px - nx * w, 0.012, pz - nz * w);
    uvs.push(0, k * 0.5, 1, k * 0.5);
    if (k < L) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f3e6c4'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#e2cfa2'; x.fillRect(0, 0, 6, 64); x.fillRect(58, 0, 6, 64);
  x.fillStyle = '#d9c08a'; x.fillRect(28, 8, 8, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  return m;
}
