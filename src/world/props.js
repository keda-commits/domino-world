import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// コードで作る家具・おもちゃ（プロシージャル）。木・プラスチック・布・金属で質感を分ける。

function canvasTex(w, h, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

const texCache = {};
export function woodTex(base = '#c8915c', dark = '#8a5a30', key = 'w') {
  const k = key + base;
  if (texCache[k]) return texCache[k];
  texCache[k] = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      x.strokeStyle = `rgba(80,45,20,${0.04 + Math.random() * 0.08})`;
      x.lineWidth = 1 + Math.random() * 2;
      x.beginPath();
      const y0 = Math.random() * h;
      x.moveTo(0, y0);
      for (let s = 0; s <= 8; s++) x.lineTo((s / 8) * w, y0 + Math.sin(s * 0.9 + i) * 4);
      x.stroke();
    }
    x.fillStyle = dark;
    for (let i = 0; i < 3; i++) { x.globalAlpha = 0.25; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 6, 3, 0, 0, Math.PI * 2); x.fill(); }
    x.globalAlpha = 1;
  });
  return texCache[k];
}

export const MAT = {
  wood: (c = '#c8915c') => new THREE.MeshStandardMaterial({ color: '#ffffff', map: woodTex(c), roughness: 0.55, metalness: 0 }),
  plastic: (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  matte: (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }),
  fabric: (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.95, sheen: 1, sheenColor: new THREE.Color(c).offsetHSL(0, 0, 0.2), sheenRoughness: 0.6 }),
  metal: (c = '#cfd4da') => new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.9 }),
  glow: (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.2 }),
};

export const shadow = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };
export const rbox = (w, h, d, r = 0.15, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };

// ---------------- 床・壁 ----------------
export function floorPlanks(w, d, tone = 'light') {
  const cols = tone === 'light' ? ['#d6a46c', '#cf9c63', '#dbab74', '#c99459'] : ['#b07a48', '#a8713f', '#b98352', '#9f6a3a'];
  const map = canvasTex(1024, 1024, (x, W, H) => {
    const ph = 64;
    for (let r = 0; r < H / ph; r++) {
      const off = (r * 397) % W;
      for (let k = -3; k < 3; k++) {
        const x0 = off + k * 420;
        x.fillStyle = cols[(r + k + 8) % 4];
        x.fillRect(x0, r * ph, 420, ph);
        for (let i = 0; i < 14; i++) {
          x.strokeStyle = `rgba(90,50,20,${0.05 + Math.random() * 0.07})`;
          x.lineWidth = 1 + Math.random() * 1.5;
          x.beginPath();
          const yy = r * ph + Math.random() * ph;
          x.moveTo(x0, yy); x.bezierCurveTo(x0 + 140, yy + 3, x0 + 280, yy - 3, x0 + 420, yy + 1);
          x.stroke();
        }
        x.fillStyle = 'rgba(60,30,10,0.35)'; x.fillRect(x0, r * ph, 2, ph);
      }
      x.fillStyle = 'rgba(60,30,10,0.4)'; x.fillRect(0, r * ph, W, 2);
    }
  }, [w / 24, d / 24]);
  const rough = canvasTex(256, 256, (x, W, H) => {
    x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},0,0,0.05)`; x.fillRect(Math.random() * W, Math.random() * H, 30, 1); }
  }, [w / 12, d / 12], false);
  const m = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.55, metalness: 0 });
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
  f.rotation.x = -Math.PI / 2;
  f.receiveShadow = true;
  return f;
}

export function wallpaper(w, h, base = '#fbe9cf', stripe = '#f3d8b8', dot = '#f2b8a0') {
  const map = canvasTex(256, 256, (x, W, H) => {
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 8; i += 2) { x.fillStyle = stripe; x.fillRect(i * 32, 0, 32, H); }
    x.fillStyle = dot;
    for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(i * 32 + 16, 40 + (i % 2) * 120, 5, 0, Math.PI * 2); x.fill(); }
  }, [w / 14, h / 14]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.92 }));
  m.receiveShadow = true;
  return m;
}

export function rug(rx, rz, colors) {
  const map = canvasTex(512, 512, (x, W) => {
    for (let i = 12; i >= 1; i--) { x.fillStyle = colors[i % colors.length]; x.beginPath(); x.arc(W / 2, W / 2, (i / 12) * (W / 2), 0, Math.PI * 2); x.fill(); }
    for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; x.fillRect(Math.random() * W, Math.random() * W, 2, 2); }
  });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.08, 64), new THREE.MeshPhysicalMaterial({ map, roughness: 1, sheen: 0.4, sheenColor: new THREE.Color('#ffe9d6'), sheenRoughness: 0.8 }));
  m.scale.set(rx, 1, rz);
  m.position.y = 0.04;
  m.receiveShadow = true;
  return m;
}

export function carpet(w, d, h, base = '#7a8fb8') {
  const map = canvasTex(512, 512, (x, W, H) => {
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 10; x.strokeRect(24, 24, W - 48, H - 48);
    x.strokeStyle = 'rgba(255,230,180,0.35)'; x.lineWidth = 4; x.strokeRect(48, 48, W - 96, H - 96);
    for (let i = 0; i < 6000; i++) { x.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},255,0.05)`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  });
  const m = new THREE.Mesh(rbox(w, h, d, 0.05, 2), new THREE.MeshPhysicalMaterial({ map, roughness: 1, sheen: 1, sheenColor: new THREE.Color('#dfe8ff'), sheenRoughness: 0.7 }));
  m.position.y = h / 2;
  m.receiveShadow = true;
  return m;
}

