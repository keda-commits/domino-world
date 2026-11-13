import * as THREE from 'three';
import { PARTS, EVOLUTIONS, RARITY, CATEGORY } from '../data/parts.js';
import { buildGnome } from '../actors/gnomeModel.js';
import { MAT, rbox, shadow } from '../world/props.js';
import { trainMesh, towerMesh, hqMesh, barricadeMesh, sensorMesh, bellPieceMesh, piggyMesh } from '../world/devices.js';

/**
 * 3D ガチャ演出：部屋に置いた大きなおもちゃのガチャマシンで、
 * カプセルが転がり出て → 窓付きの玩具パッケージが並び → 選ぶと開封 → 実際の現場に登場する。
 */
const RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };
const RCOL = { common: '#dfe6ee', rare: '#4dabf7', epic: '#b07cff', legendary: '#ffc531' };
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const back = (t) => { t = Math.min(1, Math.max(0, t)); const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** パーツの中身（3Dプレビュー） */
export function partModel(id) {
  const g = new THREE.Group();
  const roles = { builder: 'builder', carrier: 'carrier', collector: 'collector', stopperCrew: 'stopperCrew', restorer: 'restorer', guard: 'guard' };
  if (roles[id]) {
    const m = buildGnome(roles[id]);
    m.armR.rotation.x = -2.6; m.armR.rotation.z = 0.4; // 手を振る
    g.add(m.root);
    g.userData.gnome = m;
    return g;
  }
  const add = (o) => { g.add(o); return o; };
  switch (id) {
    case 'machine': {
      add(mesh(rbox(1.6, 1.0, 2.4, 0.15), MAT.plastic('#ffc21a'), 0, 0.85, 0));
      add(mesh(rbox(1.4, 1.0, 1.0, 0.15), MAT.plastic('#ffc21a'), 0, 1.85, -0.6));
      for (const x of [-0.9, 0.9]) add(mesh(rbox(0.4, 0.6, 2.8, 0.15), MAT.matte('#333'), x, 0.3, 0));
      add(mesh(new THREE.CylinderGeometry(0.7, 0.35, 0.9, 16, 1, true), MAT.plastic('#e8423b'), 0, 1.85, 0.6));
      break;
    }
    case 'train': add(trainMesh()); break;
    case 'watchtower': add(towerMesh()).scale.setScalar(0.35); break;
    case 'barricade': add(barricadeMesh()).scale.setScalar(0.5); break;
    case 'sensor': add(sensorMesh()); break;
    case 'bell': add(bellPieceMesh()); break;
    case 'piggy': add(piggyMesh()); break;
    case 'factory': {
      add(mesh(rbox(2.5, 1.8, 2, 0.2), MAT.plastic('#5c7cfa'), 0, 0.9, 0));
      const roof = add(mesh(new THREE.ConeGeometry(1.8, 1, 4), MAT.plastic('#e8423b'), 0, 2.3, 0)); roof.rotation.y = Math.PI / 4;
      add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 10), MAT.metal('#868e96'), 0.7, 2.6, -0.4));
      break;
    }
    case 'boots':
      for (const x of [-0.35, 0.35]) { add(mesh(rbox(0.5, 0.9, 0.5, 0.12), MAT.plastic('#e8233f'), x, 0.6, 0)); add(mesh(rbox(0.55, 0.3, 0.9, 0.1), MAT.plastic('#e8233f'), x, 0.15, 0.2)); }
      break;
    case 'basket': {
      add(mesh(new THREE.CylinderGeometry(0.9, 0.7, 0.9, 16, 1, true), Object.assign(MAT.wood('#c89a5a'), { side: THREE.DoubleSide }), 0, 0.45, 0));
      const h = add(mesh(new THREE.TorusGeometry(0.75, 0.06, 8, 20, Math.PI), MAT.wood('#a87b45'), 0, 0.9, 0)); h.rotation.y = Math.PI / 2;
      ['#ff3b3b', '#1fa8ff', '#3ccf5a'].forEach((c, i) => add(mesh(rbox(0.25, 0.5, 0.08, 0.02), MAT.plastic(c), (i - 1) * 0.3, 0.9, 0)));
      break;
    }
    case 'level': {
      add(mesh(rbox(2.2, 0.35, 0.35, 0.06), MAT.plastic('#ffd21f'), 0, 0.4, 0));
      add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10).rotateZ(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#9fff9f', transmission: 0.6, roughness: 0.05 }), 0, 0.6, 0.12));
      break;
    }
    case 'gate': {
      add(mesh(rbox(1.2, 1.0, 0.2, 0.05), new THREE.MeshStandardMaterial({ color: '#2fb36b', emissive: '#0d4d2a' }), 0, 0.7, 0));
      add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), MAT.metal(), -0.75, 0.8, 0));
      add(mesh(new THREE.SphereGeometry(0.15, 10, 8), MAT.glow('#3cff8a'), -0.75, 1.65, 0));
      break;
    }
    case 'clover':
      for (let i = 0; i < 4; i++) { const l = add(mesh(new THREE.SphereGeometry(0.4, 14, 10), MAT.plastic('#3fd16b'), Math.cos(i * Math.PI / 2) * 0.4, 1, Math.sin(i * Math.PI / 2) * 0.4)); l.scale.y = 0.3; }
      add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), MAT.plastic('#2b8a3e'), 0, 0.5, 0));
      break;
    case 'rewind': {
      add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 10), MAT.metal('#f2c14e'), 0, 0.6, 0));
      for (const s of [-1, 1]) { const w = add(mesh(new THREE.TorusGeometry(0.4, 0.12, 10, 20), MAT.metal('#f2c14e'), s * 0.45, 1.3, 0)); w.rotation.y = Math.PI / 2; }
      break;
    }
    default: {
      // 進化の設計図
      const sc = add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.8, 16).rotateZ(Math.PI / 2), MAT.plastic('#4dabf7'), 0, 1, 0));
      void sc;
      add(mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshStandardMaterial({ color: '#dbe9ff', side: THREE.DoubleSide, emissive: '#223355', emissiveIntensity: 0.3 }), 0, 0.45, 0.2));
    }
  }
  shadow(g);
  return g;
}

