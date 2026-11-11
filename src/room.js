import * as THREE from 'three';

// 温かい照明の子ども部屋と、おもちゃたち。
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

export function buildRoom(scene, renderer) {
  scene.background = new THREE.Color('#f6dcb8');
  scene.fog = new THREE.Fog('#f2d3ab', 110, 230);

  // 光
  const hemi = new THREE.HemisphereLight('#fff3df', '#9a7452', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe2b5', 2.2);
  sun.position.set(-40, 70, -55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const lamp = new THREE.PointLight('#ffb36b', 600, 120, 1.6);
  lamp.position.set(55, 28, 35);
  scene.add(lamp);

  // 床（木のフローリング）
  const floorTex = canvasTex(512, 512, (x, w, h) => {
    const cols = ['#c98f5b', '#c4874f', '#cf9663', '#bf8250'];
    for (let i = 0; i < 8; i++) {
      x.fillStyle = cols[i % 4];
      x.fillRect(0, i * 64, w, 64);
      x.fillStyle = 'rgba(90,50,20,0.25)';
      x.fillRect(0, i * 64, w, 2);
      x.fillRect(((i * 197) % w), i * 64, 2, 64);
      for (let k = 0; k < 30; k++) {
        x.fillStyle = `rgba(110,60,25,${Math.random() * 0.08})`;
        x.fillRect(Math.random() * w, i * 64 + Math.random() * 60, 40 + Math.random() * 80, 1.5);
      }
    }
  }, [14, 14]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 200), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.75 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ラグ
  const rugTex = canvasTex(512, 512, (x, w) => {
    const cols = ['#f7b2a6', '#fde3a7', '#b5e0d3', '#c9c3f0', '#fde3a7'];
    for (let i = 10; i >= 1; i--) {
      x.fillStyle = cols[i % cols.length];
      x.beginPath(); x.arc(w / 2, w / 2, (i / 10) * (w / 2), 0, Math.PI * 2); x.fill();
    }
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(17, 64), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.01;
  rug.scale.set(1.35, 1, 1);
  rug.receiveShadow = true;
  scene.add(rug);

  // 壁
  const wallTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#fbe9cf'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f6dcbc' : '#fbe9cf'; x.fillRect(i * 32, 0, 32, h); }
    x.fillStyle = '#f2b8a0';
    for (let i = 0; i < 8; i++) { x.beginPath(); x.arc(i * 32 + 16, 40 + (i % 2) * 60, 5, 0, Math.PI * 2); x.fill(); }
  }, [16, 3]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(240, 60), wallMat);
  back.position.set(0, 30, -72);
  back.receiveShadow = true;
  scene.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-95, 30, 0);
  left.receiveShadow = true;
  scene.add(left);
  const baseMat = std('#ffffff');
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(240, 2.5, 1), baseMat); b1.position.set(0, 1.25, -71.5); scene.add(b1);
  const b2 = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, 200), baseMat); b2.position.set(-94.5, 1.25, 0); scene.add(b2);
  // 窓
  const win = new THREE.Mesh(new THREE.PlaneGeometry(36, 22), new THREE.MeshBasicMaterial({ color: '#fff4d6' }));
  win.position.set(-20, 32, -71.8);
  scene.add(win);
  const frameMat = std('#ffffff');
  [[0, 11.5, 38, 1.5], [0, -11.5, 38, 1.5], [-18.5, 0, 1.5, 24], [18.5, 0, 1.5, 24], [0, 0, 1, 22], [0, 0, 36, 1]].forEach(([x, y, w, h]) => {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.8), frameMat);
    f.position.set(-20 + x, 32 + y, -71.5);
    scene.add(f);
  });

  addToys(scene);
  return { sun, hemi };
}

