// 開発時のみ読み込まれる自動プレイ（バランス検証用ボット）。本番ビルドには含まれない。
export function installDevtools(game) {
  let lastEnd = null;
  game.on('chainEnd', (r) => { lastEnd = r; });
  const PRIO = ['builder', 'collector', 'builder', 'carrier', 'builder', 'carrier', 'collector', 'speed', 'basket', 'builder',
    'carrier', 'machine', 'collector', 'carrier', 'factory', 'speed', 'machine', 'carrier', 'basket', 'builder', 'collector',
    'carrier', 'machine', 'speed', 'carrier', 'factory', 'machine', 'basket', 'carrier', 'collector', 'machine', 'speed',
    'builder', 'builder', 'carrier', 'carrier', 'collector', 'machine', 'speed', 'basket', 'factory'];

  /**
   * seconds 秒ぶんゲームを高速に進めながら、素朴なプレイヤーとして振る舞う。
   * opts.noOD: オーバードライブを使わない / opts.noBuy: 何も買わない / opts.maxRuns: 連続運転の回数で打ち切り
   */
  window.__bot = (seconds, opts = {}) => {
    const g = game, log = [], dt = 0.05, t0 = g.simTime;
    const prio = opts.prio || PRIO;
    let runs = 0;
    const note = (s) => log.push(`${(g.simTime - t0).toFixed(0)}s ${s}`);
    while (g.simTime - t0 < seconds) {
      if (g.levels.builder === 0 && g.stock > 0) g.manualPlace();
      if (g.levels.collector === 0 && !g.chain.active) g.manualCollect(g.route.point(g.head - 3));
      g.update(dt);
      if (!opts.noBuy) {
        let pi = 0;
        const seen = {};
        for (; pi < prio.length; pi++) { const id = prio[pi]; seen[id] = (seen[id] || 0) + 1; if (g.levels[id] < seen[id]) break; }
        if (pi < prio.length && g.canBuy(prio[pi])) { g.buy(prio[pi]); note(`buy ${prio[pi]} -> ${g.levels[prio[pi]]}`); }
        const owned = g.totalDominoes();
        const W = g.levels.builder + g.levels.carrier + g.levels.collector;
        const want = 40 + 15 * W + 60 * g.levels.machine;
        if (owned < want && g.coins >= 10 + (pi < prio.length ? g.upgradeCost(prio[pi]) * 0.5 : 0)) g.buy10();
      }
      const owned = g.totalDominoes();
      if (!g.chain.active) {
        if (g.contUnlocked && !opts.noCont) { if (g.buffer() >= Math.min(opts.contBuf || 40, owned * 0.6)) { g.startChain('cont'); note(`START cont buf ${g.buffer()}`); } }
        else if (g.buffer() >= Math.min(40, owned * 0.7) || (g.levels.builder === 0 && g.stock === 0 && g.buffer() > 0)) g.startChain('normal');
      } else if (g.chain.mode === 'cont') {
        const m = g.buffer() / g.chain.rate;
        if (m < 1.8 && g.canOverdrive() && !opts.noOD) { g.activateOverdrive(); note(`OD at chain ${g.chain.count} buf ${g.buffer()} rate ${g.chain.rate.toFixed(1)}`); }
      }
      if (lastEnd) {
        const r = lastEnd; lastEnd = null;
        note(`END ${r.mode} ${r.count} +${Math.round(r.coins)} (coins ${Math.round(g.coins)}, owned ${owned}, stock ${g.stock}, crate ${g.crate.count}, fallen ${g.field.counts.fallen}, br ${g.buildRate().toFixed(1)}, rate ${g.chain.rate.toFixed(1)})`);
        if (r.mode === 'cont' && ++runs >= (opts.maxRuns || Infinity)) break;
      }
    }
    return { log, coins: Math.round(g.coins), levels: { ...g.levels }, audit: g.audit(), stock: g.stock, crate: g.crate.count, fallen: g.field.counts.fallen, buf: g.buffer(), stats: { ...g.stats } };
  };
  // 同じ初期条件から計測する実験。setup: {builder, carrier, collector, machine, speed, basket}
  const fresh = (setup, stock = 300) => {
    game.reset();
    game.coins = 1e9;
    for (const [id, n] of Object.entries(setup)) for (let i = 0; i < n; i++) game.buy(id);
    game.coins = 0;
    game.stock = stock;
    game.stats.owned = stock;
  };
  const step = (sec) => { const t0 = game.simTime; while (game.simTime - t0 < sec) game.update(0.05); };
  /** 建設速度の計測：warm 秒あたためてから sec 秒の設置数 */
  window.__measureBuild = (setup, sec = 40) => {
    fresh(setup);
    step(10);
    const p0 = game.stats.placed;
    step(sec);
    return +((game.stats.placed - p0) / sec).toFixed(2);
  };
  /** 連続運転を1回、追いつかれるまで。useOD: 危機でオーバードライブを使うか */
  window.__contRun = (setup, useOD, prebuild = 40) => {
    fresh(setup);
    while (game.buffer() < prebuild) game.update(0.05);
    game.energy = 100; // 両条件とも満タンで開始（使うかどうかだけ変える）
    game.startChain('cont');
    let od = null;
    while (game.chain.active && game.simTime < 2000) {
      game.update(0.05);
      const m = game.buffer() / game.chain.rate;
      if (useOD && m < 1.8 && game.canOverdrive()) { od = { at: game.chain.count, buf: game.buffer() }; game.activateOverdrive(); }
    }
    return { count: game.lastChain.count, od, audit: game.audit().ok };
  };
  window.__hardReset =() => { window.confirm = () => true; document.getElementById('b-reset').click(); };
}
