import * as THREE from 'three';
import './style.css';
import { initPhysics } from './core/physics.js';
import { Game, PIECE_LABEL } from './game/game.js';
import { FX } from './render/fx.js';
import { Audio } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { CameraRig } from './render/cameraRig.js';
import { Renderer } from './render/renderer.js';
import { GachaShow } from './render/gachaShow.js';
import { loadSave, writeSave, clearSave, loadSettings, writeSettings, loadBackup } from './save.js';
import { installDebug } from './debug.js';

await initPhysics();

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.2, 900);
const view = new Renderer(canvas, scene, camera);
const audio = new Audio();
const fx = new FX(scene, camera, $('floaters'));
const game = new Game({ scene, fx, audio });
const rig = new CameraRig(camera, canvas);
const gacha = new GachaShow({ scene, rig, audio, game, root: $('gacha3d') });

const settings = { speed: 1, music: 0.45, sfx: 0.85, quality: 'mid', autoCam: true, seenHelp: false, gachaFast: false, ...loadSettings() };
audio.setMusicVol(settings.music); audio.setSfxVol(settings.sfx);
view.setQuality(settings.quality);
rig.auto = settings.autoCam;
gacha.speed = settings.gachaFast ? 2.5 : 1;

// ---------------- セーブ ----------------
let stageSaves = {};
let resetting = false;
function snapshotAll() {
  if (game.stageId) stageSaves[game.stageId] = game.serializeStage();
  return {
    v: 3, savedAt: Date.now(), progress: game.progress.serialize(), records: game.records, stats: game.stats,
    unlockedStage: game.unlockedStage, rewinds: game.rewinds, currentStage: game.stageId, stages: stageSaves, history: game.history,
  };
}
function save(manual = false) {
  if (resetting || !game.stageId || game.mode !== 'build' || gacha.active) { if (manual) toast('連鎖中・ガチャ中はセーブできません'); return; }
  const n = writeSave(snapshotAll());
  if (manual) toast(`💾 セーブしました（${Math.round(n / 1024)} KB）`);
}
function applySave(s) {
  game.progress.load(s.progress);
  for (const k of Object.keys(s.records || {})) Object.assign(game.records[k] ||= {}, s.records[k]);
  Object.assign(game.stats, s.stats || {});
  game.unlockedStage = s.unlockedStage || 1;
  game.rewinds = s.rewinds || 0;
  game.history = s.history || [];
  stageSaves = s.stages || {};
}
const loaded = loadSave();
if (loaded.data && (loaded.data.v === 3 || loaded.data.v === 2)) applySave(loaded.data);
const startStage = loaded.data && loaded.data.currentStage ? loaded.data.currentStage : 1;
game.loadStage(startStage, stageSaves[startStage]);

function placeGachaMachine() {
  const sp = game.def.gachaSpot;
  gacha.place(sp);
  game.stage.obstacles.push({ x: sp.x, z: sp.z, r: 3.2, roomba: true, build: true });
}
placeGachaMachine();

function goStage(id) {
  if (game.mode !== 'build' || gacha.active) return;
  stageSaves[game.stageId] = game.serializeStage();
  game.loadStage(id, stageSaves[id]);
  placeGachaMachine();
  afterStageLoad();
  save();
  toast(`${game.def.name}「${game.def.title}」`, 3);
  if (id === 2 && !game.records[2].visited) {
    game.records[2].visited = true;
    game.progress.tickets.push({ source: 'stage', label: '🛡 リビング到着！ 防衛パーツ支給', category: 'defense', choices: 3, ignoreLevel: true });
    game.progress.tickets.push({ source: 'stage', label: '🛡 リビング到着！ 防衛パーツ支給', category: 'defense', choices: 3, ignoreLevel: true });
    setTimeout(() => startGacha(), 1600);
  }
}
function afterStageLoad() {
  if (game.stage.sun) view.useSun(game.stage.sun);
  const b = game.stage.bounds;
  ctx.stageSize = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  updateCtx();
  // 最初は部屋全体 → すぐ建設現場へ寄る
  const c = ctx.center;
  camera.position.set(c.x + ctx.stageSize * 0.3, ctx.stageSize * 0.75, c.z + ctx.stageSize * 0.7);
  rig.controls.target.copy(c);
  rig.setView('build', ctx);
  ui.setView('build');
  setTool('play');
}