export function windowFrame(w, h) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#fff6dc' }));
  g.add(glass);
  const fm = MAT.matte('#ffffff');
  [[0, h / 2, w + 2, 1.2], [0, -h / 2, w + 3, 1.6], [-w / 2, 0, 1.2, h + 1], [w / 2, 0, 1.2, h + 1], [0, 0, 0.7, h], [0, 0, w, 0.7]].forEach(([x, y, ww, hh]) => {
    g.add(mesh(rbox(ww, hh, 0.9, 0.2), fm, x, y, 0.3));
  });
  // カーテン
  const cm = MAT.fabric('#f7a7a0');
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, h + 6, 16, 1, false, 0, Math.PI), cm);
    c.position.set(s * (w / 2 + 2.6), -1.5, 1.2);
    c.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    c.scale.set(1, 1, 0.5);
    g.add(c);
  }
  return g;
}

// ---------------- 家具 ----------------
export function desk(w, d, h) {
  const g = new THREE.Group();
  const wm = MAT.wood('#d9a066');
  g.add(mesh(rbox(w, 1.2, d, 0.3), wm, 0, h - 0.6, 0));
  const lw = 1.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(rbox(lw, h - 1.2, lw, 0.3), wm, sx * (w / 2 - lw), (h - 1.2) / 2, sz * (d / 2 - lw)));
  // 引き出し
  const drawer = mesh(rbox(w * 0.35, 2.4, d * 0.9, 0.2), MAT.wood('#e6b27a'), w * 0.25, h - 2.4, 0);
  g.add(drawer);
  g.add(mesh(new THREE.SphereGeometry(0.35, 12, 8), MAT.metal('#d8b46a'), w * 0.25, h - 2.4, d * 0.46));
  // 机の上：スタンドとノート
  const lamp = new THREE.Group();
  lamp.add(mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.4, 24), MAT.plastic('#3e8ed0'), 0, 0.2, 0));
  const arm = mesh(new THREE.CylinderGeometry(0.2, 0.2, 7, 10), MAT.metal(), 0, 3.6, 0); arm.rotation.z = 0.3; lamp.add(arm);
  const head = mesh(new THREE.ConeGeometry(2.2, 2.6, 24, 1, true), MAT.plastic('#3e8ed0'), -2.2, 7, 0); head.rotation.z = -2.2; lamp.add(head);
  lamp.position.set(-w * 0.3, h, -d * 0.2);
  g.add(lamp);
  g.add(mesh(rbox(5, 0.4, 7, 0.1), MAT.matte('#f4f1e8'), w * 0.1, h + 0.2, 0));
  g.add(mesh(rbox(4.6, 0.3, 6.6, 0.1), MAT.matte('#ff8a8a'), w * 0.1, h + 0.55, 0.2));
  return shadow(g);
}

