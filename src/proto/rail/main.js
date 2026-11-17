import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './proto.css';
import { initPhysics } from '../../core/physics.js';
import { Renderer } from '../../render/renderer.js';
import { FX } from '../../render/fx.js';
import { Audio } from '../../audio/audio.js';
import { RailWorld, STAIRS } from './world.js';

/**
 * 試作ページ：鉄道勢力との共存と衝突（ステージ2用の試作 A・B・C）。
 * 本編とは別のページ（proto-rail.html）。本編のセーブには触れない。
 */
await initPhysics();
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a211b');
const camera = new THREE.PerspectiveCamera(40, 1, 0.2, 600);
const view = new Renderer(canvas, scene, camera);
const audio = new Audio();
const fx = new FX(scene, camera, $('floaters'));
const rw = new RailWorld(scene, fx, audio);
view.useSun(rw.sun);
window.addEventListener('resize', () => view.resize());
view.resize();
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.maxPolarAngle = 1.45; controls.minDistance = 4; controls.maxDistance = 140;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const VIEWS = {
  all: [new THREE.Vector3(-6, 62, 52), new THREE.Vector3(-8, 0, 0)],
  cross: [new THREE.Vector3(-2.5, 8, -9), new THREE.Vector3(-10.5, 0.5, 0.5)],
  stationA: [new THREE.Vector3(-22, 8, 10), new THREE.Vector3(-11, 1, 4)],
  depot: [new THREE.Vector3(24, 10, 16), new THREE.Vector3(12, 1, 2)],
  side: [new THREE.Vector3(-10, 5.5, 16), new THREE.Vector3(-9, 1.5, 0)],
  stairs: [new THREE.Vector3(-4, 5, 9), new THREE.Vector3(-10, 1.6, 0)],
  bypass: [new THREE.Vector3(-20, 30, 34), new THREE.Vector3(-22, 0, 4)],
};
let fly = null, follow = null;
function setView(k) { const [p, t] = VIEWS[k]; fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: p.clone(), t1: t.clone(), t: 0 }; follow = null; }
camera.position.copy(VIEWS.all[0]); controls.target.copy(VIEWS.all[1]);
controls.addEventListener('start', () => { fly = null; follow = null; updateFollowChip(); });

// ================= 試行の記録（比較表） =================
class Attempt {
  constructor(method) {
    this.method = method; this.t0 = rw.time; this.prep = null; this.labels = [];
    this.stops = 0; this.protests = 0; this.delay = 0; this.rel = 0; this.thanks = 0; this.dominoes = 0; this.shaken = 0; this.removedByRail = 0; this.paxMax = rw.paxA;
    this.planks = 0; this.result = null; this.repairAt = null;
  }
  markPrep(label, end = false) { this.labels.push(`${label} ${Math.round(rw.time - this.t0)}s`); if (end) this.prep = rw.time - this.t0; }
  finish(r) { this.result = r; this.end = rw.time; attemptsLog.push(this); renderTable(); }
}
const attemptsLog = [];
const METHOD = { traffic: '🚦 交通整理', stairs: '🏗 ドミノ階段', wreck: '⛏ レール撤去', hammer: '🔨 破砕ハンマー', direct: '⚠ そのまま並べる' };
function begin(method) { if (!rw.attempt || rw.attempt.result) rw.attempt = new Attempt(method); else rw.attempt.method = method; }

