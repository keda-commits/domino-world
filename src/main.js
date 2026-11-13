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
import { Hand } from './game/hand.js';
import { describeAt } from './ui/hover.js';

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
  resetAllInput();
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
  rig.bounds = b;
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
let tidyHeld = false, tidyAcc = 0;
let tool = 'play';
let pieceYaw = 0;
let testSel = null;
const pieceGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), new THREE.MeshBasicMaterial({ color: '#7cd4ff', transparent: true, opacity: 0.35, depthWrite: false }));
pieceGhost.visible = false;
scene.add(pieceGhost);
const frontBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 14, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
frontBeacon.geometry.translate(0, 7, 0); frontBeacon.visible = false; scene.add(frontBeacon);

const ui = new UI(game, {
  setTool: (t) => setTool(t),
  setSpeed: (s) => { speed = s; ui.setSpeed(s); settings.speed = s; writeSettings(settings); },
  setView: (v) => { updateCtx(); rig.setView(v, ctx); ui.setView(v); },
  resetCam: () => { updateCtx(); rig.reset(ctx); ui.setView('build'); },
  setRunView: (v) => { rig.runView = v; ui.setRunView(v); },
  onPanel: () => resetAllInput(),
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
game.on('runStart', (run) => { if (run.kind !== 'main') return; resetAllInput(); audio.setSong('run'); rig.startRun(); ui.setRunView('chase'); $('flash').classList.add('hidden'); });
// 中間ゴール・ルンバ出動などでカメラは動かさない（通知と音だけ。連鎖の先頭を追い続ける）
game.on('goal', () => { game.workers.list.forEach((w) => w.act(3 + Math.random(), 'cheer', () => w.think())); });
game.on('runEnd', (r) => {
  audio.setSong('build');
  rig.endRun(); resetAllInput(); frontBeacon.visible = false;
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
  resetAllInput();
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

// ---------------- 入力（Ver.0.4：状態を持つ入力処理） ----------------
// idle → pending（押した直後。ドラッグかクリックか判定中）→ panning / rotating / grabbing
// 本番中・ガチャ中・モーダル表示中は受け付けない。状態が変わるときは前の状態を必ず終了する
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function setNdc(ev) { const r = canvas.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
function floorPoint(ev) { setNdc(ev); ray.setFromCamera(ndc, camera); const p = new THREE.Vector3(); return ray.ray.intersectPlane(plane, p) ? p : null; }
const DRAG_PX = 5;
const input = { state: 'idle', pointerId: null, x: 0, y: 0, t: 0, hit: null, lastClick: null, mx: 0, my: 0 };
const hand = new Hand(game, scene, camera);
game.hand = hand;
function inputLocked() { return gacha.active || (game.run && game.run.kind === 'main') || ui.modalOpen; }
function endInput() {
  if (input.state === 'grabbing') hand.release();
  if (input.state === 'panning') rig.panEnd();
  if (input.pointerId != null) { try { canvas.releasePointerCapture(input.pointerId); } catch { /* noop */ } }
  if (input.state === 'grabbing') ui.hideHover();
  input.state = 'idle'; input.pointerId = null; input.hit = null;
  rig.setRotateButton(false);
  canvas.style.cursor = '';
}
/** 入力状態とキーをすべて破棄（フォーカス喪失・モード遷移など） */
function resetAllInput() { endInput(); rig.clearInput(); tidyHeld = false; ui.hideHover(); }
/** カーソルの下：ドミノ → 資材置き場 → 何もない */
function hitTest(ev) {
  setNdc(ev); ray.setFromCamera(ndc, camera);
  const dh = hand.pickDomino(ray);
  const sh = hand.pickSupply(ray);
  if (dh && (!sh || dh.point.distanceTo(camera.position) <= sh.point.distanceTo(camera.position) + 0.05)) return { kind: 'domino', d: dh.d, point: dh.point };
  if (sh) return { kind: 'supply', supply: sh.kind, point: sh.point };
  return null;
}

// Alt＋左ドラッグの回転は OrbitControls より先に判定する（capture）
window.addEventListener('pointerdown', (ev) => {
  if (ev.target !== canvas) return;
  rig.setRotateButton(ev.button === 0 && ev.altKey && !inputLocked());
}, true);

canvas.addEventListener('pointerdown', (ev) => {
  audio.ensure();
  if (gacha.active || inputLocked()) return;
  if (ev.button === 2 && tool.startsWith('piece:')) { setTool('play'); return; }
  if (ev.button !== 0) { endInput(); return; }
  endInput();
  if (ev.altKey) { input.state = 'rotating'; rig.setRotateButton(true); return; } // OrbitControls が回す
  input.state = 'pending';
  input.pointerId = ev.pointerId;
  try { canvas.setPointerCapture(ev.pointerId); } catch { /* noop */ }
  input.x = ev.clientX; input.y = ev.clientY; input.t = performance.now();
  input.hit = tool === 'play' ? hitTest(ev) : null;
});

canvas.addEventListener('pointermove', (ev) => {
  input.mx = ev.clientX; input.my = ev.clientY;
  setNdc(ev); ray.setFromCamera(ndc, camera); hand.setRay(ray.clone ? ray : ray);
  if (gacha.active) { gacha.pick(ndc, camera, false); canvas.style.cursor = gacha.hovered ? 'pointer' : 'default'; return; }
  if (inputLocked()) { ui.hideHover(); return; }
  const p = floorPoint(ev);
  if (p && tool.startsWith('piece:')) {
    const type = tool.slice(6);
    pieceGhost.scale.set(type === 'barricade' ? 5.2 : 1.6, 1, type === 'barricade' ? 0.8 : 1.6);
    pieceGhost.position.set(p.x, 0.2, p.z);
    pieceGhost.rotation.y = pieceYaw;
    pieceGhost.material.color.set(game.canPlacePiece(type, p.x, p.z, pieceYaw).ok ? '#7cd4ff' : '#ff6b6b');
  }
  setNdc(ev);
  if (input.state === 'pending' && Math.hypot(ev.clientX - input.x, ev.clientY - input.y) > DRAG_PX) {
    const h = input.hit;
    if (h && h.kind === 'domino' && !h.d.removed) { hand.grab(h.d, h.point); input.state = 'grabbing'; }
    else if (h && h.kind === 'supply' && h.supply !== 'empty' && hand.grabFromSupply(h.supply, h.point)) input.state = 'grabbing';
    else {
      input.state = 'panning';
      const cur = ndc.clone();
      setNdc({ clientX: input.x, clientY: input.y }); rig.panStart(ndc);
      ndc.copy(cur);
    }
  }
  if (input.state === 'panning') { rig.panMove(ndc); canvas.style.cursor = 'move'; }
  if (input.state === 'grabbing') { canvas.style.cursor = 'grabbing'; hoverHeld(); }
  else if (input.state === 'idle') hoverAt(ev);
  else ui.hideHover();
});

function finishPress(ev) {
  if (input.pointerId != null && ev.pointerId !== input.pointerId) return;
  const st = input.state, h = input.hit;
  if (st === 'grabbing') { const r = hand.release(); if (r && r.speed > 9) fx.floatAt(new THREE.Vector3().copy(r.d.body.translation()).setY(1.6), 'ビュンッ！', '', 0.6); endInput(); return; }
  if (st === 'pending') {
    const now = performance.now();
    const lc = input.lastClick;
    const dbl = lc && now - lc.t < 320 && Math.hypot(ev.clientX - lc.x, ev.clientY - lc.y) < 10;
    if (dbl) {
      input.lastClick = null;
      if (lc.hit && lc.hit.kind === 'domino') hand.flick(lc.hit.d, lc.hit.point); // ドミノ上：デコピン
      else if (!h || h.kind !== 'domino') { const p = floorPoint(ev); if (p) rig.focusOn(p, null, 0.6); } // 空き場所：注目
    } else {
      input.lastClick = { t: now, x: ev.clientX, y: ev.clientY, hit: h };
      if (tool !== 'play') toolClick(ev);
    }
  }
  endInput();
}
canvas.addEventListener('pointerup', (ev) => { if (gacha.active && ev.button === 0) { setNdc(ev); gacha.pick(ndc, camera, true); return; } if (ev.button === 0) finishPress(ev); else if (input.state === 'rotating') endInput(); });
window.addEventListener('pointerup', (ev) => { if (ev.target !== canvas && input.state !== 'idle') finishPress(ev); });
canvas.addEventListener('pointercancel', () => endInput());
canvas.addEventListener('lostpointercapture', () => { if (input.state === 'grabbing' || input.state === 'panning') endInput(); });
canvas.addEventListener('pointerleave', () => { if (input.state === 'idle') ui.hideHover(); });
canvas.addEventListener('wheel', (ev) => {
  // つかんでいる間のホイール：高さ（Shift で傾き）。カメラのズームは止める
  if (input.state === 'grabbing') { ev.preventDefault(); ev.stopImmediatePropagation(); if (ev.shiftKey) hand.tiltBy(-Math.sign(ev.deltaY || ev.deltaX) * 0.12); else hand.adjustLift(-Math.sign(ev.deltaY) * 0.18); }
}, { passive: false, capture: true });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/** 置く以外の道具のクリック */
function toolClick(ev) {
  const p = floorPoint(ev);
  if (!p) return;
  if (tool.startsWith('piece:')) game.placePiece(tool.slice(6), p.x, p.z, pieceYaw);
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
}

// ---------------- ホバーステータス ----------------
let hoverT = 0;
function hoverAt(ev) {
  if (performance.now() - hoverT < 70) return; // 間引いてチラつきを防ぐ
  hoverT = performance.now();
  setNdc(ev); ray.setFromCamera(ndc, camera);
  const info = describeAt(game, hand, ray, camera);
  if (!info) { ui.hideHover(); return; }
  ui.showHover(info, ev.clientX, ev.clientY);
}
function hoverHeld() {
  const h = hand.held;
  if (!h) return;
  ui.showHover({ title: '✋ つかんでいる', rows: [['高さ', 'ホイール'], ['向き', 'Q / E'], ['傾き', 'Shift＋ホイール']], note: h.guide ? 'マスの上：そっと離すと立つ' : '勢いよく離すと投げる' }, input.mx, input.my, true);
}

// ---------------- キー ----------------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (k === '`' || (e.code === 'KeyD' && e.ctrlKey && e.shiftKey)) { debug.toggle(); e.preventDefault(); return; }
  audio.ensure();
  if (gacha.active) {
    if (k === ' ') { gacha.skip(); e.preventDefault(); }
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) gacha.chooseIndex(+e.code.slice(5) - 1);
    return;
  }
  if (ui.modalOpen) return;
  // 本番中は「俯瞰／連鎖追跡」の切り替えだけ
  if (game.run && game.run.kind === 'main') {
    if (e.code === 'KeyO' || e.code === 'KeyF') { ui.h.setRunView(e.code === 'KeyO' ? 'overview' : 'chase'); e.preventDefault(); }
    return;
  }
  if (input.state === 'grabbing' && (e.code === 'KeyQ' || e.code === 'KeyE')) { hand.rotate(e.code === 'KeyQ' ? 0.2 : -0.2); e.preventDefault(); return; }
  if (rig.isMoveKey(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) { rig.keyDown(e.code); e.preventDefault(); return; }
  if (e.repeat) return;
  switch (e.code) {
    case 'Digit1': setTool('play'); break;
    case 'Digit2': setTool('pieces'); break;
    case 'Digit3': setTool('test'); break;
    case 'Digit4': setTool('stopper'); break;
    case 'KeyQ': pieceYaw += Math.PI / 12; break;
    case 'KeyE': pieceYaw -= Math.PI / 12; break;
    case 'Enter': case 'NumpadEnter': runNow(); break;
    case 'KeyR': tidyHeld = true; break;
    case 'KeyP': setPaused(!paused); break;
    case 'KeyB': ui.h.setView('build'); break;
    case 'KeyV': ui.h.setView('view'); break;
    case 'KeyF': ui.h.setView('chain'); break;
    case 'KeyO': ui.h.setView('overview'); break;
    case 'Home': ui.h.resetCam(); break;
    case 'Escape': setTool('play'); ui.togglePanel(false); resetAllInput(); break;
  }
});
window.addEventListener('keyup', (e) => { rig.keyUp(e.code); if (e.code === 'KeyR') tidyHeld = false; });
// キー入力の取り残し対策：どんな理由でもフォーカスを失ったら全部破棄
window.addEventListener('blur', () => resetAllInput());
document.addEventListener('visibilitychange', () => { if (document.hidden) resetAllInput(); });
window.addEventListener('pagehide', () => resetAllInput());
document.addEventListener('compositionstart', () => rig.clearInput());
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
    if (tidyHeld) { tidyAcc += real * 6; while (tidyAcc >= 1) { tidyAcc -= 1; game.manualRestoreStep(); } }
    const dt = real * speed;
    const n = Math.max(1, Math.ceil(dt / 0.034));
    for (let i = 0; i < n; i++) game.update(dt / n);
    hand.update(real);
  }
  perf.update = performance.now() - t0;
  updateCtx();
  // 連鎖の勢い（音のうなり）
  if (game.run) { rateT += real; if (rateT > 0.25) { rate = (game.run.count - lastCount) / rateT; lastCount = game.run.count; rateT = 0; } audio.chainSwell(rate); }
  else { lastCount = 0; if (rate) { rate = 0; audio.chainSwell(0); } }
  // 俯瞰中は連鎖の先頭に光の柱を立てて位置を示す
  frontBeacon.visible = !!(game.run && game.run.kind === 'main' && rig.runView === 'overview' && ctx.front);
  if (frontBeacon.visible) { frontBeacon.position.set(ctx.front.x, 0, ctx.front.z); const k = 1 + Math.sin(now * 0.008) * 0.15; frontBeacon.scale.set(k, 1, k); }
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
