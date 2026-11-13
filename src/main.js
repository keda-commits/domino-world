import * as THREE from 'three';
import './style.css';
import { initPhysics } from './core/physics.js';
import { Game, PIECE_LABEL } from './game/game.js';
import { FX } from './render/fx.js';
import { Audio } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { CameraRig, CAM_MODES } from './render/cameraRig.js';
import { Renderer } from './render/renderer.js';
import { loadSave, writeSave, clearSave, loadSettings, writeSettings, hasOldSave, loadBackup } from './save.js';
import { installDebug } from './debug.js';

await initPhysics();

const canvas = document.getElementById('c');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 900);
const view = new Renderer(canvas, scene, camera);
const audio = new Audio();
const fx = new FX(scene, camera, document.getElementById('floaters'));
const game = new Game({ scene, fx, audio });
const rig = new CameraRig(camera, canvas);

const settings = { speed: 1, music: 0.45, sfx: 0.8, quality: 'mid', autoCam: true, seenHelp: false, ...loadSettings() };
audio.setMusicVol(settings.music); audio.setSfxVol(settings.sfx);
view.setQuality(settings.quality);
rig.auto = settings.autoCam;

// ---------------- セーブ ----------------
let stageSaves = {};
let resetting = false;
function snapshotAll() {
  if (game.stageId) stageSaves[game.stageId] = game.serializeStage();
  return {
    v: 2, savedAt: Date.now(), progress: game.progress.serialize(), records: game.records, stats: game.stats,
    unlockedStage: game.unlockedStage, rewinds: game.rewinds, currentStage: game.stageId, stages: stageSaves,
  };
}
function save(manual = false) {
  if (resetting || !game.stageId || game.mode !== 'build') { if (manual) ui.toast('セーブ', '連鎖中はセーブできません', ''); return; }
  const n = writeSave(snapshotAll());
  if (manual) ui.toast('💾 セーブしました', `${Math.round(n / 1024)} KB`, 'コース・ドミノ配置・パーツを保存');
}
function applySave(s) {
  game.progress.load(s.progress);
  Object.assign(game.records, s.records || {});
  Object.assign(game.stats, s.stats || {});
  game.unlockedStage = s.unlockedStage || 1;
  game.rewinds = s.rewinds || 0;
  stageSaves = s.stages || {};
}
const saved = loadSave();
if (saved && saved.v === 2) applySave(saved);
const startStage = saved && saved.currentStage ? saved.currentStage : 1;
game.loadStage(startStage, stageSaves[startStage]);

function goStage(id) {
  if (game.mode !== 'build') return;
  stageSaves[game.stageId] = game.serializeStage();
  game.loadStage(id, stageSaves[id]);
  afterStageLoad();
  save();
  ui.toast(game.def.name, game.def.title, game.def.goalText, 3.5);
  if (id === 2 && !game.records[2].visited) {
    game.records[2].visited = true;
    // ステージ2開始特典：防衛パーツの確定ガチャ
    game.progress.tickets.push({ source: 'stage', label: '🛡 リビング到着！防衛パーツ支給', category: 'defense', choices: 3, ignoreLevel: true });
    game.progress.tickets.push({ source: 'stage', label: '🛡 リビング到着！防衛パーツ支給', category: 'defense', choices: 3, ignoreLevel: true });
    setTimeout(() => ui.openGachas(() => { game.syncPartsToWorld(); save(); }), 1200);
  }
}
function afterStageLoad() {
  if (game.stage.sun) view.useSun(game.stage.sun);
  const b = game.stage.bounds;
  rig.stageSize = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const s = game.def.start;
  rig.controls.target.set(s.x + 8, 0, s.z + 4);
  camera.position.set(s.x + 8 + 14, 22, s.z + 4 + 20);
  // コースが空なら全体を見渡す俯瞰から（スタートとゴールの位置がわかるように）
  const m0 = game.course.allSlots.length ? 'build' : 'overview';
  rig.setMode(m0);
  ui.setCam(m0);
  ui.suggested();
  ui.setTool('play');
  setTool('play');
}

