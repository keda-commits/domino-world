import { PARTS, EVOLUTIONS } from './data/parts.js';

/**
 * テスト用デバッグメニュー（一般プレイヤーには非表示）。
 * 表示：` キー、Ctrl+Shift+D、または URL に ?debug=1
 * window.__dbg からも同じ機能を呼べる（自動テスト用）。
 */
export function installDebug(ctx) {
  const { game, ui, view, perf } = ctx;
  const el = document.createElement('div');
  el.id = 'debug';
  el.className = 'panel hidden';
  document.getElementById('app').appendChild(el);

  const api = {
    goStage: (id) => { game.unlockedStage = Math.max(game.unlockedStage, id); ctx.goStage(id); },
    gacha: (n = 1, opts = {}) => { for (let i = 0; i < n; i++) game.progress.tickets.push({ source: 'debug', label: 'デバッグガチャ', ...opts }); ui.openGachas(() => game.syncPartsToWorld()); },
    xp: (n) => { const u = game.progress.addXP(n); return u; },
    setPart: (id, lv) => { game.progress.parts[id] = Math.max(0, lv); game.syncPartsToWorld(true); },
    evolve: (id) => { game.progress.evolutions[id] = true; game.syncPartsToWorld(); },
    /** 未建設マスに一括でドミノを立てる（在庫から。足りなければ追加） */
    buildAll: () => {
      let n = 0;
      for (const s of game.unbuiltList()) { if (s.domino) continue; if (game.stock <= 0) { game.stock++; game.stats.produced++; } game.stock--; game.placeAt(s, null); n++; }
      return n;
    },
    restoreAll: () => { let n = 0; while (game.manualRestoreStep()) n++; return n; },
    route: (i) => game.loadSuggested(i),
    run: () => game.startRun(),
    roomba: (mode) => {
      const r = game.roomba; if (!r) return 'no roomba';
      if (mode === 'go') { r.timer = 0; r.enabled = true; }
      if (mode === 'off') { r.enabled = false; }
      if (mode === 'on') { r.enabled = true; }
      if (mode === 'aggressive') { r.aggressive = !r.aggressive; }
      if (mode === 'dock') r.recall();
      if (mode === 'next') { r.patternIdx++; r.buildPreview(); }
      return r.state;
    },
    accident: () => {
      const cands = game.course.allSlots.filter((s) => s.domino && !s.domino.toppled && s.seg && s.seg.slots);
      const s = cands[Math.floor(Math.random() * cands.length)];
      if (!s) return null;
      game.dominoes.push(s.domino, Math.sin(s.yaw), Math.cos(s.yaw), 0.07);
      return s.order;
    },
    emergency: () => { const s = game.course.allSlots.find((x) => x.domino && !x.domino.toppled && x.seg && x.seg.slots && x.i > 5); if (!s) return; game.onAccidentTopple(s.domino); },
    stats: () => ({ fps: +perf.fps.toFixed(1), update: +(perf.update || 0).toFixed(2), render: +(perf.render || 0).toFixed(2), physStep: +game.physics.stepMs.toFixed(3), ...game.dominoes.stats(), ...view.info() }),
    /** 高速に時間を進める（描画なし） */
    advance: (sec, step = 1 / 30) => { const t0 = game.time; while (game.time - t0 < sec) game.update(step); return game.time - t0; },
    /** 連鎖が終わるまで高速に進める */
    runToEnd: (maxSec = 400) => { let t = 0; while (game.run && t < maxSec) { game.update(1 / 30); t += 1 / 30; } return game.lastResult; },
    stock: (n) => { game.stock += n; game.stats.produced += n; },
    save: () => ctx.save(true),
    wipe: () => ctx.reset(),
  };
  window.__dbg = api;

  const partOpts = Object.entries(PARTS).map(([id, p]) => `<option value="${id}">${p.icon} ${p.name}</option>`).join('');
  const evoOpts = Object.entries(EVOLUTIONS).map(([id, e]) => `<option value="${id}">${e.icon} ${e.name}</option>`).join('');
  el.innerHTML = `<h4>🛠 デバッグメニュー</h4>
    <div><button data-a="s1">STAGE1へ</button><button data-a="s2">STAGE2へ</button><button data-a="gacha">ガチャ即時</button><button data-a="gacha3">ガチャ×3</button></div>
    <div><button data-a="xp100">XP+100</button><button data-a="xp1000">XP+1000</button><button data-a="stock">在庫+200</button><button data-a="rewind">巻き戻し+2</button></div>
    <div><select id="dbg-part">${partOpts}</select><button data-a="pminus">−</button><button data-a="pplus">＋</button></div>
    <div><select id="dbg-evo">${evoOpts}</select><button data-a="evo">進化させる</button></div>
    <div><button data-a="route0">おすすめ1</button><button data-a="route1">おすすめ2</button><button data-a="build">一括設置</button><button data-a="restore">全部起こす</button></div>
    <div><button data-a="rgo">ルンバ出動</button><button data-a="roff">ルンバ停止</button><button data-a="ron">ルンバ再開</button><button data-a="ragg">ルンバ暴走</button><button data-a="rdock">帰還</button><button data-a="rnext">次パターン</button></div>
    <div><button data-a="acc">うっかり事故</button><button data-a="emg">緊急出動</button><button data-a="run">本番開始</button></div>
    <div class="perf" id="dbg-perf"></div>`;
  const sel = () => el.querySelector('#dbg-part').value;
  el.addEventListener('click', (e) => {
    const a = e.target.dataset.a; if (!a) return;
    const map = {
      s1: () => api.goStage(1), s2: () => api.goStage(2), gacha: () => api.gacha(1), gacha3: () => api.gacha(3),
      xp100: () => api.xp(100), xp1000: () => api.xp(1000), stock: () => api.stock(200), rewind: () => { game.rewinds += 2; },
      pminus: () => api.setPart(sel(), (game.progress.parts[sel()] || 0) - 1), pplus: () => api.setPart(sel(), (game.progress.parts[sel()] || 0) + 1),
      evo: () => api.evolve(el.querySelector('#dbg-evo').value), route0: () => api.route(0), route1: () => api.route(1), build: () => api.buildAll(), restore: () => api.restoreAll(),
      rgo: () => api.roomba('go'), roff: () => api.roomba('off'), ron: () => api.roomba('on'), ragg: () => api.roomba('aggressive'), rdock: () => api.roomba('dock'), rnext: () => api.roomba('next'),
      acc: () => api.accident(), emg: () => api.emergency(), run: () => api.run(),
    };
    map[a] && map[a]();
  });
  setInterval(() => {
    if (el.classList.contains('hidden')) return;
    const s = api.stats();
    el.querySelector('#dbg-perf').textContent = `FPS ${s.fps}  update ${s.update}ms  render ${s.render}ms\n物理1step ${s.physStep}ms\nドミノ ${s.total}（起きている ${s.awake} / 固定 ${s.frozen} / 倒れ ${s.toppled}）\n描画 ${s.calls} calls ${Math.round(s.tris / 1000)}k tris`;
  }, 500);
  if (new URLSearchParams(location.search).get('debug')) el.classList.remove('hidden');
  return { toggle: () => el.classList.toggle('hidden') };
}
