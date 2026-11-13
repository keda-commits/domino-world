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
    gacha: (n = 1, opts = {}) => { for (let i = 0; i < n; i++) game.progress.tickets.push({ source: 'debug', label: 'デバッグガチャ', ...opts }); ctx.startGacha(); },
    xp: (n) => { const u = game.progress.addXP(n); return u; },
    setPart: (id, lv) => { game.progress.parts[id] = Math.max(0, lv); game.syncPartsToWorld(true); },
    evolve: (id) => { game.progress.evolutions[id] = true; game.syncPartsToWorld(); },
    /** 未建設マスに一括でドミノを立てる（在庫から。足りなければ追加） */
    buildAll: () => {
      let n = 0;
      for (const s of game.unbuiltList()) { if (s.domino) continue; if (game.stock <= 0) { game.stock++; game.stats.produced++; } game.stock--; game.placeAt(s, null); n++; }
      return n;
    },
    /** コース上のドミノを全部取り除いて新品で立て直す（テストを毎回同じ条件にする） */
    fresh: () => {
      for (const s of game.course.allSlots) if (s.domino) { game.dominoes.remove(s.domino); s.domino = null; game.stock++; }
      for (const d of [...game.dominoes.list]) if (!d.slot) { game.dominoes.remove(d); game.stock++; }
      game.unbuiltDirty = true;
      for (const p of game.pieces) p.reset && p.reset();
      game.goal.reset();
      return api.buildAll();
    },
    restoreAll: () => { let n = 0; while (game.manualRestoreStep()) n++; return n; },
    route: (i) => game.loadSuggested(i),
    run: () => game.startRun(),
    roomba: (mode) => {
      const r = game.roomba; if (!r) return 'no roomba';
      if (mode === 'go') { r.timer = 0; r.enabled = true; }
      if (mode === 'off') { r.enabled = false; r.state = 'dock'; r.timer = 30; r.pos.set(r.def.dock.x, 0, r.def.dock.z + r.r + 0.5); r.sync(); }
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
    /** 比較撮影用：カメラを決まった位置に固定する */
    setCam: (px, py, pz, tx, ty, tz) => { const r = ctx.rig; r.mode = 'free'; r.goal = null; r.userTouched = 1e9; r.camera.position.set(px, py, pz); r.controls.target.set(tx, ty, tz); r.controls.update(); },
    /** 性能計測：frames 回「更新＋描画」して1フレームの平均時間を測る */
    bench: (frames = 60, q = null) => {
      if (q) ctx.view.setQuality(q);
      const t0 = performance.now(); let up = 0, rd = 0, maxF = 0;
      for (let i = 0; i < frames; i++) {
        const a = performance.now(); game.update(1 / 60); const b = performance.now(); ctx.view.render(); ctx.view.renderer.getContext().finish(); const c = performance.now();
        up += b - a; rd += c - b; maxF = Math.max(maxF, c - a);
      }
      const total = performance.now() - t0;
      return { frameMs: +(total / frames).toFixed(2), estFps: +(1000 / (total / frames)).toFixed(1), updateMs: +(up / frames).toFixed(2), renderMs: +(rd / frames).toFixed(2), worstMs: +maxF.toFixed(1), ...api.stats() };
    },
    look: (x, z, dist = 18, polar = 0.9) => { ctx.rig.lookAt(ctx.rig.controls.target.clone().set(x, 0, z), dist, polar); ctx.rig.mode = 'free'; },
    cam: (m) => ctx.rig.setMode(m),
    clearFloaters: () => { game.fx.items.forEach((it) => it.el.remove()); game.fx.items.length = 0; },
    /**
     * 人間のように遊ぶボット（バランス検証用）。描画なしで sec 秒ぶん進める。
     * 序盤は手で置き、短い連鎖で経験値を稼ぎ、ガチャは優先順で選び、コースが完成したら本番。
     */
    botPlay: (sec, opts = {}) => {
      const g = game, log = [], dt = 1 / 20, t0 = g.time;
      const prio = opts.prio || ['builder', 'collector', 'restorer', 'stopperCrew', 'carrier', 'machine', 'boots', 'basket', 'factory', 'train', 'bell', 'barricade', 'watchtower', 'guard', 'gate', 'sensor', 'level', 'magnet', 'clover', 'branch'];
      let placeAcc = 0, lastRunAt = -99, runs = 0;
      const note = (s) => log.push(`${Math.round(g.time - t0)}s Lv${g.progress.level} ${s}`);
      const pickGacha = () => {
        while (g.progress.tickets.length) {
          const tk = g.progress.tickets.shift();
          const picks = g.progress.offer(g.stageId, tk);
          let best = picks.find((p) => p.evo) || null;
          if (!best) for (const id of prio) { best = picks.find((p) => p.id === id); if (best) break; }
          best = best || picks[0];
          const r = g.progress.take(best);
          if (best.id === 'rewind') g.rewinds += 2;
          note(`ガチャ(${tk.source}) → ${best.evo ? '進化:' + best.evo : best.id}${r.level ? ' Lv' + r.level : ''}`);
        }
        g.syncPartsToWorld(true);
      };
      if (!g.course.allSlots.length) g.loadSuggested(opts.route || 0);
      // プレイヤーと同じ placePiece で防衛パーツを置く（ルンバの巡回路がドミノ列に入る手前にバリケード、序盤にベル）
      const placeDefense = () => {
        if (!g.roomba) return;
        const sorted = g.course.allSlots.filter((s) => s.order >= 0).sort((a, b) => a.order - b.order);
        for (const want of [120, 380, 700]) {
          if (g.placeableUsed('bell') >= g.placeableCount('bell')) break;
          const s = sorted[want]; if (!s || g.placed.some((p) => p.type === 'bell' && Math.abs(p.x - s.x) + Math.abs(p.z - s.z) < 6)) continue;
          for (const side of [1, -1, 1.6, -1.6]) { const x = s.x + Math.cos(s.yaw) * side, z = s.z - Math.sin(s.yaw) * side; if (g.placePiece('bell', x, z, s.yaw, true)) { note(`ベル設置 #${want}`); break; } }
        }
        for (const pat of g.roomba.def.patterns) {
          const pts = pat.pts;
          for (let i = 0; i < pts.length - 1; i++) {
            if (g.placeableUsed('barricade') >= g.placeableCount('barricade')) return;
            const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const len = Math.hypot(bx - ax, bz - az); const ux = (bx - ax) / len, uz = (bz - az) / len;
            for (let t = 0; t < len; t += 1) {
              const x = ax + ux * t, z = az + uz * t;
              if (!g.nearestSlot(x, z, 4.5)) continue;
              const bx2 = x - ux * 2.5, bz2 = z - uz * 2.5, yaw = Math.atan2(ux, uz);
              if (!g.placed.some((p) => p.type === 'barricade' && Math.hypot(p.x - bx2, p.z - bz2) < 5) && g.placePiece('barricade', bx2, bz2, yaw, true)) note(`バリケード設置 (${Math.round(bx2)},${Math.round(bz2)})`);
              break;
            }
          }
        }
      };
      let defT = 0;
      while (g.time - t0 < sec) {
        g.update(dt);
        if (g.mode !== 'build') continue;
        if ((defT -= dt) <= 0) { defT = 5; placeDefense(); }
        // 手で置く（建設小人が少ないうち）・手で片付け（回収がいないうち）
        if (g.level('builder') < 2) { placeAcc += dt * 2.5; while (placeAcc >= 1) { placeAcc -= 1; g.manualPlace(); } }
        if (g.level('collector') + g.level('restorer') === 0) { for (let i = 0; i < 2; i++) g.manualRestoreStep(); }
        // 本番の判断
        let prefix = 0;
        const sorted = g.course.allSlots.filter((s) => s.order >= 0).sort((a, b) => a.order - b.order);
        for (const s of sorted) { if (s.domino && g.dominoes.isStandingAt(s.domino, s)) prefix++; else break; }
        const pf = g.preflight();
        const full = pf.unbuilt === 0 && pf.fallen === 0 && pf.connected;
        const best = g.records[g.stageId].best;
        const goalRun = full || (g.roomba && pf.unbuilt === 0 && pf.fallen <= 8 && prefix >= best);
        const practice = prefix >= Math.max(20, Math.floor(best * 1.25)) && g.time - lastRunAt > 25;
        const roombaOk = !g.roomba || (g.roomba.state === 'dock' && g.roomba.timer > 8) || g.placed.some((p) => p.type === 'bell') || opts.ignoreRoomba;
        if ((goalRun || practice) && roombaOk) {
          if (!g.startRun()) continue;
          runs++;
          let tt = 0; while (g.run && tt < 400) { g.update(dt); tt += dt; }
          const r = g.lastResult;
          note(`本番#${runs} ${r.count}個 ${r.cleared ? '★クリア' : r.reason || ''} XP+${r.xp.total}`);
          lastRunAt = g.time;
          pickGacha();
          g.afterRunMaintenance();
          if (r.cleared) break;
        }
      }
      return { log, time: Math.round(g.time - t0), level: g.progress.level, parts: { ...g.progress.parts }, evo: { ...g.progress.evolutions }, best: g.records[g.stageId].best, cleared: g.records[g.stageId].cleared, runs };
    },
    wipe: () => ctx.reset(),
  };
  window.__dbg = api; Object.defineProperty(api, "ctx", { value: ctx, enumerable: false });

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