// ---------------- UI ----------------
let down = null, stroke = null, testSel = null;
const pieceGhost = new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1), new THREE.MeshBasicMaterial({ color: '#7cd4ff', transparent: true, opacity: 0.35, depthWrite: false }));
pieceGhost.visible = false;
scene.add(pieceGhost);
let paused = false;
let speed = settings.speed || 1;
let tidyHeld = false, tidyAcc = 0;
let tool = 'play';
let pieceYaw = 0;
const ui = new UI(game, {
  setTool: (t) => setTool(t),
  setSpeed: (s) => { speed = s; ui.setSpeed(s); settings.speed = s; writeSettings(settings); },
  run: () => { audio.ensure(); if (game.mode !== 'build') return; ui.preflight(game.preflight(), () => { if (game.startRun()) { rig.cut = null; } }); },
  rewind: () => { audio.ensure(); if (game.rewind()) ui.toast('⏪ ぜんまい巻き戻し', '倒す前の状態に戻った！', `残り ${game.rewinds}個`); },
  tidyHold: (v) => { audio.ensure(); tidyHeld = v; },
  togglePause: () => setPaused(!paused),
  setCam: (m) => { rig.setMode(m); },
  toggleAutoCam: () => { rig.auto = !rig.auto; ui.setAutoCam(rig.auto); settings.autoCam = rig.auto; writeSettings(settings); },
  save: (m) => save(m),
  load: () => { const s = loadSave() || loadBackup(); if (!s) return ui.toast('ロード', 'セーブがありません', ''); applySave(s); game.loadStage(s.currentStage || 1, stageSaves[s.currentStage || 1]); afterStageLoad(); ui.toast('ロード', '読み込みました', ''); },
  reset: () => { resetting = true; clearSave(); location.reload(); },
  clearCourse: () => game.clearCourse(),
  suggested: (i) => { game.loadSuggested(i); },
  goStage: (id) => goStage(id),
  getSettings: () => settings,
  setSetting: (k, v) => {
    settings[k] = v; writeSettings(settings);
    if (k === 'quality') { view.setQuality(v); if (game.stage.sun) view.useSun(game.stage.sun); }
    if (k === 'music') audio.setMusicVol(v);
    if (k === 'sfx') audio.setSfxVol(v);
    if (k === 'autoCam') { rig.auto = v; ui.setAutoCam(v); }
  },
  helpClosed: () => { audio.ensure(); settings.seenHelp = true; writeSettings(settings); },
  takePick: (p) => {
    const res = game.progress.take(p);
    if (p.id === 'rewind') game.rewinds += 2;
    game.syncPartsToWorld();
    if (res.kind === 'evo') { audio.evolve(); onEvolve(res.id); }
    else audio.buy();
    return res;
  },
});
ui.setSpeed(speed);
ui.setAutoCam(rig.auto);
afterStageLoad();
if (!settings.seenHelp) ui.showHelp(true);
if (!saved && hasOldSave()) setTimeout(() => ui.toast('Ver.0.2 へようこそ', '新しいゲームで始まります', 'Ver.0.1 のセーブは消さずに別に保管しています'), 1500);
document.getElementById('loading').classList.add('hidden');

function setPaused(p) { paused = p; ui.setPaused(p); }
function setTool(t) {
  tool = t;
  game.editMode = t;
  ui.setTool(t);
  rig.controls.enableRotate = t === 'play';
  pieceGhost.visible = t.startsWith('piece:');
  if (t !== 'test') { testSel = null; game.planView.selection = null; }
}

function onEvolve(id) {
  const g = game;
  let p = null;
  if (id === 'massBuild') p = g.workers.list.find((w) => w.role === 'builder');
  if (id === 'fastLine') p = g.machine;
  if (id === 'autoSafety' || id === 'stopperHQ') p = g.workers.list.find((w) => w.isStopper);
  if (id === 'stopperHQ' && g.hq) p = { pos: g.hq.position };
  if (p && p.pos) { rig.lookAt(p.pos.clone(), 12, 0.95); fx.confetti(p.pos.clone(), 120, 8); }
  g.workers.list.forEach((w) => { if (Math.random() < 0.6) w.act(1.4, 'cheer', () => w.think()); });
}

