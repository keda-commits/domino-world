import { PARTS, EVOLUTIONS, RARITY, CATEGORY } from '../data/parts.js';
import { PIECE_LABEL } from '../game/game.js';
import { STAGES } from '../world/stages.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('ja-JP');
const ROLE_LABEL = { builder: '👷 建設担当', carrier: '📦 運搬担当', collector: '🧺 回収担当', stopperCrew: '🦺 ストッパー設置係', restorer: '🚑 復旧係', guard: '👮 警備係' };
const PIECE_ICON = { bell: '🔔', barricade: '🚧', sensor: '📡' };
const STAGE_PIECES = ['bell', 'barricade', 'sensor'];

/** 画面の HUD・メニュー（コンパクト版） */
export class UI {
  constructor(game, h) {
    this.g = game; this.h = h;
    this.flashT = 0;
    document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => h.setTool(b.dataset.tool)));
    document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => h.setSpeed(+b.dataset.speed)));
    document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => h.setView(b.dataset.view)));
    $('b-cam-reset').onclick = () => h.resetCam();
    document.querySelectorAll('[data-rv]').forEach((b) => (b.onclick = () => h.setRunView(b.dataset.rv)));
    $('b-run').onclick = () => h.run();
    $('b-rewind').onclick = () => h.rewind();
    const tidy = $('b-tidy');
    tidy.onpointerdown = (e) => { e.preventDefault(); h.tidyHold(true); };
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => tidy.addEventListener(ev, () => h.tidyHold(false)));
    $('b-pause').onclick = () => h.togglePause();
    $('b-menu').onclick = () => this.togglePanel();
    $('pn-close').onclick = () => this.togglePanel(false);
    document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab)));
    $('g3-fast').onclick = () => { const on = h.gachaFast(); $('g3-fast').classList.toggle('on', on); };
    $('g3-skip').onclick = () => h.gachaSkip();
    this.curTab = 'records';
  }

  // ---------------- ツール ----------------
  setTool(t) {
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t || (t.startsWith('piece:') && b.dataset.tool === 'pieces')));
    const hints = {
      play: 'ドラッグ：ドミノをつかむ（おもちゃ箱・資材箱から取り出せる）／離す：置く・勢いで投げる／ダブルクリック：デコピン／何もない所をドラッグ：カメラ移動',
      test: '試し倒し：設計図の上で始点→終点をクリック。その区間だけ倒して、自動で元に戻します。',
      stopper: 'ストッパーをクリックして🔒ロック（本番でも外さない）を切り替え。',
    };
    $('tool-hint').textContent = t.startsWith('piece:') ? `${PIECE_LABEL[t.slice(6)]}：クリックで置く（Q/Eで回転、右クリックで取りやめ）` : hints[t] || '';
    const pop = $('piece-pop');
    if (t === 'pieces') {
      const types = STAGE_PIECES.filter((p) => this.g.level(p) > 0);
      pop.innerHTML = types.length ? types.map((p) => `<button data-piece="${p}">${PIECE_ICON[p]} ${PIECE_LABEL[p]}（残り${this.g.placeableCount(p) - this.g.placeableUsed(p)}）</button>`).join('') : '<span style="font-size:12px;color:#d9c9b6">ガチャで警報ベル・バリケード・接近センサーを手に入れると置けます（ステージ2）</span>';
      pop.querySelectorAll('[data-piece]').forEach((b) => (b.onclick = () => this.h.setTool('piece:' + b.dataset.piece)));
      pop.classList.remove('hidden');
    } else if (!t.startsWith('piece:')) pop.classList.add('hidden');
  }

  setPaused(p) { $('b-pause').textContent = p ? '▶' : '⏸'; $('b-pause').classList.toggle('on', p); }
  setSpeed(s) { document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s)); }
  setView(v) { document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v)); }
  setRunView(v) { document.querySelectorAll('[data-rv]').forEach((b) => b.classList.toggle('on', b.dataset.rv === v)); }

  // ---------------- 定期更新 ----------------
  refresh() {
    const g = this.g, P = g.progress;
    if (!g.stageId) return;
    const def = g.def;
    $('stage-name').innerHTML = `${def.name}<small>${def.title}</small>`;
    const next = g.nextCheckpoint();
    const pf = g.preflight();
    const bp = g.buildProgress();
    const total = bp.total;
    const frontIdx = this.frontIndex();
    if (g.records[g.stageId].cleared) $('next-goal').innerHTML = '👑 クリア済み！ さらに記録をのばそう';
    else if (next) {
      const need = Math.max(0, next.slotIndex + 2 - frontIdx);
      $('next-goal').innerHTML = `🎯 次の中間ゴール${next.index + 1}「${next.def.name}」${need > 0 ? `まで あと <b>${need}</b> 個` : '：<b>建設済み！ 倒して届けよう</b>'}`;
    } else {
      const need = Math.max(0, total - frontIdx);
      $('next-goal').innerHTML = `🏁 最終ゴールまで ${need > 0 ? `あと <b>${need}</b> 個` : '<b>完成！ 倒してゴールへ！</b>'}`;
    }
    // 経験値（1枚 = 1XP）
    $('xp-lv').textContent = `Lv.${P.level}`;
    $('xp-fill').style.width = `${(P.xp / P.need()) * 100}%`;
    $('xp-left').textContent = `あと${fmt(P.need() - P.xp)}枚でガチャ`;
    const tk = P.tickets.length;
    $('xp-tickets').classList.toggle('hidden', !tk);
    $('xp-tickets').textContent = `🎁×${tk}`;
    // 建設進捗（設計図の何個目まで並んでいるか）
    $('pl-fill').style.width = `${total ? (frontIdx / total) * 100 : 0}%`;
    const marks = (g.checkpoints || []).map((c) => `<div class="mk ${c.done ? 'done' : ''}" style="left:${(c.slotIndex / total) * 100}%" title="${c.def.name}">${c.index + 1}</div>`).join('') + `<div class="mk goal" style="left:100%">🏁</div>`;
    if (marks !== this._marks) { $('pl-marks').innerHTML = marks; this._marks = marks; }
    const crew = g.workers.list.length;
    $('pl-text').innerHTML = `建設 <b>${fmt(frontIdx)}</b> / ${fmt(total)} 個 ・ 在庫 ${fmt(g.stock + g.crate.count)} ・ 人員 ${crew}人${g.level('machine') ? ' ＋ 自動設置機' : ''} ・ 最長連鎖 ${fmt(g.records[g.stageId].best)}`;
    // 小さな警告（確認ダイアログの代わり）
    const w = [];
    if (g.hint && g.time < g.hint.until) w.push(`<span class="hint">${g.hint.text}</span>`);
    if (pf.fallen) w.push(`倒れたまま ${pf.fallen}個（🧹で起こせる）`);
    if (pf.locked) w.push(`🔒ロック中のストッパー ${pf.locked}個`);
    if (g.roomba && g.roomba.state !== 'dock') w.push('🤖 ルンバ巡回中！');
    else if (g.roomba) w.push(`<span class="info">🤖 ルンバ出動まで ${Math.ceil(g.roomba.timer)}秒（次：${g.roomba.pattern.name}）</span>`);
    if (g.alarm) w.push('⚠ 警報発令中');
    const wh = w.map((x) => (x.startsWith('<span class="info">') ? `<div class="w info">${x.slice(19, -7)}</div>` : x.startsWith('<span class="hint">') ? `<div class="w hint">${x.slice(19, -7)}</div>` : `<div class="w">${x}</div>`)).join('');
    if (wh !== this._warns) { $('warns').innerHTML = wh; this._warns = wh; }
    // ボタン
    const building = g.mode === 'build';
    $('b-run').disabled = !building || g.gachaActive;
    $('b-run').classList.toggle('ready', building && frontIdx >= total && !pf.fallen);
    $('b-tidy').disabled = !building;
    $('b-rewind').disabled = !building || g.rewinds <= 0 || !g.snapshot;
    $('rewind-sub').textContent = `×${g.rewinds}`;
    // 連鎖中
    const run = g.run;
    document.body.classList.toggle('mode-run', !!run && run.kind === 'main');
    $('runhud').classList.toggle('hidden', !run);
    $('run-view').classList.toggle('hidden', !(run && run.kind === 'main'));
    if (run) {
      $('rh-count').textContent = fmt(run.count);
      const tot = g.course.allSlots.length || 1;
      $('rh-prog').querySelector('i').style.width = `${Math.min(100, (Math.max(0, run.frontOrder + 1) / tot) * 100)}%`;
      const best = (g.records[g.stageId] || {}).best || 0;
      const bm = $('rh-prog').querySelector('b');
      bm.style.display = best > 0 && best < tot ? 'block' : 'none'; bm.style.left = `${(best / tot) * 100}%`;
      $('rh-rec').classList.toggle('hidden', !(run.kind === 'main' && best > 0 && run.count > best));
      $('rh-piggy').classList.toggle('hidden', !(g.piggy && run.kind === 'main'));
      if (g.piggy) $('rh-piggy').querySelector('b').textContent = fmt(run.piggy);
    }
    $('vignette').classList.toggle('show', !!g.alarm && !!g.roomba && g.roomba.state !== 'dock');
    if (!$('panel').classList.contains('hidden') && this.curTab !== 'settings') this.renderTab(this.curTab, true);
  }

  /** 設計図の先頭から連続して立っている数（＝建設の先頭） */
  frontIndex() {
    const g = this.g;
    const f = g.frontSlot();
    const main = g.course.segments[0];
    if (!main) return 0;
    return f && f.seg === main ? f.i : main.slots.length;
  }

  // ---------------- 連鎖終了の短い演出 ----------------
  flash(r, done) {
    const el = $('flash');
    const lines = [];
    if (r.cleared) lines.push('<div class="f-line clear">🎉 STAGE CLEAR！</div>');
    if (r.newBest && r.prevBest > 0) lines.push('<div class="f-line rec">NEW RECORD！</div>');
    for (const c of r.checkpoints || []) lines.push(`<div class="f-line cp">🎯 中間ゴール${c.index + 1}「${c.name}」到達！</div>`);
    if (r.presents) lines.push(`<div class="f-line cp">🎁 プレゼントドミノ ×${r.presents}</div>`);
    if (!r.cleared && r.reason) lines.push(`<div class="f-line fail">📍 ${r.reason}</div>`);
    const xp = `+${fmt(r.xp.total)} XP${r.xp.record ? `（うち新記録ボーナス +${fmt(r.xp.record)}）` : ''}${r.levelUps ? ` ・ レベルアップ×${r.levelUps}` : ''}`;
    el.innerHTML = `<div class="f-big">${fmt(r.count)}連鎖！</div>${lines.join('')}<div class="f-xp">${xp}</div>`;
    el.classList.remove('hidden');
    clearTimeout(this._flashTO);
    const hold = r.cleared ? 3600 : 2300;
    this._flashTO = setTimeout(() => { el.classList.add('hidden'); done && done(); }, hold);
  }

  // ---------------- メニュー ----------------
  togglePanel(v) {
    const p = $('panel');
    const show = v ?? p.classList.contains('hidden');
    if (this.h.onPanel) this.h.onPanel(show);
    p.classList.toggle('hidden', !show);
    if (show) this.tab(this.curTab);
  }
  tab(t) {
    this.curTab = t;
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    this.renderTab(t);
  }
  renderTab(t, soft = false) {
    const g = this.g, P = g.progress, body = $('pn-body');
    let html = '';
    if (t === 'records') {
      const rec = g.records[g.stageId];
      html += `<h3>このステージ</h3><table><tr><td>最長連鎖</td><td>${fmt(rec.best)}</td></tr><tr><td>挑戦回数</td><td>${rec.attempts}</td></tr><tr><td>中間ゴール</td><td>${(g.checkpoints || []).filter((c) => c.done).length} / ${(g.checkpoints || []).length}</td></tr><tr><td>累計転倒数</td><td>${fmt(g.stats.totalToppled)}</td></tr><tr><td>ルンバに倒された</td><td>${fmt(g.stats.roombaKnocks)}</td></tr><tr><td>緊急出動</td><td>${fmt(g.stats.emergencies)}</td></tr></table>`;
      html += '<h3>最近の連鎖</h3><table>' + (g.history || []).slice(0, 15).map((h) => `<tr><td>S${h.stage} ${new Date(h.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}　${h.cleared ? '👑クリア' : h.reason || ''}${h.record ? '　🏆' : ''}${h.checkpoints.length ? `　🎯${h.checkpoints.join(',')}` : ''}</td><td>${fmt(h.count)}連鎖 +${fmt(h.xp)}XP</td></tr>`).join('') + '</table>';
    } else if (t === 'build') {
      for (const [id, on] of Object.entries(P.evolutions)) if (on) { const e = EVOLUTIONS[id]; html += `<div class="bp"><div class="ic">${e.icon}</div><div class="nm">${e.name}</div><div class="lv">進化</div><div class="ds">${e.desc}</div></div>`; }
      const owned = Object.entries(P.parts).filter(([, v]) => v > 0);
      if (!owned.length) html += '<p>まだパーツがありません。ドミノを倒して経験値を貯めよう。</p>';
      for (const [id, lv] of owned) {
        const p = PARTS[id];
        const unused = !p.stages.includes(g.stageId);
        html += `<div class="bp"><div class="ic">${p.icon}</div><div class="nm">${p.name}${unused ? '（このステージでは使わない）' : ''}</div><div class="lv">${p.consumable ? `所持 ${g.rewinds}` : `Lv.${lv}`}</div><div class="ds">${CATEGORY[p.category].label}・${RARITY[p.rarity].label}</div></div>`;
      }
      html += '<h3>合体進化</h3>' + Object.entries(EVOLUTIONS).filter(([id]) => !P.evolutions[id]).map(([, e]) => `<div class="bp"><div class="ic">${e.icon}</div><div class="nm">${e.name}</div><div class="lv"></div><div class="ds">${Object.entries(e.requires).map(([k, v]) => `${PARTS[k].name} ${Math.min(P.lv(k), v)}/${v}${P.lv(k) >= v ? '✓' : ''}`).join('　')}</div></div>`).join('');
    } else if (t === 'crew') {
      const counts = {};
      for (const w of g.workers.list) { const c = (counts[w.role] ||= { n: 0, busy: 0 }); c.n++; if (w.state === 'walk' || (w.state === 'act' && w.pose !== 'idle' && w.pose !== 'shrug')) c.busy++; }
      html += '<table>' + Object.keys(ROLE_LABEL).filter((r) => counts[r]).map((r) => `<tr><td>${ROLE_LABEL[r]}</td><td>${counts[r].busy} / ${counts[r].n}人 作業中</td></tr>`).join('');
      if (g.level('machine')) html += `<tr><td>🚜 自動設置機</td><td>${g.machine.hopper ? `稼働中（ホッパー${g.machine.hopper}）` : '補給待ち'}</td></tr>`;
      if (g.level('train')) html += `<tr><td>🚂 運搬列車</td><td>${g.train.load ? '運搬中' : '積み込み'}</td></tr>`;
      html += `<tr><td>🦺 ストッパー</td><td>${g.stoppers.length}個${g.stoppers.some((s) => s.gate) ? '（ゲート）' : ''}</td></tr><tr><td>🧱 在庫</td><td>${fmt(g.stock)}（前線 ${g.crate.count}）</td></tr></table>`;
      if (!g.workers.list.length) html += '<p>まだ誰もいません。最初のガチャで建設担当が加わります。</p>';
    } else if (t === 'stages') {
      html += [1, 2].map((id) => { const st = STAGES[id], rec = g.records[id]; const locked = id > g.unlockedStage; return `<div class="bp"><div class="ic">${locked ? '🔒' : id === g.stageId ? '▶' : '🗺'}</div><div class="nm">${st.name}「${st.title}」</div><div class="lv">${rec.cleared ? '👑' : ''}</div><div class="ds">${st.goalText}｜最長 ${fmt(rec.best)}　${locked ? 'STAGE 1 をクリアすると解放' : `<button class="pbtn" data-go="${id}">${id === g.stageId ? 'ここにいる' : 'ここへ行く'}</button>`}</div></div>`; }).join('');
      html += '<p>パーツとレベルはステージ間で引き継がれます。建設中のドミノはステージごとに保存されます。</p>';
    } else if (t === 'settings') {
      const s = this.h.getSettings();
      html += `<div class="set-row"><label>画質</label><select id="set-q"><option value="low">低（軽い）</option><option value="mid">中（おすすめ）</option><option value="high">高（被写界深度）</option></select></div>
        <div class="set-row"><label>BGM 音量</label><input id="set-bgm" type="range" min="0" max="1" step="0.05" value="${s.music}"></div>
        <div class="set-row"><label>効果音 音量</label><input id="set-sfx" type="range" min="0" max="1" step="0.05" value="${s.sfx}"></div>
        <div class="set-row"><label>ルンバ・敵の音量</label><input id="set-threat" type="range" min="0" max="1" step="0.05" value="${s.threatVol ?? 0.6}"></div>
        <div class="set-row"><label>ガチャ早送り</label><input id="set-gfast" type="checkbox" ${s.gachaFast ? 'checked' : ''}></div>
        <p style="color:#d9c9b6">セーブは自動（建設中のドミノも保存）。</p>
        <button class="pbtn" id="set-save">💾 今すぐセーブ</button><button class="pbtn" id="set-load">📂 最後のセーブを読み込む</button><button class="pbtn warn" id="set-reset">↺ 最初からやり直す</button>`;
    } else if (t === 'help') {
      html += `<h3>遊び方</h3><ol><li>床の<b>設計図（点線）</b>に沿ってドミノを並べます。おもちゃ箱や資材箱から<b>ドラッグでドミノを取り出し</b>、マスの上で<b>そっと離す</b>と立ちます（緑の輪がガイド）。</li>
        <li>いつでも<b>「▶ 倒す！」</b>。倒れた<b>1枚 = 1XP</b>。上のゲージが満タンでガチャ。本番中は手を出さず、連鎖を見守ります（俯瞰／連鎖追跡の切り替えだけ可能）。</li>
        <li>連鎖が<b>中間ゴール</b>の装置に届くと<b>確定ガチャ</b>（各中間ゴールで一度きり）。</li>
        <li>ガチャで人や機械を増やすと、建設・運搬・片付けが自動になります。</li>
        <li>建設中の事故やネズミのいたずらでドミノが倒れ始めたら、<b>連鎖の先のドミノを1枚つかんで抜く</b>と止まります。ストッパーズを呼ぶと自動で止めてくれます。</li>
        <li>スタートからの一本の連鎖が<b>最終ゴール装置</b>を動かせばクリア。</li></ol>
        <h3>ドミノや物を触る</h3><p>カーソルを合わせて<b>黄色い輪</b>が出たものはつかめます。<b>ドラッグ</b>：つかんで動かす（ドミノ・資材箱・積み木やぬいぐるみ等の小物・人・設置機や製造機）。資材箱は<b>中のドミノ</b>をドラッグで1枚取り出し、<b>縁や旗</b>をドラッグで箱ごと運べます／<b>離す</b>：その場に落とす（勢いよく動かして離すと投げる）<br>
        つかんでいる間：<b>ホイール</b>で高さ、<b>Q / E</b>で向き、<b>Shift＋ホイール</b>で傾き<br><b>ダブルクリック</b>：デコピン（押した向きに倒れる）／人に投げると…びっくりします</p>
        <h3>カメラ</h3><p><b>左ドラッグ（何もない所）</b>／WASD：平行移動　<b>右ドラッグ</b>／Alt＋左ドラッグ：回転　ホイール：カーソル位置へズーム<br>空き場所をダブルクリック：そこへ注目　Home：建設現場へ戻る　上の「建設・観賞・追跡・俯瞰」で視点切り替え</p>
        <h3>キー</h3><p>Enter：倒す／R（長押し）：片付け／1〜4：道具／B・V・F・O：視点／P：一時停止／ガチャ中：1〜3で選択・Spaceでスキップ</p>`;
    }
    if (soft && t !== 'records' && t !== 'crew') return;
    body.innerHTML = html;
    if (t === 'settings') {
      const s = this.h.getSettings();
      $('set-q').value = s.quality;
      $('set-q').onchange = (e) => this.h.setSetting('quality', e.target.value);
      $('set-bgm').oninput = (e) => this.h.setSetting('music', +e.target.value);
      $('set-sfx').oninput = (e) => this.h.setSetting('sfx', +e.target.value);
      $('set-threat').oninput = (e) => this.h.setSetting('threatVol', +e.target.value);
      $('set-gfast').onchange = (e) => this.h.setSetting('gachaFast', e.target.checked);
      $('set-save').onclick = () => this.h.save(true);
      $('set-load').onclick = () => this.h.load();
      $('set-reset').onclick = () => this.confirm('最初からやり直しますか？', 'レベル・パーツ・建設・記録がすべて消えます（以前のバージョンのセーブは消えません）。', () => this.h.reset());
    }
    if (t === 'stages') body.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { this.togglePanel(false); this.h.goStage(+b.dataset.go); }));
  }

  // ---------------- ダイアログ ----------------
  dialog(html, buttons) {
    const card = $('dialog-card');
    card.innerHTML = html + '<div class="btn-row"></div>';
    const row = card.querySelector('.btn-row');
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = b.cls || '';
      el.innerHTML = b.label;
      el.onclick = () => { $('dialog').classList.add('hidden'); b.fn && b.fn(); };
      row.appendChild(el);
    }
    $('dialog').classList.remove('hidden');
  }
  confirm(title, body, fn) { this.dialog(`<h2>${title}</h2><p>${body}</p>`, [{ label: 'はい', fn }, { label: 'やめる', cls: 'sub' }]); }
  /** ホバーステータス（カーソルの近く。画面からはみ出さない・アイテムを隠さない位置） */
  showHover(info, x, y, compact = false) {
    const el = $('hover-tip');
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const html = `<h5 class="${info.warn ? 'warn' : ''}">${esc(info.title)}</h5>` + (info.rows || []).map(([a, b]) => `<div class="r"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('') + (info.note && !compact ? `<div style="margin-top:4px;color:#c9d1dd">${esc(info.note).split('\n').join('<br>')}</div>` : info.note ? `<div style="margin-top:3px;color:#8ff0a4">${esc(info.note)}</div>` : '');
    if (html !== this._hoverHtml) { el.innerHTML = html; this._hoverHtml = html; }
    el.classList.remove('hidden');
    const w = el.offsetWidth, h = el.offsetHeight;
    let px = x + 22, py = y + 18;
    if (px + w > window.innerWidth - 8) px = x - w - 22;
    if (py + h > window.innerHeight - 8) py = y - h - 14;
    el.style.left = `${Math.max(8, px)}px`; el.style.top = `${Math.max(8, py)}px`;
  }
  hideHover() { $('hover-tip').classList.add('hidden'); this._hoverHtml = null; }
  get modalOpen() { return !$('dialog').classList.contains('hidden'); }
  comingSoon(fn) {
    this.dialog(`<div class="dog"><div class="paw">🐾</div><div class="soon">COMING SOON</div><h2>STAGE 3　巨大な犬</h2><p>ドミノの前にしっぽを振る巨大な犬が現れる…！<br>次回、「おすわりベル」で犬をおすわりさせながら、もっと長い連鎖に挑め！</p></div>`, [{ label: 'たのしみ！', fn }]);
  }
}