export function chair(s = 1) {
  const g = new THREE.Group();
  const wm = MAT.wood('#c98c55');
  g.add(mesh(rbox(7 * s, 0.8, 7 * s, 0.3), wm, 0, 8 * s, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(rbox(0.8, 8 * s, 0.8, 0.2), wm, sx * 3 * s, 4 * s, sz * 3 * s));
  g.add(mesh(rbox(7 * s, 7 * s, 0.7, 0.3), wm, 0, 12 * s, -3.2 * s));
  g.add(mesh(rbox(6 * s, 0.6, 6 * s, 0.3), MAT.fabric('#ef6f6c'), 0, 8.6 * s, 0));
  return shadow(g);
}

export function bed(w, d) {
  const g = new THREE.Group();
  const wm = MAT.wood('#e8c59a');
  g.add(mesh(rbox(w, 3, d, 0.4), wm, 0, 2.2, 0));
  g.add(mesh(rbox(w - 0.6, 3, d - 0.6, 1.2), MAT.fabric('#fdf3e4'), 0, 5, 0));
  g.add(mesh(rbox(w - 0.2, 1.2, d * 0.62, 0.6), MAT.fabric('#7ec4e8'), 0, 6.8, d * 0.18));
  g.add(mesh(rbox(w * 0.6, 1.6, 3.2, 0.8), MAT.fabric('#ffffff'), 0, 7.2, -d / 2 + 2.6));
  g.add(mesh(rbox(w + 0.6, 10, 1, 0.4), wm, 0, 5, -d / 2));
  g.add(mesh(rbox(w + 0.6, 6, 1, 0.4), wm, 0, 3, d / 2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(rbox(1, 1.2, 1, 0.2), wm, sx * (w / 2 - 0.6), 0.6, sz * (d / 2 - 0.6)));
  return shadow(g);
}

export function toyBox(color = '#e8590c', w = 6, d = 4.5, h = 3.6) {
  const g = new THREE.Group();
  g.add(mesh(rbox(w, h, d, 0.3), MAT.plastic(color), 0, h / 2, 0));
  g.add(mesh(rbox(w + 0.3, 0.4, d + 0.3, 0.15), MAT.plastic('#fff4dc'), 0, h, 0));
  const lid = mesh(rbox(w + 0.3, 0.35, d + 0.3, 0.15), MAT.plastic(color), 0, h + d / 2 * 0.8, -d / 2 - 0.2);
  lid.rotation.x = -1.2;
  g.add(lid);
  const star = new THREE.Mesh(new THREE.CircleGeometry(0.9, 5), MAT.plastic('#ffe066'));
  star.position.set(0, h / 2, d / 2 + 0.01);
  g.add(star);
  // 中のドミノ
  const cols = ['#ff3b3b', '#ffd21f', '#1fa8ff', '#3ccf5a', '#ff8a1f', '#6b5cff'];
  for (let i = 0; i < 14; i++) {
    const b = mesh(rbox(0.5, 1, 0.15, 0.03, 1), MAT.plastic(cols[i % 6]), -w / 2 + 0.8 + (i % 7) * ((w - 1.6) / 6), h + 0.3, -0.8 + Math.floor(i / 7) * 1.4);
    b.rotation.set(Math.random() - 0.5, Math.random() * 3, Math.random() - 0.5);
    g.add(b);
  }
  return shadow(g);
}

export function blocks(n = 3, seed = 0) {
  const g = new THREE.Group();
  const letters = ['A', 'B', 'C', 'あ', 'い', 'う', '1', '2'];
  const cols = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#b197fc', '#ffa94d'];
  let y = 0;
  for (let i = 0; i < n; i++) {
    const s = 3.2 - i * 0.3;
    const map = canvasTex(128, 128, (x) => {
      x.fillStyle = cols[(i + seed) % 6]; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 8; x.strokeRect(10, 10, 108, 108);
      x.fillStyle = '#fff'; x.font = 'bold 76px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(letters[(i + seed) % 8], 64, 70);
    });
    const b = mesh(rbox(s, s, s, 0.25), new THREE.MeshStandardMaterial({ map, roughness: 0.55 }), (Math.random() - 0.5) * 0.4, y + s / 2, (Math.random() - 0.5) * 0.4);
    b.rotation.y = (Math.random() - 0.5) * 0.6;
    g.add(b);
    y += s;
  }
  return shadow(g);
}

export function teddy(s = 1) {
  const g = new THREE.Group();
  const fur = MAT.fabric('#b5793f'), light = MAT.fabric('#ecc595'), dark = MAT.plastic('#22140a');
  const sph = (r, x, y, z, m = fur, sx = 1, sy = 1, sz = 1) => { const o = mesh(new THREE.SphereGeometry(r, 28, 20), m, x, y, z); o.scale.set(sx, sy, sz); g.add(o); return o; };
  sph(4.2, 0, 4.4, 0, fur, 1, 1.1, 0.9); sph(2.6, 0, 4.2, 2.3, light, 1, 1.1, 0.5);
  sph(3.2, 0, 10.2, 0); sph(1.3, -2.4, 12.6, -0.3); sph(1.3, 2.4, 12.6, -0.3);
  sph(0.75, -2.4, 12.6, 0.3, light); sph(0.75, 2.4, 12.6, 0.3, light);
  sph(1.4, 0, 9.6, 2.7, light, 1, 0.8, 0.8); sph(0.45, 0, 10.0, 3.8, dark);
  sph(0.38, -1.1, 10.9, 2.75, dark); sph(0.38, 1.1, 10.9, 2.75, dark);
  sph(1.6, -4.0, 6.0, 1.0, fur, 0.9, 1.4, 0.9); sph(1.6, 4.0, 6.0, 1.0, fur, 0.9, 1.4, 0.9);
  sph(1.9, -2.2, 1.5, 2.6, fur, 1, 0.9, 1.3); sph(1.9, 2.2, 1.5, 2.6, fur, 1, 0.9, 1.3);
  const bow = mesh(new THREE.TorusGeometry(0.9, 0.35, 10, 18), MAT.fabric('#e64980'), 0, 7.6, 2.4); g.add(bow);
  g.scale.setScalar(s);
  return shadow(g);
}

export function toyCar(color = '#e8423b', s = 1) {
  const g = new THREE.Group();
  g.add(mesh(rbox(9, 2.6, 4.6, 0.8), MAT.plastic(color), 0, 2.2, 0));
  g.add(mesh(rbox(4.5, 2.2, 4, 0.7), MAT.plastic('#ffd43b'), -0.8, 4.4, 0));
  g.add(mesh(rbox(4.6, 1.4, 3.6, 0.4), new THREE.MeshPhysicalMaterial({ color: '#9be3ff', roughness: 0.05, transmission: 0.3, thickness: 0.5 }), -0.8, 4.6, 0));
  const wheelG = new THREE.CylinderGeometry(1.3, 1.3, 1, 24); wheelG.rotateX(Math.PI / 2);
  const hubG = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12); hubG.rotateX(Math.PI / 2);
  for (const [x, z] of [[-3, 2.6], [3, 2.6], [-3, -2.6], [3, -2.6]]) { g.add(mesh(wheelG, MAT.matte('#222'), x, 1.3, z)); g.add(mesh(hubG, MAT.metal(), x, 1.3, z)); }
  g.add(mesh(new THREE.SphereGeometry(0.4, 10, 8), MAT.glow('#fff4b0'), 4.5, 2.6, 1.4));
  g.add(mesh(new THREE.SphereGeometry(0.4, 10, 8), MAT.glow('#fff4b0'), 4.5, 2.6, -1.4));
  g.scale.setScalar(s);
  return shadow(g);
}

export function ballToy(r = 4) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(r, 40, 28), MAT.plastic('#4dabf7'), 0, r, 0));
  const t1 = mesh(new THREE.TorusGeometry(r * 1.003, r * 0.15, 12, 48), MAT.plastic('#ffffff'), 0, r, 0); t1.rotation.x = 0.4; g.add(t1);
  const t2 = mesh(new THREE.TorusGeometry(r * 1.003, r * 0.15, 12, 48), MAT.plastic('#ffd43b'), 0, r, 0); t2.rotation.z = 1.2; g.add(t2);
  return shadow(g);
}