// ================= 操作 =================
let scenario = new URLSearchParams(location.search).get('s') || 'A';
let speed = 1;
let pickMode = null; // 'wreck' | 'hammer'
const act = {
  archLv1: () => { rw.archLv = Math.max(1, rw.archLv); if (!rw.architect) { rw.reset(); } rw.architect.say('エリート建築士です。まずは歩道橋からお任せを', 'coin'); rw.news('エリート建築士 Lv.1 が加わった（試作：ガチャの代わり）'); },
  archLv2: () => { if (rw.archLv < 1) return; rw.archLv = 2; rw.architect.say('Lv.2：ドミノ階段も設計できます！', 'coin'); rw.news('エリート建築士 Lv.2：ドミノ階段（立体交差）を建設できるようになった'); },
  footbridge: () => { if (rw.archLv < 1) return toast('エリート建築士 Lv.1 が必要です'); rw.buildFootbridge(); },
  stairs: () => { if (rw.archLv < 2) return toast('エリート建築士 Lv.2 が必要です'); begin('stairs'); rw.attempt.planks = STAIRS.parts.length; rw.buildStairs().then((ok) => ok && rw.buildZone('stairs')); },
  stairsDominoes: () => rw.buildZone('stairs'),
  switchBP: () => { begin('traffic'); rw.setSwitchByPlayer('BP'); },
  switchA: () => rw.setSwitchByPlayer('A'),
  signalRed: () => { begin('traffic'); rw.setSignal(true); },
  signalGreen: () => rw.setSignal(false),
  flat: () => { const broken = rw.crossingPiece().state !== 'ok'; begin(rw.attempt && !rw.attempt.result ? rw.attempt.method : broken ? 'wreck' : 'direct'); rw.buildZone('flat'); },
  wreckCross: () => { begin('wreck'); rw.wreck(rw.crossingPiece()); },
  wreckPick: () => { pickMode = pickMode === 'wreck' ? null : 'wreck'; toast(pickMode ? '外したいレールをクリック（もう一度押すと解除）' : '指定を解除'); },
  hammer: () => { begin('hammer'); rw.smash(rw.crossingPiece()); },
  cleanup: () => rw.cleanupRails(),
  restand: () => rw.restandFallen(),
  run: () => { if (!rw.zone || !rw.zone.done) { toast('先に交差区間のドミノを並べてください'); } if (rw.startChain()) { follow = { kind: 'chain' }; updateFollowChip(); } },
  reset: () => { rw.keepStructures = $('keep').checked; rw.attempt = null; rw.reset(); follow = null; },
  relReset: () => { rw.relation = 70; rw.news('（試作）友好度を70に戻しました'); },
};
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), 2200); }