/** 大きなおもちゃのガチャマシン（部屋に常設） */
export function gachaMachineModel() {
  const g = new THREE.Group();
  const red = MAT.plastic('#e8343f'), chrome = MAT.metal('#d9dde2'), dark = MAT.plastic('#2b2f36');
  g.add(mesh(rbox(4.4, 3.6, 4.0, 0.4), red, 0, 1.8, 0));
  g.add(mesh(rbox(4.6, 0.4, 4.2, 0.15), chrome, 0, 3.7, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.4, 32), dark, 0, 0.2, 0));
  const dome = mesh(new THREE.SphereGeometry(2.1, 40, 28), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.03, transmission: 0.92, thickness: 0.4, ior: 1.45, clearcoat: 1 }), 0, 5.6, 0);
  g.add(dome);
  const cols = ['#ffd43b', '#4dabf7', '#ff6b6b', '#69db7c', '#b197fc', '#ffa94d', '#f783ac'];
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.4, y = 4.3 + Math.random() * 1.6;
    const cap = new THREE.Group();
    cap.add(mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.plastic(cols[i % cols.length])));
    cap.add(mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.1, transmission: 0.5 })));
    cap.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    cap.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    g.add(cap);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 24).rotateX(Math.PI / 2), chrome, 0, 3.6, 2.02));
  const handle = new THREE.Group();
  handle.add(mesh(new THREE.TorusGeometry(0.75, 0.13, 10, 28), chrome));
  handle.add(mesh(rbox(1.5, 0.28, 0.28, 0.1), chrome));
  handle.position.set(0, 2.3, 2.08);
  g.add(handle);
  g.userData.handle = handle;
  g.add(mesh(rbox(1.4, 1.0, 0.4, 0.12), dark, 0, 0.8, 2.0));
  const gears = [];
  for (const [y, r, s] of [[1.4, 0.8, 1], [2.6, 0.55, -1]]) {
    const gear = new THREE.Group();
    gear.add(mesh(new THREE.CylinderGeometry(r, r, 0.2, 18).rotateZ(Math.PI / 2), MAT.metal('#f2c14e')));
    for (let i = 0; i < 10; i++) { const t = mesh(rbox(0.2, 0.25, 0.22, 0.03), MAT.metal('#f2c14e'), 0, 0, 0); const a = (i / 10) * Math.PI * 2; t.position.set(0, Math.cos(a) * (r + 0.08), Math.sin(a) * (r + 0.08)); t.rotation.x = -a; gear.add(t); }
    gear.position.set(2.3, y, 0.3 + s * 0.6);
    gear.userData.dir = s;
    g.add(gear); gears.push(gear);
  }
  g.userData.gears = gears;
  const sign = canvasTex(512, 128, (x, w, h) => {
    x.fillStyle = '#fff4d6'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#e8343f'; x.font = 'bold 74px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('ドミノガチャ', w / 2, h / 2 + 4);
  });
  g.add(mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshStandardMaterial({ map: sign }), 0, 3.05, 2.01));
  return shadow(g);
}