game.on('runStart', () => { audio.setSong('run'); rig.cut = null; });
game.on('goalStep', (e) => { camCtx.event = e.pos.clone ? e.pos.clone() : new THREE.Vector3(e.pos.x, 0, e.pos.z); });
game.on('launch', (p) => { camCtx.event = new THREE.Vector3(p.x, 0, p.z); });
game.on('special', (e) => { camCtx.event = new THREE.Vector3(e.pos.x, 0, e.pos.z); });
game.on('goal', () => { camCtx.event = game.goal.focus().clone(); });
game.on('runEnd', (r) => {
  audio.setSong('build');
  if (r.cleared) { audio.goal(); game.workers.list.forEach((w) => w.act(3, 'cheer', () => w.think())); }
  else audio.fail();
  setTimeout(() => {
    ui.showResult(r, () => ui.openGachas(() => {
      game.syncPartsToWorld();
      game.afterRunMaintenance();
      save();
      if (r.cleared && r.stage === 1 && !game.records[1].toldStage2) {
        game.records[1].toldStage2 = true;
        ui.dialog('<h2>👑 STAGE 1 クリア！</h2><p>子ども部屋のベルが鳴り響いた！<br>次はリビングへ。そこには… 床を巡回する巨大なロボット掃除機が待っている。</p>', [{ label: '➡ STAGE 2 へ', fn: () => goStage(2) }, { label: 'もう少しここで遊ぶ', cls: 'tidy' }]);
      }
      if (r.cleared && r.stage === 2) ui.comingSoon(() => {});
    }));
  }, r.cleared ? 2200 : 900);
});
game.on('testEnd', (r) => ui.toast('🧪 区間テスト', r.ok ? `成功！ ${r.reached}/${r.total}` : `${r.reached}/${r.total} で停止`, r.ok ? '本番もこの区間は大丈夫そう' : '止まった所を直そう（元の配置に戻しました）', 3.2));
game.on('rewind', () => {});
game.on('stageLoaded', () => { if (view && game.stage.sun) view.useSun(game.stage.sun); });

// ---------------- 入力 ----------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function floorPoint(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(plane, p) ? p : null;
}