// ---------------- 小さな通知 ----------------
let toastTO = 0;
function toast(text, sec = 2) {
  fx.floatAt(rig.controls.target.clone().setY(3), text, 'big', sec, 1.5);
  void toastTO;
}

// ---------------- UI ----------------
let paused = false;
let speed = settings.speed || 1;
let tidyHeld = false, tidyAcc = 0, holdAcc = 0;
let tool = 'play';
let pieceYaw = 0;
let down = null, testSel = null;
const pieceGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), new THREE.MeshBasicMaterial({ color: '#7cd4ff', transparent: true, opacity: 0.35, depthWrite: false }));
pieceGhost.visible = false;
scene.add(pieceGhost);

const ui = new UI(game, {
  setTool: (t) => setTool(t),
  setSpeed: (s) => { speed = s; ui.setSpeed(s); settings.speed = s; writeSettings(settings); },
  setView: (v) => { updateCtx(); rig.setView(v, ctx); ui.setView(v); },
  resetCam: () => { updateCtx(); rig.reset(ctx); ui.setView('build'); },
  toggleAutoCam: () => { rig.auto = !rig.auto; rig.autoSuspended = false; settings.autoCam = rig.auto; writeSettings(settings); ui.setAutoCam(rig.auto, false); },
  run: () => runNow(),
  rewind: () => { audio.ensure(); if (game.rewind()) toast(`⏪ 倒す前に戻った！（残り${game.rewinds}）`); },
  tidyHold: (v) => { audio.ensure(); tidyHeld = v; },
  togglePause: () => setPaused(!paused),
  save: (m) => save(m),
  load: () => { const s = loadBackup() || loadSave().data; if (!s) return toast('セーブがありません'); applySave(s); game.loadStage(s.currentStage || 1, stageSaves[s.currentStage || 1]); placeGachaMachine(); afterStageLoad(); toast('読み込みました'); },
  reset: () => { resetting = true; clearSave(); location.reload(); },
  goStage: (id) => goStage(id),
  getSettings: () => settings,
  setSetting: (k, v) => {
    settings[k] = v; writeSettings(settings);
    if (k === 'quality') { view.setQuality(v); if (game.stage.sun) view.useSun(game.stage.sun); }
    if (k === 'music') audio.setMusicVol(v);
    if (k === 'sfx') audio.setSfxVol(v);
    if (k === 'gachaFast') gacha.speed = v ? 2.5 : 1;
  },
  gachaFast: () => { const on = gacha.toggleFast(); settings.gachaFast = on; writeSettings(settings); return on; },
  gachaSkip: () => gacha.skip(),
});
ui.setSpeed(speed);
ui.setAutoCam(rig.auto, false);
rig.onChange(() => ui.setAutoCam(rig.auto, rig.autoSuspended));

function setPaused(p) { paused = p; ui.setPaused(p); }
function setTool(t) {
  tool = t;
  game.editMode = t;
  ui.setTool(t);
  pieceGhost.visible = t.startsWith('piece:');
  if (t !== 'test') { testSel = null; game.planView.selection = null; }
}

/** 「倒す！」：確認なしで、押した瞬間に始める */
function runNow() {
  audio.ensure();
  if (game.mode !== 'build' || gacha.active) return;
  if (game.startRun()) {
    audio.firstPush();
    setTool('play');
  } else {
    const s = game.def.start;
    fx.floatAt(new THREE.Vector3(s.x, 2, s.z), 'まずはスタートの横にドミノを置こう', 'warn', 2);
    rig.focusOn(new THREE.Vector3(s.x, 0, s.z), 16);
  }
}