function packageTexture(part, rarity, cat) {
  return canvasTex(256, 320, (x, w, h) => {
    const c = CATEGORY[cat] ? CATEGORY[cat].color : '#ffb000';
    x.fillStyle = c; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = -h; i < w; i += 28) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 14, 0); x.lineTo(i + 14 + h, h); x.lineTo(i + h, h); x.fill(); }
    x.fillStyle = '#fff'; x.fillRect(14, 12, w - 28, 54);
    x.fillStyle = '#333'; x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(part, w / 2, 40, w - 40);
    // 透明な窓（中身が見える）
    x.clearRect(30, 74, 196, 186);
    x.strokeStyle = '#fff'; x.lineWidth = 6; x.strokeRect(30, 74, 196, 186);
    x.fillStyle = RCOL[rarity] || '#fff'; x.fillRect(0, h - 40, w, 40);
    x.fillStyle = rarity === 'common' ? '#555' : '#fff'; x.font = 'bold 22px sans-serif';
    x.fillText(`${'★'.repeat(RANK[rarity] + 1)} ${RARITY[rarity] ? RARITY[rarity].label : ''}`, w / 2, h - 20);
  });
}

export class GachaShow {
  constructor({ scene, rig, audio, game, root }) {
    this.scene = scene; this.rig = rig; this.audio = audio; this.game = game; this.root = root;
    this.machine = null;
    this.items = [];
    this.state = 'idle';
    this.speed = 1;
    this.raycaster = new THREE.Raycaster();
    this.el = root;
  }

  /** ステージに常設するガチャマシン */
  place(spot) {
    if (this.machine) this.scene.remove(this.machine);
    this.spot = new THREE.Vector3(spot.x, 0, spot.z);
    this.yaw = spot.yaw || 0;
    this.machine = gachaMachineModel();
    this.machine.position.copy(this.spot);
    this.machine.rotation.y = this.yaw;
    this.scene.add(this.machine);
  }
  local(x, y, z) { const c = Math.cos(this.yaw), s = Math.sin(this.yaw); return new THREE.Vector3(this.spot.x + x * c + z * s, y, this.spot.z - x * s + z * c); }

  get active() { return this.state !== 'idle'; }
  camPos() { return this.local(0, 6.2, 17.5); }
  camTgt() { return this.local(0, 1.2, 5.2); }

  /** 溜まっているガチャを順番に開ける */
  start(onDone) {
    const P = this.game.progress;
    if (!P.tickets.length) { onDone && onDone(); return; }
    this.onDone = onDone;
    this.saved = { p: this.rig.camera.position.clone(), t: this.rig.controls.target.clone() };
    this.rig.locked = true;
    this.hideBlockers();
    document.body.classList.add('mode-gacha');
    this.el.classList.remove('hidden');
    this.rig.flyTo(this.camPos(), this.camTgt(), 1.0);
    this.next(0.9);
  }