// ---- シナリオごとの説明とボタン ----
const SCEN = {
  A: {
    title: '試作A：エリート建築士と立体交差',
    goal: '線路を壊さずに、ドミノが階段を上って線路の上を越え、下りてゴールのベルを鳴らす。',
    steps: [
      ['① エリート建築士（Lv.1）を迎える', 'archLv1'], ['② 歩道橋を建てる（人が列車を待たずに線路を越えられる）', 'footbridge'],
      ['③ Lv.2 に上げる', 'archLv2'], ['④ ドミノ階段を建てる（材木を運んで組み立て → ドミノを並べる）', 'stairs'], ['⑤ ▶ 倒す', 'run'],
    ],
    tips: '比べてみよう：歩道橋の前後で、建設担当の「横断待ち」の回数と時間（右下）。階段の下を列車がくぐると喜ぶ。',
  },
  B: {
    title: '試作B：レールはがし隊と鉄道の修理班',
    goal: '交差地点のレールを外してドミノを通す。鉄道は後退・迂回し、修理班がレールを戻しに来る。',
    steps: [
      ['① 交差区間にドミノを並べる（線路の手前まで。線路の上は空くまで待つ）', 'flat'],
      ['② 交差地点のレールを撤去（レールはがし隊）', 'wreckCross'], ['　または 外すレールを自分で指定（クリック）', 'wreckPick'], ['　または 破砕ハンマー（速いが、衝撃と破片でまわりのドミノが倒れることも）', 'hammer'],
      ['③ すき間にドミノが入ったら、修理班が戻す前に ▶ 倒す', 'run'],
      ['（倒れたドミノを立て直す）', 'restand'],
    ],
    tips: '修理班はドミノがあると「どけてください」とお願いし、待っても動かなければ線路の脇にどかします。外した回数が多いと友好度が下がります。',
  },
  C: {
    title: '試作C：同じ交差地点を3つの方法で',
    goal: '交通整理・ドミノ階段・レール撤去のどれでも攻略できる。時間・資材・危険・鉄道への影響を比べよう（右の比較表）。',
    steps: [
      ['交差区間にドミノを並べる（線路の手前まで）', 'flat'],
      ['🚦 交通整理：ポイントSを迂回線へ', 'switchBP'], ['🚦 交通整理：駅Aの信号を赤に', 'signalRed'], ['　信号を青に戻す', 'signalGreen'], ['　ポイントSを本線に戻す', 'switchA'],
      ['🏗 エリート建築士 Lv.1→Lv.2', 'archBoth'], ['🏗 ドミノ階段を建てる', 'stairs'],
      ['⛏ レールを撤去', 'wreckCross'], ['🔨 破砕ハンマー', 'hammer'],
      ['交差区間にドミノを並べる（線路の上は、交差地点を空けたときだけ）', 'flat'], ['▶ 倒す', 'run'],
      ['🧹 連鎖のあと：線路の上の倒れたドミノを片付ける', 'cleanup'], ['（倒れたドミノを立て直す）', 'restand'],
    ],
    tips: 'どれか1つが常に最善にならないように：交通整理は資材ゼロだが時間制限と駅Aの不満、階段は時間と材木が要るが鉄道は喜ぶ、撤去は速いが関係が悪化し修理が来る。',
  },
};
act.archBoth = () => { act.archLv1(); setTimeout(() => act.archLv2(), 50); };
function renderPanel() {
  const sc = SCEN[scenario];
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.s === scenario));
  $('sc-title').textContent = sc.title; $('sc-goal').textContent = sc.goal; $('sc-tips').textContent = sc.tips;
  $('sc-steps').innerHTML = sc.steps.map(([label, k]) => `<button class="step" data-act="${k}">${label}</button>`).join('');
  $('sc-steps').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { audio.ensure && audio.ensure(); act[b.dataset.act](); }));
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { scenario = b.dataset.s; history.replaceState(null, '', `?s=${scenario}`); renderPanel(); }));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { speed = +b.dataset.speed; document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b)); }));
$('b-run').addEventListener('click', () => { audio.ensure && audio.ensure(); act.run(); });
$('b-reset').addEventListener('click', act.reset);
$('b-rel').addEventListener('click', act.relReset);
$('b-follow-chain').addEventListener('click', () => { follow = { kind: 'chain' }; updateFollowChip(); });
window.addEventListener('pointerdown', () => audio.ensure && audio.ensure(), { once: true });
document.querySelectorAll('[data-min]').forEach((b) => b.addEventListener('click', () => { const el = $(b.dataset.min); el.classList.toggle('min'); b.textContent = el.classList.contains('min') ? '＋' : '－'; }));
renderPanel();

// ---- クリック：列車・人を追いかける／撤去するレールを指定 ----
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null, hoverPiece = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointermove', (e) => {
  if (!pickMode) return;
  setNdc(e); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(allPieces().map((p) => p.mesh), true)[0];
  const p = hit && allPieces().find((q) => isChild(hit.object, q.mesh));
  highlight(p || null);
});
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  setNdc(e); ray.setFromCamera(ndc, camera);
  if (pickMode) {
    const hit = ray.intersectObjects(allPieces().map((p) => p.mesh), true)[0];
    const p = hit && allPieces().find((q) => isChild(hit.object, q.mesh));
    if (p && p.state === 'ok') { begin('wreck'); rw.wreck(p); pickMode = null; highlight(null); toast('レールはがし隊が向かいます'); }
    return;
  }
  const targets = [...rw.trains.map((t) => ({ obj: t.meshes[0], label: t.name, get: () => t.meshes[0].position })), ...rw.people.map((p) => ({ obj: p.root, label: p.name, get: () => p.pos }))];
  const hit = ray.intersectObjects(targets.map((t) => t.obj), true)[0];
  const t = hit && targets.find((x) => isChild(hit.object, x.obj));
  if (t) { follow = { kind: 'obj', get: t.get, label: t.label }; fly = null; updateFollowChip(); }
});
function setNdc(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
function isChild(o, root) { for (let x = o; x; x = x.parent) if (x === root) return true; return false; }
function allPieces() { return Object.values(rw.track.segs).flatMap((s) => s.pieces).filter((p) => p.state === 'ok'); }
function highlight(p) {
  if (hoverPiece === p) return;
  if (hoverPiece) hoverPiece.mesh.traverse((o) => { if (o.isMesh && o.userData.em != null) { o.material.emissive.setHex(o.userData.em); } });
  hoverPiece = p;
  if (p) p.mesh.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.userData.em = o.material.emissive.getHex(); o.material.emissive.set('#ff6b00'); } });
}
function updateFollowChip() { const el = $('follow'); el.textContent = follow ? (follow.kind === 'chain' ? '📷 連鎖の先頭を追いかけ中' : `📷 ${follow.label}を追いかけ中`) + '（ドラッグで解除）' : ''; el.classList.toggle('on', !!follow); }