export function ringTower() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 9, 12), MAT.wood('#f1c27d'), 0, 4.5, 0));
  ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7'].forEach((c, i) => {
    const r = mesh(new THREE.TorusGeometry(2.6 - i * 0.4, 0.75, 14, 30), MAT.plastic(c), 0, 0.8 + i * 1.45, 0);
    r.rotation.x = Math.PI / 2; g.add(r);
  });
  return shadow(g);
}

export function sofa(w, d) {
  const g = new THREE.Group();
  const f = MAT.fabric('#5b7fbf'), f2 = MAT.fabric('#6d90cf');
  g.add(mesh(rbox(w, 5, d, 1.2), f, 0, 3.5, 0));
  g.add(mesh(rbox(w, 9, 3, 1.4), f, 0, 8, -d / 2 + 1.5));
  g.add(mesh(rbox(3, 7, d, 1.2), f, -w / 2 + 1.5, 6, 0));
  g.add(mesh(rbox(3, 7, d, 1.2), f, w / 2 - 1.5, 6, 0));
  const cw = (w - 6) / 3;
  for (let i = 0; i < 3; i++) g.add(mesh(rbox(cw - 0.3, 2, d - 4, 0.9), f2, -w / 2 + 3 + cw / 2 + i * cw, 7, 1));
  g.add(mesh(rbox(4, 4, 1.6, 1.2), MAT.fabric('#ffd166'), -w / 4, 9.5, -d / 2 + 4));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.4, 0.3, 1, 10), MAT.wood('#6b4423'), sx * (w / 2 - 1.5), 0.5, sz * (d / 2 - 1.5)));
  return shadow(g);
}

