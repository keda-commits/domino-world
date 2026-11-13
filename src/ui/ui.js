import { PARTS, EVOLUTIONS, RARITY, CATEGORY } from '../data/parts.js';
import { PIECE_LABEL } from '../game/game.js';
import { STAGES } from '../world/stages.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('ja-JP');
const ROLE_LABEL = { builder: '👷 建設', carrier: '📦 運搬', collector: '🧺 回収', stopperCrew: '🦺 設置係', restorer: '🚑 復旧係', guard: '👮 警備係' };
const PIECE_ICON = { minicar: '🏎', marble: '🔵', bridge: '🌉', bell: '🔔', barricade: '🚧', sensor: '📡' };

/** HUD・ツール・モーダル */
export class UI {
  constructor(game, h) {
    this.g = game; this.h = h;
    this.toastT = 0;
    document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => h.setTool(b.dataset.tool)));
    document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab)));
    document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => h.setSpeed(+b.dataset.speed)));
    $('b-run').onclick = () => h.run();
    $('b-rewind').onclick = () => h.rewind();
    const tidy = $('b-tidy');
    tidy.onpointerdown = (e) => { e.preventDefault(); h.tidyHold(true); };
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => tidy.addEventListener(ev, () => h.tidyHold(false)));
    $('b-pause').onclick = () => h.togglePause();
    $('cam-mode').onchange = (e) => h.setCam(e.target.value);
    $('b-autocam').onclick = () => h.toggleAutoCam();
    $('b-save').onclick = () => h.save(true);
    $('b-stages').onclick = () => this.stageSelect();
    $('b-settings').onclick = () => this.settings();
    $('b-help').onclick = () => this.showHelp(true);
    $('b-help-close').onclick = () => this.showHelp(false);
    $('b-clear-course').onclick = () => this.confirm('コースを全部消しますか？', '建っているドミノは在庫に戻ります。', () => h.clearCourse());
  }

  tab(t) {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $('tab-design').classList.toggle('hidden', t !== 'design');
    $('tab-build').classList.toggle('hidden', t !== 'build');
    if (t === 'build') this.buildList();
  }
  setTool(t) {
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    document.querySelectorAll('.piece').forEach((b) => b.classList.toggle('on', 'piece:' + b.dataset.piece === t));
    const hints = {
      play: 'クリック：近くの計画マスにドミノを置く／倒れたドミノを起こす。長押しで連続。',
      draw: '緑の輪（スタート）や黄色の輪（コースの端）からドラッグして描く。ピンクの輪（ゴール・装置の入口）の近くで離すと接続。分岐パーツがあれば途中からも描けます。',
      erase: 'クリックした位置から先のコースを消す。置いたパーツをクリックすると撤去。',
      test: '区間テスト：コース上の始点→終点の順にクリック。その区間だけ試し倒しして、終わると自動で元に戻ります（経験値なし）。',
      stopper: 'ストッパーをクリック：🔒ロック（本番でも外さない）を切り替え。区間を守りたい時に。',
    };
    $('tool-hint').textContent = t.startsWith('piece:') ? `クリックで配置（Q/Eで回転）。${PIECE_LABEL[t.slice(6)]}` + (t === 'piece:bell' ? '：コースのすぐ横に。連鎖で鳴る。' : t === 'piece:barricade' || t === 'piece:sensor' ? '：ルンバ対策。' : '：置いたら、入口へ線をつなぎ、出口から線を引く。') : hints[t] || '';
  }
  showHelp(v) { $('help').classList.toggle('hidden', !v); if (!v) this.h.helpClosed && this.h.helpClosed(); }
  get modalOpen() { return ['help', 'result', 'gacha', 'dialog'].some((id) => !$(id).classList.contains('hidden')); }

  toast(t1, t2, t3, time = 2.6) {
    const el = $('toast');
    el.innerHTML = `<div class="t1">${t1}</div><div class="t2">${t2}</div>${t3 ? `<div class="t3">${t3}</div>` : ''}`;
    el.classList.add('show');
    this.toastT = time;
  }
  tick(dt) { if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); } }

  setPaused(p) { $('b-pause').textContent = p ? '▶' : '⏸'; $('b-pause').classList.toggle('on', p); }
  setSpeed(s) { document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s)); }
  setCam(m) { $('cam-mode').value = m; }
  setAutoCam(a) { $('b-autocam').classList.toggle('on', a); }

  // ---------------- 定期更新 ----------------
  refresh() {
    const g = this.g, P = g.progress;
    if (!g.stageId) return;
    const def = g.def;
    $('stage-name').textContent = `${def.name}「${def.title}」`;
    $('goal-text').textContent = `🎯 ${def.goalText}`;
    $('xp-lv').textContent = `Lv.${P.level}`;
    $('xp-text').textContent = `ドミノ経験値 ${fmt(P.xp)} / ${fmt(P.need())}`;
    $('xp-left').textContent = `あと${fmt(P.need() - P.xp)}枚でガチャ！`;
    $('xp-fill').style.width = `${(P.xp / P.need()) * 100}%`;
    const tk = P.tickets.length;
    $('xp-tickets').classList.toggle('hidden', !tk);
    $('xp-tickets').textContent = `ガチャ ×${tk}`;
    const bp = g.buildProgress();
    $('s-progress').textContent = `${fmt(bp.standing)} / ${fmt(bp.total)}`;
    $('s-pfill').style.width = `${bp.total ? (bp.standing / Math.max(bp.total, def.target)) * 100 : 0}%`;
    $('s-ptarget').style.left = `${Math.min(100, (def.target / Math.max(bp.total, def.target)) * 100)}%`;
    $('s-target').textContent = `${fmt(def.target)}個` + (g.course.connected() ? '（ゴール接続済）' : '（未接続）');
    $('s-best').textContent = fmt(g.records[g.stageId].best);
    $('s-total').textContent = fmt(g.stats.totalToppled);
    $('s-stock').textContent = `${fmt(g.stock)}${g.crate.count ? `（前線 ${g.crate.count}）` : ''}`;
    // 稼働状況
    const counts = {};
    for (const w of g.workers.list) {
      const c = (counts[w.role] ||= { n: 0, busy: 0 });
      c.n++; if (w.state === 'walk' || (w.state === 'act' && w.pose !== 'idle' && w.pose !== 'shrug')) c.busy++;
    }
    let html = '';
    for (const r of Object.keys(ROLE_LABEL)) if (counts[r]) html += `<span>${ROLE_LABEL[r]} <b class="${counts[r].busy ? 'busy' : ''}">${counts[r].busy}/${counts[r].n}</b></span>`;
    if (g.level('machine')) html += `<span>🚜 設置機 <b class="${g.machine.hopper ? 'busy' : ''}">${g.machine.hopper ? '稼働' : '補給待ち'}</b></span>`;
    if (g.level('train')) html += `<span>🚂 列車 <b>${g.train.load ? '運搬中' : '積込'}</b></span>`;
    $('s-crew').innerHTML = html || '<span>（まだ誰もいない）</span>';
    const locked = g.stoppers.filter((s) => s.locked).length;
    $('s-stoppers').textContent = `${g.stoppers.length}個${locked ? `（🔒${locked}）` : ''}${g.stoppers.some((s) => s.gate) ? '・ゲート' : ''}`;
    const r = g.roomba;
    $('s-roomba').classList.toggle('hidden', !r);
    if (r) $('s-roomba').textContent = r.state === 'dock' ? `🤖 ルンバ出動まで ${Math.ceil(r.timer)}秒（次：${r.pattern.name}）` : r.state === 'return' ? '🤖 ルンバ帰還中' : `🤖 ルンバ巡回中！（${r.pattern.name}）`;
    $('s-alarm').classList.toggle('hidden', !g.alarm);
    // ボタン
    const building = g.mode === 'build';
    const pf = g.preflight();
    $('b-run').disabled = !building || pf.total === 0;
    $('b-run').classList.toggle('ready', building && pf.connected && pf.unbuilt === 0 && pf.fallen === 0 && pf.total >= def.target);
    $('b-tidy').disabled = !building;
    $('b-rewind').disabled = !building || g.rewinds <= 0 || !g.snapshot;
    $('rewind-sub').textContent = `×${g.rewinds}`;
    // ランHUD
    const run = g.run;
    $('runhud').classList.toggle('hidden', !run);
    if (run) {
      $('rh-count').textContent = fmt(run.count);
      $('rh-target').textContent = run.kind === 'test' ? ` / 区間 ${run.total}` : ` / ${fmt(def.target)}`;
      $('rh-piggy').classList.toggle('hidden', !(g.piggy && run.kind === 'main'));
      if (g.piggy) $('rh-piggy').querySelector('b').textContent = fmt(run.piggy);
    }
    // バナー
    let banner = '';
    if (!run && building) {
      if (pf.total === 0) banner = '「✏ 描く」でスタートからゴールまでコースを描こう';
      else if (!pf.connected) banner = 'コースがゴールにつながっていません（ピンクの輪へ）';
      else if (pf.total < def.target) banner = `コースが短い：あと${fmt(def.target - pf.total)}個ぶん延ばそう`;
      else if (pf.unbuilt) banner = `建設中… 残り ${fmt(pf.unbuilt)} 個`;
      else if (pf.fallen) banner = `倒れたドミノが ${pf.fallen} 個あります（片付けで起こそう）`;
      else banner = '準備完了！「▶ 倒す！」で本番！';
    }
    if (g.mode === 'test') banner = '🧪 区間テスト中…（終わると元に戻ります）';
    $('banner').textContent = banner;
    $('vignette').classList.toggle('show', !!g.alarm && !!r && r.state !== 'dock');
    this.pieceList();
  }

  pieceList() {
    const g = this.g;
    const list = $('piece-list');
    const types = Object.keys(PIECE_LABEL).filter((t) => g.level(t) > 0);
    const key = types.map((t) => `${t}${g.placeableUsed(t)}/${g.placeableCount(t)}`).join('|') + (g.branchesLeft() > 0 ? 'b' + g.branchesLeft() : '');
    if (key === this._pkey) return;
    this._pkey = key;
    list.innerHTML = types.length ? '' : '<div class="hint">ガチャでミニカー・ビー玉・高架橋・ベル・バリケード・センサーを手に入れると、ここから配置できます。</div>';
    for (const t of types) {
      const b = document.createElement('div');
      const left = g.placeableCount(t) - g.placeableUsed(t);
      b.className = 'piece' + (left <= 0 ? ' empty' : '');
      b.dataset.piece = t;
      b.innerHTML = `<span>${PIECE_ICON[t]} ${PIECE_LABEL[t]}</span><small>残り ${left}</small>`;
      b.onclick = () => this.h.setTool('piece:' + t);
      list.appendChild(b);
    }
    if (g.branchesLeft() > 0) list.insertAdjacentHTML('beforeend', `<div class="hint">🔱 分岐：あと${g.branchesLeft()}か所（描くモードでコースの途中から描き始める）</div>`);
  }

  suggested() {
    const g = this.g;
    const el = $('sug-list'); el.innerHTML = '';
    g.def.suggested.forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = `📐 ${s.name}`;
      b.onclick = () => this.confirm('おすすめルートを引きますか？', '今のコースは消えます（建っているドミノは在庫へ）。', () => this.h.suggested(i));
      el.appendChild(b);
    });
  }

  buildList() {
    const g = this.g, P = g.progress;
    const el = $('build-list');
    let html = '';
    for (const [id, on] of Object.entries(P.evolutions)) if (on) { const e = EVOLUTIONS[id]; html += `<div class="bpart evo"><div class="ic">${e.icon}</div><div class="nm">${e.name}</div><div class="lv">進化</div><div class="cat">${e.desc}</div></div>`; }
    const owned = Object.entries(P.parts).filter(([, v]) => v > 0);
    if (!owned.length && !html) html = '<div class="hint">まだパーツがありません。ドミノを倒して経験値を貯め、ガチャを引こう。</div>';
    for (const [id, lv] of owned) {
      const p = PARTS[id];
      html += `<div class="bpart"><div class="ic">${p.icon}</div><div class="nm">${p.name}</div><div class="lv">${p.consumable ? `所持 ${g.rewinds}` : `Lv.${lv}`}</div><div class="cat">${CATEGORY[p.category].label}・${RARITY[p.rarity].label}</div></div>`;
    }
    // 進化の手がかり
    const hints = Object.entries(EVOLUTIONS).filter(([id]) => !P.evolutions[id]).map(([, e]) => `${e.icon} ${e.name}：` + Object.entries(e.requires).map(([k, v]) => `${PARTS[k].name}${P.lv(k) >= v ? '✅' : `Lv${v}`}`).join('＋'));
    html += `<div class="sec">合体設計図（進化）</div><div class="hint">${hints.join('<br>') || 'すべて進化済み！'}</div>`;
    el.innerHTML = html;
  }

  // ---------------- ダイアログ ----------------
  dialog(html, buttons) {
    const card = $('dialog-card');
    card.innerHTML = html + '<div class="btn-row"></div>';
    const row = card.querySelector('.btn-row');
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'big-btn ' + (b.cls || 'start');
      el.innerHTML = b.label;
      el.onclick = () => { $('dialog').classList.add('hidden'); b.fn && b.fn(); };
      row.appendChild(el);
    }
    $('dialog').classList.remove('hidden');
  }
  confirm(title, body, fn) { this.dialog(`<h2>${title}</h2><p>${body}</p>`, [{ label: 'はい', fn }, { label: 'やめる', cls: 'tidy' }]); }

  preflight(pf, go) {
    const warn = [];
    if (!pf.connected) warn.push('コースがゴール装置につながっていません');
    if (pf.unbuilt) warn.push(`未建設のマスが <b>${pf.unbuilt}</b> 個あります（すき間で止まります）`);
    if (pf.fallen) warn.push(`倒れたままのドミノが <b>${pf.fallen}</b> 個あります`);
    if (pf.locked) warn.push(`🔒ロック中のストッパーが <b>${pf.locked}</b> 個あります（本番でも外れません）`);
    if (pf.total < this.g.def.target) warn.push(`コースが目標（${this.g.def.target}個）より短いです：${pf.total}個`);
    if (!warn.length) return go();
    this.dialog(`<h2>本当に倒しますか？</h2><ul>${warn.map((w) => `<li>${w}</li>`).join('')}</ul><p>途中までの練習として倒すこともできます（倒れた枚数ぶん経験値が入ります）。</p>`,
      [{ label: '▶ それでも倒す', fn: go }, { label: '準備に戻る', cls: 'tidy' }]);
  }

  settings() {
    const s = this.h.getSettings();
    this.dialog(`<h2>設定</h2>
      <div class="set-row"><label>画質</label><select id="set-q"><option value="low">低（軽い）</option><option value="mid">中</option><option value="high">高（AO・被写界深度）</option></select></div>
      <div class="set-row"><label>BGM 音量</label><input id="set-bgm" type="range" min="0" max="1" step="0.05" value="${s.music}"></div>
      <div class="set-row"><label>効果音 音量</label><input id="set-sfx" type="range" min="0" max="1" step="0.05" value="${s.sfx}"></div>
      <div class="set-row"><label>自動カメラ</label><input id="set-auto" type="checkbox" ${s.autoCam ? 'checked' : ''}></div>
      <p class="hint">セーブはブラウザに自動保存されます（建設中のコース・ドミノ配置も保存）。</p>
      <div class="btn-row"><button id="set-load" class="big-btn tidy">💾 最後のセーブを読み込む</button><button id="set-reset" class="big-btn rewind">↺ 最初からやり直す</button></div>`,
    [{ label: 'とじる' }]);
    $('set-q').value = s.quality;
    $('set-q').onchange = (e) => this.h.setSetting('quality', e.target.value);
    $('set-bgm').oninput = (e) => this.h.setSetting('music', +e.target.value);
    $('set-sfx').oninput = (e) => this.h.setSetting('sfx', +e.target.value);
    $('set-auto').onchange = (e) => this.h.setSetting('autoCam', e.target.checked);
    $('set-load').onclick = () => { $('dialog').classList.add('hidden'); this.h.load(); };
    $('set-reset').onclick = () => this.confirm('最初からやり直しますか？', 'レベル・パーツ・コース・記録がすべて消えます（Ver.0.1のセーブは消えません）。', () => this.h.reset());
  }

  stageSelect() {
    const g = this.g;
    const btns = [1, 2].map((id) => {
      const st = STAGES[id], rec = g.records[id];
      const locked = id > g.unlockedStage;
      return { label: `${locked ? '🔒 ' : ''}${st.name}<small>${st.title}｜最大 ${rec.best}${rec.cleared ? '｜クリア済' : ''}</small>`, cls: id === g.stageId ? 'start' : 'tidy', fn: locked ? () => this.toast('まだ行けません', 'STAGE 1 をクリアしよう', '') : () => this.h.goStage(id) };
    });
    btns.push({ label: 'とじる', cls: 'rewind' });
    this.dialog('<h2>ステージ</h2><p>獲得したパーツとレベルはステージ間で引き継がれます。各ステージのコースは別々に保存されます。</p>', btns);
  }

  comingSoon(fn) {
    this.dialog(`<div class="dog"><div class="paw">🐾</div><div class="soon">COMING SOON</div><h2>STAGE 3　巨大な犬</h2><p>ドミノの前にしっぽを振る巨大な犬が現れる…！<br>次回、「おすわりベル」で犬をおすわりさせながら、もっと長い連鎖に挑め！</p></div>`, [{ label: 'たのしみ！', fn }]);
  }

  // ---------------- 結果 ----------------
  showResult(r, next) {
    const g = this.g;
    let title;
    if (r.cleared) title = '<div class="res-title clear">🎉 STAGE CLEAR！ 🎉</div>';
    else if (r.goal) title = '<div class="res-title">ゴール装置は動いた！でも目標数に届かず…</div>';
    else title = `<div class="res-title fail">連鎖ストップ</div>`;
    const reason = !r.cleared && r.reason ? `<div class="res-reason">📍 止まった理由：${r.reason}<br><small>赤いマークの場所を確認して、直して再挑戦しよう</small></div>` : '';
    const rows = [
      ['倒れたドミノ', `${fmt(r.count)} 個`],
      ['目標', `${fmt(r.target)} 個`],
      ['自己ベスト', r.newBest ? `🏆 ${fmt(r.count)}（更新！）` : fmt(Math.max(r.prevBest, r.count))],
      ['経験値（倒れた枚数×長さボーナス）', `+${fmt(r.xp.base)}`],
    ];
    if (r.xp.record) rows.push(['新記録ボーナス', `+${fmt(r.xp.record)}`]);
    if (r.xp.orbs) rows.push(['経験値の星（磁石）', `+${fmt(r.xp.orbs)}`]);
    if (r.xp.bell) rows.push(['おうえんボーナス', `+${fmt(r.xp.bell)}`]);
    if (g.piggy) rows.push(['欲張り貯金箱', r.cleared ? `+${fmt(r.piggy)}（全額）` : `+${fmt(r.piggy)}（${fmt(r.piggyLost)} 失った…）`]);
    if (r.presents) rows.push(['🎁 プレゼントドミノ', `ガチャ ×${r.presents}`]);
    if (r.chests) rows.push(['🧰 宝箱', `ガチャ ×${r.chests}`]);
    if (r.gacha) rows.push(['🎰 ドミノ式ガチャマシン', 'ガチャ ×1']);
    if (r.roombaHits) rows.push(['🤖 ルンバに倒された', `${r.roombaHits} 個`]);
    rows.push(['合計経験値', `<b>+${fmt(r.xp.total)}</b>`]);
    const tickets = g.progress.tickets.length;
    const card = $('result-card');
    card.innerHTML = `${title}<div class="res-big">${fmt(r.count)}<small> 連鎖</small></div>${reason}
      <div class="res-grid">${rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('')}</div>
      ${r.levelUps ? `<p style="text-align:center;font-weight:800;color:#1f6fe0">レベルアップ ×${r.levelUps}！</p>` : ''}
      <div class="btn-row"><button id="res-next" class="big-btn start">${tickets ? `🎰 ガチャを開ける（${tickets}回）` : 'OK'}</button></div>`;
    $('result').classList.remove('hidden');
    $('res-next').onclick = () => { $('result').classList.add('hidden'); next(); };
  }

  // ---------------- ガチャ ----------------
  /** 未開封のガチャを順番に開ける */
  openGachas(done) {
    const g = this.g, P = g.progress;
    if (!P.tickets.length) { $('gacha').classList.add('hidden'); done && done(); return; }
    const ticket = P.tickets.shift();
    const picks = P.offer(g.stageId, ticket);
    $('gacha').classList.remove('hidden');
    $('gacha-title').textContent = `${ticket.label}　（残り ${P.tickets.length}）`;
    $('gacha-sub').textContent = '';
    const cap = $('gacha-capsule');
    cap.classList.remove('hide');
    const best = picks.reduce((m, p) => Math.max(m, p.evo ? 3 : ['common', 'rare', 'epic', 'legendary'].indexOf(PARTS[p.id].rarity)), 0);
    cap.style.background = ['linear-gradient(180deg,#ff6b6b 50%,#fff 50%)', 'linear-gradient(180deg,#4dabf7 50%,#fff 50%)', 'linear-gradient(180deg,#b07cff 50%,#fff 50%)', 'linear-gradient(180deg,#ffc531 50%,#fff 50%)'][best];
    const cards = $('gacha-cards');
    cards.innerHTML = '';
    g.audio.gachaSpin();
    setTimeout(() => {
      cap.classList.add('hide');
      g.audio.gachaReveal(['common', 'rare', 'epic', 'legendary'][best]);
      picks.forEach((p, i) => {
        const c = document.createElement('div');
        if (p.evo) {
          const e = EVOLUTIONS[p.evo];
          c.className = 'gcard evo';
          c.innerHTML = `<span class="rar" style="background:#ff4d6d">合体設計図</span><div class="gi">${e.icon}</div><div class="gn">${e.name}</div><div class="gl">進化！</div><div class="gd">${e.desc}</div>`;
        } else {
          const part = PARTS[p.id], lv = P.lv(p.id);
          c.className = `gcard ${part.rarity}`;
          c.innerHTML = `${lv === 0 ? '<span class="new">NEW</span>' : ''}<span class="rar" style="background:${RARITY[part.rarity].color}">${RARITY[part.rarity].label}</span>
            <div class="gi">${part.icon}</div><div class="gn">${part.name}</div><div class="gl">${part.consumable ? `所持 ${g.rewinds} → ${g.rewinds + 2}` : `Lv.${lv} → ${lv + 1}`}</div>
            <div class="gc">${CATEGORY[part.category].icon} ${CATEGORY[part.category].label}${p.guaranteed ? '・おすすめ' : ''}</div><div class="gd">${part.desc(lv)}</div>`;
        }
        c.onclick = () => {
          if (cards.dataset.done) return;
          cards.dataset.done = '1';
          cards.querySelectorAll('.gcard').forEach((x) => x.classList.add(x === c ? 'pick' : 'fade'));
          const res = this.h.takePick(p);
          if (res.kind === 'evo') {
            const fl = document.createElement('div'); fl.className = 'evo-flash'; document.getElementById('app').appendChild(fl);
            setTimeout(() => fl.remove(), 1300);
            $('gacha-sub').textContent = `✨ 進化！ ${EVOLUTIONS[res.id].name} が現場に登場！`;
          } else $('gacha-sub').textContent = `${PARTS[res.id].name} を獲得！`;
          setTimeout(() => { delete cards.dataset.done; this.openGachas(done); }, res.kind === 'evo' ? 1800 : 1000);
        };
        cards.appendChild(c);
        setTimeout(() => c.classList.add('show'), 120 + i * 160);
      });
      $('gacha-sub').textContent = `1つ選ぼう（${picks.length}択）`;
    }, 900);
  }
}