function addToys(scene) {
  const shadow = (o) => { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; };

  // 積み木
  const letters = ['A', 'B', 'C', 'あ', 'い', 'う'];
  const blockCols = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#b197fc', '#ffa94d'];
  const blockMat = (i) => {
    const t = canvasTex(128, 128, (x) => {
      x.fillStyle = blockCols[i % 6]; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 8; x.strokeRect(8, 8, 112, 112);
      x.fillStyle = '#fff'; x.font = 'bold 76px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(letters[i % 6], 64, 70);
    });
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  };
  const block = (x, y, z, s, i, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), blockMat(i));
    m.position.set(x, y + s / 2, z);
    m.rotation.y = ry;
    scene.add(shadow(m));
  };
  block(-70, 0, -50, 5, 0, 0.2); block(-64, 0, -52, 5, 1, -0.3); block(-67, 5, -51, 5, 2, 0.5);
  block(-76, 0, -40, 4, 3, 0.7); block(70, 0, -55, 5, 4, 0.1); block(75, 0, -48, 4, 5, 0.6);
  block(-8, 0, -2, 3, 1, 0.4); block(-5, 0, 2, 3, 3, -0.2); block(-6.5, 3, 0, 3, 5, 0.9);

  // おもちゃの車
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 4.6), std('#e8423b', { roughness: 0.3 }));
  body.position.y = 2.2; car.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.2, 4), std('#ffd43b', { roughness: 0.3 }));
  cab.position.set(-0.8, 4.4, 0); car.add(cab);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.4, 3.4), std('#9be3ff', { roughness: 0.1 }));
  glass.position.set(-0.8, 4.6, 0); car.add(glass);
  const wheelG = new THREE.CylinderGeometry(1.3, 1.3, 1, 20);
  wheelG.rotateX(Math.PI / 2);
  [[-3, 2.6], [3, 2.6], [-3, -2.6], [3, -2.6]].forEach(([x, z]) => {
    const w = new THREE.Mesh(wheelG, std('#2b2b2b')); w.position.set(x, 1.3, z); car.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12).rotateX(Math.PI / 2), std('#ddd', { metalness: 0.6, roughness: 0.3 }));
    hub.position.set(x, 1.3, z); car.add(hub);
  });
  car.position.set(68, 0, 42);
  car.rotation.y = -0.6;
  scene.add(shadow(car));

  // くまのぬいぐるみ
  const bear = new THREE.Group();
  const fur = std('#b5793f', { roughness: 1 });
  const light = std('#e9c08f', { roughness: 1 });
  const sph = (r, x, y, z, m = fur, sx = 1, sy = 1, sz = 1) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), m); s.position.set(x, y, z); s.scale.set(sx, sy, sz); bear.add(s); return s; };
  sph(4.2, 0, 4.4, 0, fur, 1, 1.1, 0.9);
  sph(2.6, 0, 4.2, 2.3, light, 1, 1.1, 0.5);
  sph(3.2, 0, 10.2, 0);
  sph(1.3, -2.4, 12.6, -0.3); sph(1.3, 2.4, 12.6, -0.3);
  sph(0.75, -2.4, 12.6, 0.3, light); sph(0.75, 2.4, 12.6, 0.3, light);
  sph(1.4, 0, 9.6, 2.7, light, 1, 0.8, 0.8);
  sph(0.45, 0, 10.0, 3.8, std('#2a1a10'));
  sph(0.38, -1.1, 10.9, 2.75, std('#1a1008')); sph(0.38, 1.1, 10.9, 2.75, std('#1a1008'));
  sph(1.6, -4.0, 6.0, 1.0, fur, 0.9, 1.4, 0.9); sph(1.6, 4.0, 6.0, 1.0, fur, 0.9, 1.4, 0.9);
  sph(1.9, -2.2, 1.5, 2.6, fur, 1, 0.9, 1.3); sph(1.9, 2.2, 1.5, 2.6, fur, 1, 0.9, 1.3);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.35, 8, 16), std('#e64980'));
  bow.position.set(0, 7.6, 2.4); bear.add(bow);
  bear.position.set(76, 0, -28);
  bear.rotation.y = -0.9;
  scene.add(shadow(bear));

  // ボール
  const ball = new THREE.Group();
  const bs = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 24), std('#4dabf7', { roughness: 0.35 }));
  bs.position.y = 4; ball.add(bs);
  const band = new THREE.Mesh(new THREE.TorusGeometry(4.02, 0.6, 10, 40), std('#ffffff', { roughness: 0.35 }));
  band.position.y = 4; band.rotation.x = 0.4; ball.add(band);
  const star = new THREE.Mesh(new THREE.TorusGeometry(4.02, 0.6, 10, 40), std('#ffd43b', { roughness: 0.35 }));
  star.position.y = 4; star.rotation.z = 1.2; ball.add(star);
  ball.position.set(-72, 0, 40);
  scene.add(shadow(ball));

  // 輪投げタワー
  const tower = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 9, 12), std('#f1c27d'));
  pole.position.y = 4.5; tower.add(pole);
  ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7'].forEach((c, i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(2.6 - i * 0.4, 0.75, 12, 28), std(c, { roughness: 0.35 }));
    r.rotation.x = Math.PI / 2; r.position.y = 0.8 + i * 1.45; tower.add(r);
  });
  tower.position.set(8, 0, -6);
  scene.add(shadow(tower));
}