// ================= 表示 =================
function renderTable() {
  const rows = attemptsLog.map((a, i) => {
    const r = a.result;
    const mat = a.method === 'stairs' ? `ドミノ${a.dominoes}・材木${a.planks}` : `ドミノ${a.dominoes}`;
    return `<tr><td>${i + 1}</td><td>${METHOD[a.method] || a.method}</td><td>${a.prep != null ? Math.round(a.prep) + '秒' : '—'}</td><td>${mat}</td>
      <td class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '成功' : '失敗'} ${r.n}/${r.total}${a.shaken ? `<br><small>衝撃で揺れた${a.shaken}枚</small>` : ''}${a.removedByRail ? `<br><small>鉄道がどかした${a.removedByRail}枚</small>` : ''}</td>
      <td>停車${a.stops}回・遅れ${Math.round(a.delay)}秒<br><small>抗議${a.protests}・駅A待ち最大${a.paxMax}人${a.thanks ? `・喜び${a.thanks}` : ''}</small></td>
      <td class="${a.rel >= 0 ? 'ok' : 'ng'}">${a.rel >= 0 ? '+' : ''}${Math.round(a.rel)}</td></tr>`;
  }).join('');
  $('table').innerHTML = `<tr><th>#</th><th>方法</th><th>準備</th><th>資材</th><th>連鎖</th><th>列車への影響</th><th>友好度</th></tr>${rows || '<tr><td colspan="7" class="muted">まだ記録がありません。方法を選んで「▶ 倒す」まで進めると記録されます</td></tr>'}`;
}
renderTable();
const STATE = { run: '走行中', dwell: '停車中', hold: '信号待ち', depot: '車庫で点検', reverse: '後退中' };
function renderStatus() {
  const rel = Math.round(rw.relation);
  $('rel-bar').style.width = rel + '%';
  $('rel-bar').style.background = rel >= 70 ? '#51cf66' : rel >= 40 ? '#fcc419' : '#ff6b6b';
  $('rel-num').textContent = `${rel}${rw.relation >= 85 ? '（差し入れあり）' : rw.relation < 30 ? '（不機嫌）' : ''}`;
  const mood = { happy: '😊', worried: '😟', angry: '😠' };
  $('trains').innerHTML = rw.trains.map((t) => {
    let st = STATE[t.state] || t.state;
    if (t.state === 'run' && Math.abs(t.v) < 0.05 && t.blockKind) st = { domino: 'ドミノで停車', person: '人がいて停車', gap: '線路が無い', debris: '破片で停車', train: '前の列車待ち' }[t.blockKind] || '停車';
    const leg = t.legAt(t.s).seg.label;
    return `<div>${mood[t.mood]} <b>${t.name}</b> ${st}<small>（${leg}）</small></div>`;
  }).join('');
  const S = rw.track.switches.S;
  $('rail-state').innerHTML = `ポイントS：<b>${S.state === 'A' ? '本線（駅A経由）' : '迂回線'}</b>${S.state === 'BP' && S.setBy === 'player' ? `<small>（あと${Math.max(0, Math.round((rw.trafficWindow || 50) - (rw.time - S.changedAt)))}秒で鉄道が戻す）</small>` : ''}<br>
    交通整理のお願い：${rw.time < (rw.refuseUntil || 0) ? `<b class="ng">断られ中（あと${Math.ceil(rw.refuseUntil - rw.time)}秒）</b>` : `<b>${3 - (rw.trafficUses || 0)}回</b><small>（次は${Math.max(20, 50 - 12 * (rw.trafficUses || 0))}秒まで）</small>`}<br>
    駅Aの信号：<b class="${rw.signalRed ? 'ng' : 'ok'}">${rw.signalRed ? '赤' : '青'}</b>${rw.signalRed ? `<small>（${Math.round(rw.holdT)}秒／${Math.max(18, (rw.trafficWindow || 50) - 10)}秒で駅長が戻す）</small>` : ''}・駅Aの待ち客 <b>${rw.paxA}人</b><br>
    交差地点のレール：<b>${{ ok: 'あり', removed: '撤去済み', broken: '破砕' }[rw.crossingPiece().state]}</b>${rw.repairing ? `<br>修理班：<b>${rw.repairing.stage}</b>（${Math.round(rw.time - rw.repairing.t0)}秒）` : ''}`;
  const z = rw.zone;
  const placed = z ? z.slots.filter((s) => s.domino).length : 0;
  $('our-state').innerHTML = `資材箱 <b>${rw.crate.count}</b>枚・材木 <b>${rw.planks}</b>本・エリート建築士 <b>${rw.archLv ? 'Lv.' + rw.archLv : 'なし'}</b><br>
    歩道橋：<b>${rw.footbridge ? (rw.footbridge.done ? '完成' : '建設中') : 'なし'}</b>・ドミノ階段：<b>${rw.stairs ? (rw.stairs.done ? '完成' : '建設中 ' + rw.stairs.parts.filter((p) => p.mesh.visible).length + '/' + rw.stairs.parts.length) : 'なし'}</b><br>
    交差区間：<b>${z ? `${placed}/${z.slots.length}枚` : '未着手'}</b>${rw.chain ? `・連鎖 <b>${rw.chain.done ? (rw.chain.result.ok ? '成功！' : '止まった') : '進行中…'}</b>` : ''}<br>
    <small>横断歩道で列車待ち：${rw.metrics.crossWaitCount}回・${Math.round(rw.metrics.crossWait)}秒${rw.metrics.removedByRail ? `・鉄道がどかしたドミノ ${rw.metrics.removedByRail}枚` : ''}</small>`;
  $('news').innerHTML = rw.newsLog.map((n) => `<div><small>${fmtT(n.t)}</small> ${n.text}</div>`).join('');
  $('clock').textContent = fmtT(rw.time);
}
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ================= ループ =================
let last = performance.now(), uiT = 0;
function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000); last = now;
  const total = raw * speed;
  const n = Math.max(1, Math.ceil(total / (1 / 30)));
  for (let i = 0; i < n; i++) rw.update(total / n);
  // カメラ
  if (fly) { fly.t = Math.min(1, fly.t + raw * 1.4); const k = fly.t * fly.t * (3 - 2 * fly.t); camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.t0, fly.t1, k); if (fly.t >= 1) fly = null; }
  if (follow) {
    let p = null;
    if (follow.kind === 'chain' && rw.chain) { const f = rw.chain.front; if (f && !f.removed) { const t = f.body.translation(); p = new THREE.Vector3(t.x, t.y, t.z); } }
    if (follow.kind === 'obj') p = follow.get().clone();
    if (p) { const d = p.clone().sub(controls.target); controls.target.addScaledVector(d, Math.min(1, raw * 4)); camera.position.addScaledVector(d, Math.min(1, raw * 4)); }
  }
  controls.update();
  view.followShadow(controls.target, new THREE.Vector3(-30, 60, 25));
  view.render();
  fx.update(raw, window.innerWidth, window.innerHeight);
  uiT -= raw; if (uiT <= 0) { uiT = 0.25; renderStatus(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__proto = { rw, act, setView, camera, controls, VIEWS, render: () => { controls.update(); view.followShadow(controls.target, new THREE.Vector3(-30, 60, 25)); view.render(); fx.update(0.016, window.innerWidth, window.innerHeight); renderStatus(); }, attemptsLog, get speed() { return speed; }, set speed(v) { speed = v; } };