canvas.addEventListener('pointerdown', (ev) => {
  audio.ensure();
  if (ev.button !== 0) return;
  const p = floorPoint(ev);
  down = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false, holding: false, p };
  if (tool === 'draw' && p && game.mode === 'build') { stroke = [p.clone()]; game.planView.setStroke(stroke); }
});
canvas.addEventListener('pointermove', (ev) => {
  const p = floorPoint(ev);
  if (p && tool.startsWith('piece:')) {
    const type = tool.slice(6);
    const L = type === 'bridge' ? 33.6 : type === 'minicar' ? 11 : type === 'marble' ? 12 : type === 'barricade' ? 0.8 : 1.6;
    const W = type === 'barricade' ? 5.2 : type === 'bridge' || type === 'minicar' || type === 'marble' ? 2.4 : 1.6;
    pieceGhost.scale.set(W, 1, L);
    const off = type === 'bridge' || type === 'minicar' || type === 'marble' ? L / 2 : 0;
    pieceGhost.position.set(p.x + Math.sin(pieceYaw) * off, 0.2, p.z + Math.cos(pieceYaw) * off);
    pieceGhost.rotation.y = pieceYaw;
    pieceGhost.material.color.set(game.canPlacePiece(type, p.x, p.z, pieceYaw).ok ? '#7cd4ff' : '#ff6b6b');
  }
  if (!down) return;
  if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) down.moved = true;
  if (stroke && p) {
    const l = stroke[stroke.length - 1];
    if (l.distanceTo(p) > 0.35) { stroke.push(p.clone()); game.planView.setStroke(stroke); }
  }
});
window.addEventListener('pointerup', (ev) => {
  if (!down || ev.button !== 0) return;
  const d = down; down = null;
  if (stroke) {
    const s = stroke; stroke = null;
    game.planView.setStroke([]);
    if (s.length >= 3) {
      const r = game.addStroke(s);
      if (!r) ui.toast('コースを描く', 'ここからは描けません', '緑の輪（スタート）か黄色の輪（コースの端）から描き始めよう');
      else if (r.seg.cutAt) fx.floatAt(new THREE.Vector3(r.seg.cutAt.x, 1, r.seg.cutAt.z), '障害物で止まりました', 'warn', 1.6);
      else if (r.seg.to) { fx.floatAt(new THREE.Vector3(s[s.length - 1].x, 1.5, s[s.length - 1].z), 'つながった！', 'coin', 1.4); audio.buy(); }
    }
    return;
  }
  if (d.holding) return;
  if (d.moved || performance.now() - d.t > 450) return;
  const p = floorPoint(ev);
  if (!p) return;
  if (tool === 'play') { if (!game.manualTidy(p)) game.manualPlace(p); }
  else if (tool === 'erase') game.eraseAt(p);
  else if (tool.startsWith('piece:')) { game.placePiece(tool.slice(6), p.x, p.z, pieceYaw); }
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
      if (!game.startSectionTest(a, b)) ui.toast('区間テスト', '始点のドミノが立っていません', '');
      testSel = null;
      setTimeout(() => { game.planView.selection = null; }, 800);
    }
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keyMap = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd', w: 'w', a: 'a', s: 's', d: 'd' };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (k === '`' || (k === 'd' && e.ctrlKey && e.shiftKey)) { debug.toggle(); e.preventDefault(); return; }
  if (ui.modalOpen && k !== 'h' && k !== 'escape') return;
  audio.ensure();
  if (keyMap[k]) { rig.keys.add(keyMap[k]); e.preventDefault(); return; }
  if (e.repeat) return;
  switch (k) {
    case '1': setTool('play'); break;
    case '2': setTool('draw'); break;
    case '3': setTool('erase'); break;
    case '4': setTool('test'); break;
    case '5': setTool('stopper'); break;
    case 'q': pieceYaw += Math.PI / 12; break;
    case 'e': pieceYaw -= Math.PI / 12; break;
    case 'enter': ui.h.run(); break;
    case 'r': tidyHeld = true; break;
    case 'p': setPaused(!paused); break;
    case 'h': ui.showHelp(document.getElementById('help').classList.contains('hidden')); break;
    case 'escape': ui.showHelp(false); setTool('play'); break;
    case 'c': { const ms = Object.keys(CAM_MODES); const m = ms[(ms.indexOf(rig.mode) + 1) % ms.length]; rig.setMode(m); ui.setCam(m); break; }
    case 'g': if (rig.mode === 'gnome') rig.gnomeIdx++; break;
  }
});
window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (keyMap[k]) rig.keys.delete(keyMap[k]); if (k === 'r') tidyHeld = false; });
window.addEventListener('blur', () => { rig.keys.clear(); tidyHeld = false; });
window.addEventListener('resize', () => view.resize());
setInterval(() => save(), 10000);
window.addEventListener('beforeunload', () => save());

// ---------------- ループ ----------------
const camCtx = { event: null };
let last = performance.now(), uiT = 0;
const perf = { fps: 60, frame: 0, frames: 0, acc: 0 };
function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  perf.frames++; perf.acc += real;
  if (perf.acc >= 0.5) { perf.fps = perf.frames / perf.acc; perf.frames = 0; perf.acc = 0; }
  const t0 = performance.now();
  if (!paused) {
    // 長押し：置く／片付け
    if (down && !down.moved && !down.holding && tool === 'play' && now - down.t > 350) down.holding = true;
    if (down && down.holding && tool === 'play') { holdAcc += real; while (holdAcc > 0.15) { holdAcc -= 0.15; game.manualPlace(down.p); } }
    if (tidyHeld) { tidyAcc += real * 6; while (tidyAcc >= 1) { tidyAcc -= 1; game.manualRestoreStep(); } }
    const dt = real * speed;
    const n = Math.max(1, Math.ceil(dt / 0.034));
    for (let i = 0; i < n; i++) game.update(dt / n);
  }
  perf.update = performance.now() - t0;
  // カメラ
  const run = game.run;
  camCtx.running = !!run;
  camCtx.front = run && run.frontPos ? run.frontPos : null;
  let frontSlot = null;
  if (run && run.frontOrder >= 0) frontSlot = game.course.allSlots.find((s) => s.order === run.frontOrder);
  camCtx.frontYaw = frontSlot ? frontSlot.yaw : null;
  const ah = run && game.course.allSlots.find((s) => s.order === run.frontOrder + 18);
  camCtx.ahead = ah ? new THREE.Vector3(ah.x, 0, ah.z) : null;
  const fs = game.frontSlot();
  camCtx.buildFocus = fs ? new THREE.Vector3(fs.x, 0, fs.z) : game.crate.pos;
  camCtx.focus = camCtx.buildFocus;
  const b = game.stage.bounds;
  camCtx.center = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  camCtx.gnomes = game.workers.list;
  const cam = rig.update(real, camCtx);
  if (run && rig.cut) document.getElementById('rh-shot').textContent = rig.auto ? `🎬 ${{ side: 'サイド', low: 'ローアングル', aerial: '空撮', ahead: '先回り', event: '見せ場' }[rig.cut.type] || ''}` : '';
  view.setDof(cam.dof && settings.quality === 'high', cam.focusDist);
  if (game.stage.sunOffset) view.followShadow(rig.controls.target, game.stage.sunOffset);
  if (game.roomba) { const d = game.roomba.pos.distanceTo(rig.controls.target); audio.roombaHum(game.roomba.state === 'dock' ? 0 : Math.max(0, 0.35 - d / 120)); }
  fx.update(paused ? 0 : real, window.innerWidth, window.innerHeight);
  ui.tick(real);
  uiT -= real;
  if (uiT <= 0) { ui.refresh(); uiT = 0.15; }
  const r0 = performance.now();
  view.render();
  perf.render = performance.now() - r0;
  requestAnimationFrame(frame);
}
let holdAcc = 0;
requestAnimationFrame(frame);

const debug = installDebug({ game, ui, rig, view, perf, save, goStage, setTool, PIECE_LABEL, reset: () => ui.h.reset() });
window.__game = game;