  next(delay = 0) {
    this.clear();
    const P = this.game.progress;
    if (!P.tickets.length) return this.finish();
    this.ticket = P.tickets.shift();
    this.picks = P.offer(this.game.stageId, this.ticket);
    this.state = 'spin';
    this.t = -delay;
    this.chosen = null;
    this.el.querySelector('.g3-title').textContent = this.ticket.label;
    this.el.querySelector('.g3-left').textContent = P.tickets.length ? `あと ${P.tickets.length} 回` : '';
    this.el.querySelector('.g3-cards').innerHTML = '';
    this.el.querySelector('.g3-msg').textContent = '';
    const best = this.picks.reduce((m, p) => Math.max(m, p.evo ? 3 : RANK[PARTS[p.id].rarity]), 0);
    this.best = best;
    // カプセル＆パッケージを用意
    const n = this.picks.length;
    this.picks.forEach((p, i) => {
      const part = p.evo ? null : PARTS[p.id];
      const rarity = p.evo ? 'legendary' : part.rarity;
      const x = (i - (n - 1) / 2) * 2.35;
      const cap = new THREE.Group();
      const ccol = RCOL[rarity];
      const top = mesh(new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), MAT.plastic(ccol));
      const bot = mesh(new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.1, transmission: 0.55, thickness: 0.2 }));
      cap.add(top, bot);
      cap.visible = false;
      this.scene.add(cap);
      // パッケージ
      const pkg = new THREE.Group();
      const name = p.evo ? EVOLUTIONS[p.evo].name : part.name;
      const tex = packageTexture(name, rarity, p.evo ? 'special' : part.category);
      const boxMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, alphaTest: 0.5, side: THREE.DoubleSide });
      const side = new THREE.MeshStandardMaterial({ color: p.evo ? '#ffcf3a' : (CATEGORY[part.category] || {}).color || '#ffb000', roughness: 0.7 });
      const body = mesh(new THREE.BoxGeometry(1.7, 2.2, 0.9), [side, side, side, side, boxMat, side], 0, 1.1, 0);
      // 窓（中身が見える）
      const inner = mesh(new THREE.PlaneGeometry(1.6, 2.1), new THREE.MeshStandardMaterial({ color: '#fff3dc', roughness: 1 }), 0, 1.1, -0.43);
      const glass = mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, roughness: 0.02, clearcoat: 1 }), 0, 1.05, 0.462);
      const frame = mesh(new THREE.RingGeometry(0.66, 0.72, 4, 1).rotateZ(Math.PI / 4), new THREE.MeshStandardMaterial({ color: RCOL[rarity], emissive: RCOL[rarity], emissiveIntensity: RANK[rarity] >= 2 ? 0.8 : 0.1 }), 0, 1.05, 0.463);
      frame.scale.set(1.35, 1.35, 1);
      // 箱の正面：窓の部分だけ見えるよう、本体は手前の面を少し下げる
      body.scale.z = 0.98;
      const lid = mesh(rbox(1.78, 0.18, 0.98, 0.04), side, 0, 2.28, 0);
      const model = partModel(p.evo || p.id);
      const bb = new THREE.Box3().setFromObject(model);
      const size = bb.getSize(new THREE.Vector3());
      const sc = 1.0 / Math.max(size.x, size.y, size.z * 0.8);
      model.scale.setScalar(sc);
      model.position.set(-((bb.min.x + bb.max.x) / 2) * sc, 0.45 - bb.min.y * sc, 0.05 - ((bb.min.z + bb.max.z) / 2) * sc);
      const holder = new THREE.Group(); holder.add(model);
      pkg.add(body, inner, holder, glass, frame, lid);
      // レア以上は光の柱
      if (RANK[rarity] >= 1) {
        const beam = mesh(new THREE.CylinderGeometry(0.9, 1.2, 9, 24, 1, true), new THREE.MeshBasicMaterial({ color: RCOL[rarity], transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 4.5, 0);
        pkg.add(beam); pkg.userData.beam = beam;
      }
      pkg.position.copy(this.local(x, 0, 6.2));
      pkg.rotation.y = this.yaw;
      pkg.scale.setScalar(0.001);
      pkg.visible = false;
      shadow(pkg);
      this.scene.add(pkg);
      this.items.push({ p, i, x, cap, top, pkg, lid, model, holder, rarity, hover: 0, body });
    });
  }

  clear() {
    for (const it of this.items) { this.scene.remove(it.cap, it.pkg); }
    this.items = [];
  }

  /** カメラとパッケージの間にある施設などを一時的に隠す（人は隠さない） */
  hideBlockers() {
    this.hidden = [];
    const keep = new Set([this.machine, ...this.game.workers.list.map((w) => w.root)]);
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    for (const o of this.scene.children) {
      if (keep.has(o) || !o.visible || o.isLight || o.isCamera) continue;
      const dx = o.position.x - this.spot.x, dz = o.position.z - this.spot.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c; // マシンのローカル座標
      if (Math.abs(lx) < 7 && lz > 1.2 && lz < 18 && (o.position.x !== 0 || o.position.z !== 0)) { o.visible = false; this.hidden.push(o); }
    }
  }
  finish() {
    const shown = this.hidden || [];
    this.hidden = null;
    for (const o of shown) o.visible = true;
    this.clear();
    this.state = 'idle';
    this.el.classList.add('hidden');
    document.body.classList.remove('mode-gacha');
    this.rig.locked = false;
    this.rig.flyTo(this.saved.p, this.saved.t, 0.9);
    const cb = this.onDone; this.onDone = null;
    cb && cb();
  }

  /** 早送り・スキップ */
  skip() {
    if (this.state === 'spin' || this.state === 'reveal') { this.t = 99; }
    else if (this.state === 'open' || this.state === 'deliver') this.t = 99;
  }
  toggleFast() { this.speed = this.speed > 1 ? 1 : 2.5; return this.speed > 1; }

  /** HTML の説明カード */
  buildCards() {
    const P = this.game.progress, g = this.game;
    const wrap = this.el.querySelector('.g3-cards');
    wrap.innerHTML = '';
    this.items.forEach((it) => {
      const p = it.p;
      const c = document.createElement('div');
      c.className = `g3-card r-${it.rarity}`;
      let html;
      if (p.evo) {
        const e = EVOLUTIONS[p.evo];
        html = `<div class="g3-tag evo">合体設計図</div><div class="g3-name">${e.icon} ${e.name}</div><div class="g3-lv">進化！</div><div class="g3-desc">${e.desc}</div>`;
      } else {
        const part = PARTS[p.id], lv = P.lv(p.id);
        const syn = Object.entries(EVOLUTIONS).filter(([eid, e]) => !P.evolutions[eid] && e.requires[p.id]).map(([, e]) => {
          const parts = Object.entries(e.requires).map(([k, v]) => { const cur = k === p.id ? lv + 1 : P.lv(k); return `${PARTS[k].name}${Math.min(cur, v)}/${v}${cur >= v ? '✓' : ''}`; });
          const ready = Object.entries(e.requires).every(([k, v]) => (k === p.id ? lv + 1 : P.lv(k)) >= v);
          return `<div class="g3-syn ${ready ? 'ready' : ''}">${ready ? '✨ これで' : '🔧'} ${e.icon}${e.name}${ready ? 'が作れる！' : '：' + parts.join('・')}</div>`;
        }).join('');
        html = `${lv === 0 ? '<div class="g3-new">NEW</div>' : ''}${p.guaranteed ? '<div class="g3-tag">おすすめ</div>' : ''}
          <div class="g3-cat" style="color:${CATEGORY[part.category].color}">${CATEGORY[part.category].icon} ${CATEGORY[part.category].label}</div>
          <div class="g3-name">${part.icon} ${part.name}</div>
          <div class="g3-lv">${part.consumable ? `所持 ${g.rewinds} → ${g.rewinds + 2}` : lv === 0 ? '新しく加わる！' : `Lv.${lv} → <b>Lv.${lv + 1}</b>`}</div>
          <div class="g3-desc">${part.desc(lv)}</div>${syn}`;
      }
      c.innerHTML = html + `<div class="g3-key">${it.i + 1}</div>`;
      c.onclick = () => this.choose(it);
      c.onmouseenter = () => { this.hovered = it; };
      c.onmouseleave = () => { if (this.hovered === it) this.hovered = null; };
      wrap.appendChild(c);
      it.card = c;
    });
  }

  /** 3D パッケージをクリックで選ぶ */
  pick(ndc, camera, click) {
    if (this.state !== 'choose') return false;
    this.raycaster.setFromCamera(ndc, camera);
    const hits = this.raycaster.intersectObjects(this.items.map((i) => i.pkg), true);
    const it = hits.length ? this.items.find((i) => { let o = hits[0].object; while (o) { if (o === i.pkg) return true; o = o.parent; } return false; }) : null;
    this.hovered = it || (click ? null : this.hovered);
    if (click && it) this.choose(it);
    return !!it;
  }
  chooseIndex(i) { const it = this.items[i]; if (it && this.state === 'choose') this.choose(it); }

  choose(it) {
    if (this.state !== 'choose') return;
    this.chosen = it;
    this.state = 'open';
    this.t = 0;
    const res = this.game.onGachaPick(it.p);
    this.result = res;
    this.audio.gachaPick(it.rarity, !!it.p.evo);
    this.items.forEach((o) => o.card && o.card.classList.toggle('dim', o !== it));
    it.card && it.card.classList.add('picked');
    this.el.querySelector('.g3-msg').textContent = it.p.evo ? `✨ 合体進化！ ${EVOLUTIONS[it.p.evo].name}` : `${PARTS[it.p.id].name} を手に入れた！`;
  }

  update(dt, camera, w, h) {
    if (this.hidden) for (const o of this.hidden) o.visible = false; // 施設側の毎フレーム更新で戻されないように
    if (this.machine) {
      const spin = this.state === 'spin' ? 1 : 0.05;
      this.machine.userData.gears.forEach((g) => (g.rotation.x += dt * 3 * spin * g.userData.dir));
      if (this.state === 'spin') this.machine.userData.handle.rotation.z -= dt * 6;
    }
    if (this.state === 'idle') return;
    this.t += dt * this.speed;
    const n = this.items.length;
    if (this.state === 'spin') {
      // カプセルが順に転がり出る
      if (!this.spinSound && this.t > 0) { this.spinSound = true; this.audio.gachaSpin(); }
      this.items.forEach((it, i) => {
        const t0 = 0.35 + i * 0.22, k = (this.t - t0) / 0.55;
        if (k < 0) return;
        it.cap.visible = true;
        const s = this.local(0, 0.9, 2.3), e = this.local(it.x, 0.5, 6.2);
        const kk = Math.min(1, k);
        it.cap.position.lerpVectors(s, e, ease(kk));
        it.cap.position.y = 0.5 + Math.abs(Math.sin(kk * Math.PI * 2.2)) * (1 - kk) * 1.4;
        it.cap.rotation.x += dt * 12 * (1 - kk);
        if (k >= 1 && !it.landed) { it.landed = true; this.audio.capsule(); }
      });
      if (this.t > 0.35 + (n - 1) * 0.22 + 0.7) { this.state = 'reveal'; this.t = 0; this.spinSound = false; this.audio.gachaReveal(['common', 'rare', 'epic', 'legendary'][this.best]); }
    } else if (this.state === 'reveal') {
      this.items.forEach((it, i) => {
        const k = (this.t - i * 0.12) / 0.5;
        if (k < 0) return;
        it.top.position.y = Math.min(1.5, k * 1.5); it.top.rotation.x = -Math.min(1.8, k * 3);
        it.cap.scale.setScalar(Math.max(0.001, 1 - k));
        it.pkg.visible = true;
        it.pkg.scale.setScalar(Math.max(0.001, back(k)));
      });
      if (this.t > (n - 1) * 0.12 + 0.6) { this.state = 'choose'; this.t = 0; this.items.forEach((it) => { it.cap.visible = false; it.pkg.scale.setScalar(1); }); this.buildCards(); }
    } else if (this.state === 'choose' || this.state === 'open' || this.state === 'deliver') {
      // 待機中：中身がくるくる回り、ホバーで持ち上がる
      this.items.forEach((it) => {
        const hov = this.state === 'choose' && this.hovered === it ? 1 : 0;
        it.hover += (hov - it.hover) * Math.min(1, dt * 10);
        if (this.state === 'choose') { it.pkg.position.y = it.hover * 0.35 + Math.sin(performance.now() * 0.003 + it.i) * 0.04; it.holder.rotation.y += dt * 0.8; }
        if (it.pkg.userData.beam) it.pkg.userData.beam.material.opacity = (0.12 + RANK[it.rarity] * 0.06) * (this.state === 'choose' ? 1 : it === this.chosen ? 1.6 : 0);
        if (it.model.userData.gnome) { const gm = it.model.userData.gnome; gm.armR.rotation.z = 0.4 + Math.sin(performance.now() * 0.01) * 0.4; }
      });
    }
    if (this.state === 'open') {
      const it = this.chosen;
      const k = Math.min(1, this.t / 0.6);
      it.lid.position.y = 2.28 + k * 1.4; it.lid.rotation.x = -k * 2.2; it.lid.position.z = -k * 0.6;
      it.holder.position.y = ease(k) * 1.6; it.holder.scale.setScalar(1 + ease(k) * 0.5); it.holder.rotation.y += dt * 6 * (1 - k);
      this.items.forEach((o) => { if (o !== it) { o.pkg.position.y = -ease(k) * 2.5; } });
      if (this.t > 0.15 && !this.flashed) { this.flashed = true; this.game.fx.confetti(it.pkg.position.clone().setY(2), 40 + RANK[it.rarity] * 30, 6 + RANK[it.rarity]); if (it.p.evo) { const fl = document.createElement('div'); fl.className = 'evo-flash'; document.getElementById('app').appendChild(fl); setTimeout(() => fl.remove(), 1300); } }
      if (this.t > (it.p.evo ? 1.4 : 1.0)) { this.state = 'deliver'; this.t = 0; this.flashed = false; this.deliver(); }
    } else if (this.state === 'deliver') {
      if (this.t > this.deliverTime) {
        this.rig.flyTo(this.camPos(), this.camTgt(), 0.6);
        this.next(0.5);
      }
    }
    // カードの位置（パッケージの下）
    if (this.state === 'choose' || this.state === 'open') {
      const v = new THREE.Vector3();
      this.items.forEach((it) => {
        if (!it.card) return;
        v.copy(it.pkg.position); v.y = -0.2; v.project(camera);
        it.card.style.left = `${(v.x * 0.5 + 0.5) * w}px`;
        it.card.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
      });
    }
  }

  /** 獲得したものが現場に登場する */
  deliver() {
    const it = this.chosen, g = this.game;
    this.el.querySelector('.g3-cards').innerHTML = '';
    const where = it.pkg.position.clone();
    const spawned = g.lastSpawned || [];
    this.deliverTime = 1.0;
    if (spawned.length) {
      // 新しい人：箱から飛び出して現場へ走っていく
      for (const w of spawned) { w.pos.copy(where).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, 0.8)); w.act(0.9, 'cheer', () => w.think()); }
      this.deliverTime = 1.3;
    } else if (g.lastSpawnTarget) {
      // 設備：現場の場所をカメラで見せる
      const p = g.lastSpawnTarget;
      this.rig.flyTo(p.clone().add(new THREE.Vector3(6, 6, 8)), p.clone().setY(1), 0.8);
      this.deliverTime = 1.9;
    }
    if (it.p.evo) this.deliverTime = Math.max(this.deliverTime, 2.2);
    g.lastSpawned = null; g.lastSpawnTarget = null;
  }
}