// ---------------- イベント ----------------
game.on('runStart', () => { audio.setSong('run'); rig.startRun(); $('flash').classList.add('hidden'); });
game.on('goalStep', (e) => { ctx.event = e.pos.clone ? e.pos.clone() : new THREE.Vector3(e.pos.x, 0, e.pos.z); });
game.on('special', (e) => { ctx.event = new THREE.Vector3(e.pos.x, 0, e.pos.z); });
game.on('checkpoint', (cp) => { ctx.event = cp.pos.clone(); });
game.on('goal', () => { ctx.event = game.goal.focus().clone(); game.workers.list.forEach((w) => w.act(3 + Math.random(), 'cheer', () => w.think())); });
game.on('roomba', (k) => { if (k === 'depart' && game.run && game.roomba) ctx.event = game.roomba.pos.clone(); });
game.on('runEnd', (r) => {
  audio.setSong('build');
  rig.endRun();
  if (r.cleared) audio.goal(); else audio.fail();
  if (!r.cleared && r.stop) rig.focusOn(new THREE.Vector3(r.stop.x, 0, r.stop.z), 16, 1.0);
  ui.flash(r, () => startGacha(r));
  save();
});
game.on('testEnd', (r) => fx.floatAt(rig.controls.target.clone().setY(3), r.ok ? `🧪 試し倒し成功！ ${r.reached}/${r.total}` : `🧪 ${r.reached}/${r.total} で停止（元に戻しました）`, r.ok ? 'coin' : 'warn', 2.6));
game.on('stageLoaded', () => { if (view && game.stage.sun) view.useSun(game.stage.sun); });

/** 連鎖のあと、ガチャがあれば自動で始める */
function startGacha(r = null) {
  if (gacha.active) return;
  if (!game.progress.tickets.length) return postGacha(r);
  setTool('play');
  game.gachaActive = true;
  audio.setSong('build');
  gacha.start(() => { game.gachaActive = false; postGacha(r); });
}
function postGacha(r) {
  save();
  if (r && r.cleared && r.stage === 1 && !game.records[1].toldStage2) {
    game.records[1].toldStage2 = true;
    ui.dialog('<h2>👑 STAGE 1 クリア！</h2><p>子ども部屋のベルが鳴り響いた！<br>次はリビングへ。そこには… 床を巡回する巨大なロボット掃除機が待っている。</p>', [{ label: '➡ STAGE 2 へ', fn: () => goStage(2) }, { label: 'もう少しここで遊ぶ', cls: 'sub' }]);
  }
  if (r && r.cleared && r.stage === 2 && !game.records[2].toldDog) { game.records[2].toldDog = true; ui.comingSoon(() => {}); }
}

// ---------------- 入力 ----------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function setNdc(ev) { const r = canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
function floorPoint(ev) { setNdc(ev); ray.setFromCamera(ndc, camera); const p = new THREE.Vector3(); return ray.ray.intersectPlane(plane, p) ? p : null; }