export function coffeeTable(w, d, h) {
  const g = new THREE.Group();
  const wm = MAT.wood('#8b5a33');
  g.add(mesh(rbox(w, 0.9, d, 0.4), wm, 0, h - 0.45, 0));
  g.add(mesh(rbox(w - 1, 0.5, d - 1, 0.2), new THREE.MeshPhysicalMaterial({ color: '#d7f0ff', roughness: 0.05, transmission: 0.5, thickness: 0.3 }), 0, h + 0.1, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.6, 0.45, h - 0.9, 14), wm, sx * (w / 2 - 1.2), (h - 0.9) / 2, sz * (d / 2 - 1.2)));
  // 上の小物
  g.add(mesh(new THREE.CylinderGeometry(1.2, 1, 2.4, 20), MAT.plastic('#ffffff'), -w * 0.25, h + 1.2, 0));
  g.add(mesh(new THREE.TorusGeometry(0.7, 0.2, 8, 16), MAT.plastic('#ffffff'), -w * 0.25 + 1.4, h + 1.3, 0));
  g.add(mesh(rbox(5, 0.6, 3.6, 0.2), MAT.matte('#e84a5f'), w * 0.2, h + 0.3, 0.5));
  return shadow(g);
}

export function tvStand(w, d) {
  const g = new THREE.Group();
  g.add(mesh(rbox(w, 6, d, 0.4), MAT.wood('#efe3d0'), 0, 3, 0));
  const tv = mesh(rbox(w * 0.85, 15, 0.8, 0.3), MAT.matte('#111'), 0, 14, 0); g.add(tv);
  g.add(mesh(new THREE.PlaneGeometry(w * 0.8, 13.5), new THREE.MeshStandardMaterial({ color: '#203550', emissive: '#16304f', emissiveIntensity: 0.6, roughness: 0.1 }), 0, 14, 0.42));
  g.add(mesh(rbox(3, 1, 3, 0.2), MAT.matte('#222'), 0, 6.5, 0));
  return shadow(g);
}

export function bookshelf(w, h, d) {
  const g = new THREE.Group();
  const wm = MAT.wood('#a0693c');
  g.add(mesh(rbox(w, h, 0.6, 0.1), wm, 0, h / 2, -d / 2));
  for (const sx of [-1, 1]) g.add(mesh(rbox(0.8, h, d, 0.2), wm, sx * w / 2, h / 2, 0));
  const shelves = 4;
  const cols = ['#e64980', '#4dabf7', '#ffd43b', '#69db7c', '#845ef7', '#ff922b', '#f8f9fa'];
  for (let i = 0; i <= shelves; i++) {
    const y = (i / shelves) * (h - 1) + 0.4;
    g.add(mesh(rbox(w, 0.6, d, 0.1), wm, 0, y, 0));
    if (i < shelves) {
      let x = -w / 2 + 1;
      while (x < w / 2 - 1.5) {
        const bw = 0.8 + Math.random() * 0.8, bh = (h / shelves) * (0.6 + Math.random() * 0.3);
        g.add(mesh(rbox(bw, bh, d * 0.8, 0.1), MAT.matte(cols[Math.floor(Math.random() * cols.length)]), x + bw / 2, y + 0.3 + bh / 2, 0));
        x += bw + 0.1;
      }
    }
  }
  return shadow(g);
}

export function plant(s = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(3, 2.2, 5, 24), MAT.plastic('#e8d8c4'), 0, 2.5, 0));
  g.add(mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.3, 24), MAT.matte('#4a3020'), 0, 4.9, 0));
  const leaf = new THREE.MeshStandardMaterial({ color: '#3f9b4f', roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < 14; i++) {
    const l = mesh(new THREE.SphereGeometry(2, 12, 8), leaf, 0, 0, 0);
    const a = (i / 14) * Math.PI * 2;
    l.scale.set(0.35, 1.6, 0.08);
    l.position.set(Math.cos(a) * 1.4, 7 + (i % 3), Math.sin(a) * 1.4);
    l.rotation.set(Math.sin(a) * 0.6, -a, Math.cos(a) * 0.6);
    g.add(l);
  }
  g.scale.setScalar(s);
  return shadow(g);
}

export function armchair() {
  const g = sofa(14, 12);
  return g;
}

export function dock() {
  const g = new THREE.Group();
  g.add(mesh(rbox(6, 3, 2, 0.6), MAT.plastic('#2b2f36'), 0, 1.5, 0));
  g.add(mesh(rbox(5, 0.3, 4, 0.1), MAT.plastic('#3a3f48'), 0, 0.15, 2));
  g.add(mesh(new THREE.SphereGeometry(0.25, 10, 8), MAT.glow('#3cff8a'), 0, 2.6, 1.01));
  return shadow(g);
}
