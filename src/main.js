import * as THREE from 'three';
import './style.css';
import { buildRoom } from './room.js';
import { Game } from './game.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { CameraRig } from './cameraRig.js';
import { loadSave, writeSave, clearSave, loadSettings, writeSettings } from './save.js';

// ---------- 描画まわり ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);
buildRoom(scene, renderer);

const audio = new Audio();
const fx = new FX(scene, camera, document.getElementById('floaters'));
const game = new Game({ scene, fx, audio });
const rig = new CameraRig(camera, canvas);

const settings = { speed: 1, sound: true, follow: true, seenHelp: false, ...loadSettings() };
const saved = loadSave();
if (saved) game.load(saved);

// 初期カメラ：建設の最前線あたり
const start = game.route.point(game.buildPtr);
camera.position.set(start.x + 14, 20, start.z + 22);
rig.controls.target.copy(start);
rig.follow = settings.follow;

let paused = false;
let speed = settings.speed || 1;
audio.muted = !settings.sound;

// ---------- UI ----------
let placeHeld = false, placeTimer = 0;
const ui = new UI(game, {
  placeHold: (v) => { audio.ensure(); if (v && !placeHeld) { game.manualPlace(); placeTimer = 0.28; } placeHeld = v; },
  start: (mode) => { audio.ensure(); if (game.startChain(mode)) { rig.follow = true; ui.setFollow(true); } },
  overdrive: () => { audio.ensure(); game.activateOverdrive(); },
  togglePause: () => setPaused(!paused),
  setSpeed: (s) => setSpeed(s),
  toggleFollow: () => { rig.follow = !rig.follow; rig.flyTo = null; ui.setFollow(rig.follow); settings.follow = rig.follow; writeSettings(settings); },
  overview: () => { rig.overview(); ui.setFollow(false); },
  toggleSound: () => { audio.ensure(); audio.muted = !audio.muted; ui.setSound(!audio.muted); settings.sound = !audio.muted; writeSettings(settings); },
  reset: () => {
    if (!confirm('セーブデータを消して最初からやり直しますか？（コイン・設備・記録がすべて消えます）')) return;
    clearSave();
    resetting = true;
    location.reload();
  },
  helpClosed: () => { audio.ensure(); settings.seenHelp = true; writeSettings(settings); },
});
ui.setSpeed(speed);
ui.setFollow(rig.follow);
ui.setSound(!audio.muted);
if (!settings.seenHelp) ui.showHelp(true);

function setPaused(p) { paused = p; ui.setPaused(p); }
function setSpeed(s) { speed = s; ui.setSpeed(s); settings.speed = s; writeSettings(settings); }

game.on('chainEnd', (r) => {
  const title = r.mode === 'cont' ? (r.caught ? '連続運転終了 — 追いつかれた！' : '連続運転終了') : '連鎖終了';
  const best = r.mode === 'cont' ? game.stats.bestCont : game.stats.best;
  ui.toast(title, `${r.count.toLocaleString()} 連鎖`, `+${Math.floor(r.coins).toLocaleString()} コイン${r.count >= best && r.count > 0 ? '　🏆 自己ベスト！' : ''}`);
  save();
});
game.on('unlock', () => {
  ui.toast('新モード解放！', '♾ 連続運転モード', '建設しながら倒し続けよう（C キー）', 3.5);
  audio.milestone();
});
game.on('overdrive', (on) => {
  if (on) ui.toast('ぜんまい全開！', '⚡ オーバードライブ', '10秒間 建設・運搬・回収 3倍速！', 1.6);
});

// ---------- 入力 ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let down = null;
function floorPoint(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(floorPlane, p) ? p : null;
}
canvas.addEventListener('pointerdown', (ev) => {
  audio.ensure();
  if (ev.button === 2) { rig.follow = false; ui.setFollow(false); }
  if (ev.button !== 0) return;
  down = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false, holding: false, ev };
});
canvas.addEventListener('pointermove', (ev) => {
  if (!down) return;
  if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) down.moved = true;
});
window.addEventListener('pointerup', (ev) => {
  if (!down || ev.button !== 0) return;
  const d = down;
  down = null;
  if (d.holding) { placeHeld = false; return; }
  if (d.moved || performance.now() - d.t > 450) return;
  const p = floorPoint(ev);
  if (p && game.manualCollect(p) > 0) return;
  game.manualPlace();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keyMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd', w: 'w', a: 'a', s: 's', d: 'd' };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (ui.helpOpen && k !== 'h' && k !== 'escape') return;
  audio.ensure();
  if (keyMap[k]) { rig.keys.add(keyMap[k]); e.preventDefault(); return; }
  if (e.repeat) { if (k === ' ') e.preventDefault(); return; }
  switch (k) {
    case ' ': e.preventDefault(); ui.h.placeHold(true); break;
    case 'enter': ui.h.start('normal'); break;
    case 'c': ui.h.start('cont'); break;
    case 'o': ui.h.overdrive(); break;
    case 'p': setPaused(!paused); break;
    case '1': setSpeed(1); break;
    case '2': setSpeed(2); break;
    case '4': setSpeed(4); break;
    case 'f': ui.h.toggleFollow(); break;
    case 'v': ui.h.overview(); break;
    case 'm': ui.h.toggleSound(); break;
    case 'h': ui.showHelp(!ui.helpOpen); break;
    case 'escape': ui.showHelp(false); break;
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (keyMap[k]) rig.keys.delete(keyMap[k]);
  if (k === ' ') ui.h.placeHold(false);
});
window.addEventListener('blur', () => { rig.keys.clear(); placeHeld = false; });

// ---------- セーブ ----------
let resetting = false;
function save() { if (!resetting) writeSave(game.serialize()); }
setInterval(save, 5000);
window.addEventListener('beforeunload', save);

// ---------- ループ ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let uiTimer = 0;
const focus = new THREE.Vector3();
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    // マウス長押しで連続設置
    if (down && !down.moved && !down.holding && now - down.t > 350) { down.holding = true; placeHeld = true; placeTimer = 0; }
    if (placeHeld) {
      placeTimer -= real;
      if (placeTimer <= 0) { game.manualPlace(); placeTimer = 0.16; }
    }
    const dt = real * speed;
    const steps = Math.max(1, Math.ceil(dt / 0.02));
    for (let i = 0; i < steps; i++) game.update(dt / steps);
  }
  game.field.updateMatrices();
  rig.update(real, game.focusPoint(focus));
  fx.update(paused ? 0 : real, window.innerWidth, window.innerHeight);
  ui.tick(real, paused);
  uiTimer -= real;
  if (uiTimer <= 0) { ui.refresh(); uiTimer = 0.1; }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// デバッグ・自動テスト用
window.__game = game;
window.__rig = rig;
window.__fx = fx;
window.__setSpeed = setSpeed;
window.__renderOnce = () => { const t = performance.now(); renderer.render(scene, camera); renderer.getContext().finish(); return { ms: performance.now() - t, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; };
if (import.meta.env.DEV) import('./devtools.js').then((m) => m.installDevtools(game));