canvas.addEventListener('pointerdown', (ev) => {
  audio.ensure();
  if (gacha.active) return;
  if (ev.button === 2 && tool.startsWith('piece:')) { setTool('play'); return; }
  if (ev.button !== 0) return;
  down = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false, holding: false, p: floorPoint(ev) };
});
canvas.addEventListener('pointermove', (ev) => {
  if (gacha.active) { setNdc(ev); gacha.pick(ndc, camera, false); canvas.style.cursor = gacha.hovered ? 'pointer' : 'default'; return; }
  const p = floorPoint(ev);
  if (p && tool.startsWith('piece:')) {
    const type = tool.slice(6);
    pieceGhost.scale.set(type === 'barricade' ? 5.2 : 1.6, 1, type === 'barricade' ? 0.8 : 1.6);
    pieceGhost.position.set(p.x, 0.2, p.z);
    pieceGhost.rotation.y = pieceYaw;
    pieceGhost.material.color.set(game.canPlacePiece(type, p.x, p.z, pieceYaw).ok ? '#7cd4ff' : '#ff6b6b');
  }
  if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) down.moved = true;
});
window.addEventListener('pointerup', (ev) => {
  if (gacha.active && ev.button === 0 && ev.target === canvas) { setNdc(ev); gacha.pick(ndc, camera, true); return; }
  if (!down || ev.button !== 0) return;
  const d = down; down = null;
  if (d.holding || d.moved || performance.now() - d.t > 400) return;
  const p = floorPoint(ev);
  if (!p) return;
  if (tool === 'play') { if (!game.manualTidy(p)) game.manualPlace(p); }
  else if (tool.startsWith('piece:')) game.placePiece(tool.slice(6), p.x, p.z, pieceYaw);
  else if (tool === 'stopper') {
    let best = null, bd = 2.2 * 2.2;
    for (const s of game.stoppers) { const dd = (s.x - p.x) ** 2 + (s.z - p.z) ** 2; if (dd < bd) { bd = dd; best = s; } }
    if (best) { best.setLocked(!best.locked); fx.floatAt(new THREE.Vector3(best.x, 1.5, best.z), best.locked ? '🔒 ロック（本番でも外さない）' : '🔓 ロック解除', '', 1.4); audio.clunk(); }
  } else if (tool === 'test') {
    const sl = game.nearestSlot(p.x, p.z, 1.5);
    if (!sl || sl.order < 0) return;
    if (!testSel) { testSel = sl; game.planView.selection = { a: sl.order, b: sl.order }; fx.floatAt(new THREE.Vector3(sl.x, 1.5, sl.z), '始点', '', 1.2); }
    else {
      const a = Math.min(testSel.order, sl.order), b = Math.max(testSel.order, sl.order);
      game.planView.selection = { a, b };
      if (!game.startSectionTest(a, b)) fx.floatAt(new THREE.Vector3(sl.x, 1.5, sl.z), '始点のドミノが立っていません', 'warn', 1.6);
      testSel = null;
      setTimeout(() => { game.planView.selection = null; }, 800);
    }
  }
});
canvas.addEventListener('dblclick', (ev) => { if (gacha.active) return; const p = floorPoint(ev); if (p) rig.focusOn(p, null, 0.6); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keyMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd', w: 'w', a: 'a', s: 's', d: 'd' };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (k === '`' || (k === 'd' && e.ctrlKey && e.shiftKey)) { debug.toggle(); e.preventDefault(); return; }
  audio.ensure();
  if (gacha.active) {
    if (k === ' ') { gacha.skip(); e.preventDefault(); }
    if (['1', '2', '3', '4', '5'].includes(k)) gacha.chooseIndex(+k - 1);
    return;
  }
  if (ui.modalOpen) return;
  if (keyMap[k]) { rig.keys.add(keyMap[k]); e.preventDefault(); return; }
  if (e.repeat) return;
  switch (k) {
    case '1': setTool('play'); break;
    case '2': setTool('pieces'); break;
    case '3': setTool('test'); break;
    case '4': setTool('stopper'); break;
    case 'q': pieceYaw += Math.PI / 12; break;
    case 'e': pieceYaw -= Math.PI / 12; break;
    case 'enter': runNow(); break;
    case 'r': tidyHeld = true; break;
    case 'p': setPaused(!paused); break;
    case 'b': ui.h.setView('build'); break;
    case 'v': ui.h.setView('view'); break;
    case 'f': ui.h.setView('chain'); break;
    case 'o': ui.h.setView('overview'); break;
    case 'home': ui.h.resetCam(); break;
    case 'escape': setTool('play'); ui.togglePanel(false); break;
  }
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (keyMap[k]) rig.keys.delete(keyMap[k]); if (k === 'r') tidyHeld = false; });
window.addEventListener('blur', () => { rig.keys.clear(); tidyHeld = false; });
window.addEventListener('resize', () => view.resize());
setInterval(() => save(), 10000);
window.addEventListener('beforeunload', () => save());

// ---------------- カメラ用の情報 ----------------
const ctx = { event: null, center: new THREE.Vector3(), stageSize: 64 };
function updateCtx() {
  const run = game.run;
  ctx.front = run && run.frontPos ? run.frontPos : null;
  const fsl = run && run.frontOrder >= 0 ? game.course.allSlots.find((s) => s.order === run.frontOrder) : null;
  ctx.frontYaw = fsl ? fsl.yaw : null;
  const ah = run && game.course.allSlots.find((s) => s.order === run.frontOrder + 16);
  ctx.ahead = ah ? new THREE.Vector3(ah.x, 0, ah.z) : null;
  const fs = game.frontSlot();
  ctx.buildFocus = fs ? new THREE.Vector3(fs.x, 0, fs.z) : new THREE.Vector3(game.def.goal.x, 0, game.def.goal.z);
  ctx.buildYaw = fs ? fs.yaw : 0;
  const b = game.stage.bounds;
  ctx.center.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
}

// ---------------- ループ ----------------
let last = performance.now(), uiT = 0, lastCount = 0, rateT = 0, rate = 0;
const perf = { fps: 60, frames: 0, acc: 0 };
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  perf.frames++; perf.acc += real;
  if (perf.acc >= 0.5) { perf.fps = perf.frames / perf.acc; perf.frames = 0; perf.acc = 0; }
  const t0 = performance.now();
  if (!paused) {
    if (down && !down.moved && !down.holding && tool === 'play' && now - down.t > 380) down.holding = true;
    if (down && down.holding && tool === 'play') { holdAcc += real; while (holdAcc > 0.13) { holdAcc -= 0.13; game.manualPlace(down.p); } }
    if (tidyHeld) { tidyAcc += real * 6; while (tidyAcc >= 1) { tidyAcc -= 1; game.manualRestoreStep(); } }
    const dt = real * speed;
    const n = Math.max(1, Math.ceil(dt / 0.034));
    for (let i = 0; i < n; i++) game.update(dt / n);
  }
  perf.update = performance.now() - t0;
  updateCtx();
  // 連鎖の勢い（音のうなり）
  if (game.run) { rateT += real; if (rateT > 0.25) { rate = (game.run.count - lastCount) / rateT; lastCount = game.run.count; rateT = 0; } audio.chainSwell(rate); }
  else { lastCount = 0; if (rate) { rate = 0; audio.chainSwell(0); } }
  const cam = rig.update(real, ctx);
  gacha.update(real, camera, window.innerWidth, window.innerHeight);
  view.setDof(cam.dof && settings.quality === 'high', cam.focusDist);
  if (game.stage.sunOffset) view.followShadow(rig.controls.target, game.stage.sunOffset);
  if (game.roomba) { const d = game.roomba.pos.distanceTo(rig.controls.target); audio.roombaHum(game.roomba.state === 'dock' ? 0 : Math.max(0, 0.45 - d / 100)); }
  fx.update(paused ? 0 : real, window.innerWidth, window.innerHeight);
  uiT -= real;
  if (uiT <= 0) { ui.refresh(); uiT = 0.15; }
  const r0 = performance.now();
  view.render();
  perf.render = performance.now() - r0;
  requestAnimationFrame(frame);
}

afterStageLoad();
$('loading').classList.add('hidden');
if (loaded.migratedFrom === 'v0.2') setTimeout(() => toast('Ver.0.2 のレベルとパーツを引き継ぎました（コースは新しい設計図に。置いてあったドミノは在庫に戻しました）', 5), 1500);
else if (!loaded.data && !settings.seenHelp) { settings.seenHelp = true; writeSettings(settings); setTimeout(() => { ui.togglePanel(true); ui.tab('help'); }, 800); }
requestAnimationFrame(frame);

const debug = installDebug({ game, ui, rig, view, perf, save, goStage, setTool, PIECE_LABEL, reset: () => ui.h.reset(), gacha, startGacha });
window.__game = game;
