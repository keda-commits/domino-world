import { CFG } from './config.js';
import { UPGRADES } from './upgrades.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString('ja-JP');
};

// DOM の HUD・ショップ・ボタン類
export class UI {
  constructor(game, handlers) {
    this.game = game;
    this.h = handlers;
    this.el = {};
    ['s-coins', 's-stock', 's-crate', 's-chain', 's-buffer', 's-build', 's-fall', 's-dist', 's-best', 's-bestcont',
      'banner', 'warning', 'vignette', 'speedlines', 'race', 'race-text', 'race-fill', 'race-front',
      'b-place', 'b-start', 'b-cont', 'b-od', 'od-fill', 'od-sub', 'cont-sub', 'shop-list', 'b-buy10', 'buy10-cost',
      'b-pause', 'b-follow', 'b-sound', 'help', 'toast'].forEach((id) => (this.el[id] = $(id)));

    this.buildShop();
    this.el['buy10-cost'].textContent = `${CFG.buy10Cost}コイン`;
    this.el['b-buy10'].onclick = () => { game.buy10(); this.refresh(true); };
    this.el['b-place'].onpointerdown = (e) => { e.preventDefault(); handlers.placeHold(true); };
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => this.el['b-place'].addEventListener(ev, () => handlers.placeHold(false)));
    this.el['b-start'].onclick = () => handlers.start('normal');
    this.el['b-cont'].onclick = () => handlers.start('cont');
    this.el['b-od'].onclick = () => handlers.overdrive();
    this.el['b-pause'].onclick = () => handlers.togglePause();
    document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => handlers.setSpeed(+b.dataset.speed)));
    this.el['b-follow'].onclick = () => handlers.toggleFollow();
    $('b-overview').onclick = () => handlers.overview();
    this.el['b-sound'].onclick = () => handlers.toggleSound();
    $('b-help').onclick = () => this.showHelp(true);
    $('b-help-close').onclick = () => this.showHelp(false);
    $('b-reset').onclick = () => handlers.reset();
    $('b-shop-toggle').onclick = () => {
      $('shop').classList.toggle('collapsed');
      $('b-shop-toggle').textContent = $('shop').classList.contains('collapsed') ? '+' : '–';
    };
    this.toastTimer = 0;
    this.warnBeep = 0;
  }

  buildShop() {
    const list = this.el['shop-list'];
    list.innerHTML = '';
    this.shopItems = {};
    for (const u of UPGRADES) {
      const d = document.createElement('div');
      d.className = 'up';
      d.innerHTML = `<div class="ic">${u.icon}</div><div class="nm">${u.name} <span class="lv"></span></div><div class="cost"></div><div class="ds"></div>`;
      d.onclick = () => {
        if (this.game.buy(u.id)) {
          d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
          this.refresh(true);
        }
      };
      list.appendChild(d);
      this.shopItems[u.id] = { d, lv: d.querySelector('.lv'), cost: d.querySelector('.cost'), ds: d.querySelector('.ds'), u };
    }
  }

  showHelp(v) { this.el.help.classList.toggle('hidden', !v); if (!v) this.h.helpClosed?.(); }
  get helpOpen() { return !this.el.help.classList.contains('hidden'); }

  toast(t1, t2, t3, time = 2.6) {
    const el = this.el.toast;
    el.innerHTML = `<div class="t1">${t1}</div><div class="t2">${t2}</div>${t3 ? `<div class="t3">${t3}</div>` : ''}`;
    el.classList.add('show');
    this.toastTimer = time;
  }

  setPaused(p) { this.el['b-pause'].textContent = p ? '▶' : '⏸'; this.el['b-pause'].classList.toggle('on', p); }
  setSpeed(s) { document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s)); }
  setFollow(f) { this.el['b-follow'].classList.toggle('on', f); }
  setSound(on) { this.el['b-sound'].textContent = on ? '🔊' : '🔇'; }

  /** 毎フレーム呼ぶ軽い更新（トースト・警告） */
  tick(dt, paused) {
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.el.toast.classList.remove('show'); }
  }

  /** 0.1秒ごとの表示更新 */
  refresh(force = false) {
    const g = this.game, e = this.el, c = g.chain;
    e['s-coins'].textContent = fmt(g.coins);
    e['s-stock'].textContent = fmt(g.stock);
    e['s-crate'].textContent = `${fmt(g.crate.count)}/${g.crate.cap}` + (g.levels.machine > 0 ? ` ・設置機 ${g.machine.hopper}` : '');
    e['s-chain'].textContent = c.active ? fmt(c.count) : (g.lastChain ? `${fmt(g.lastChain.count)}（前回）` : '0');
    const buf = g.buffer();
    e['s-buffer'].textContent = fmt(buf);
    const br = g.buildRate();
    e['s-build'].textContent = `${br.toFixed(1)} 個/秒`;
    const fr = c.active ? c.rate : 0;
    e['s-fall'].textContent = `${fr.toFixed(1)} 個/秒`;
    e['s-dist'].textContent = `${(g.stats.distance * CFG.metersPerDomino).toFixed(1)} m`;
    e['s-best'].textContent = fmt(g.stats.best);
    e['s-bestcont'].textContent = fmt(g.stats.bestCont);

    // ボタン
    e['b-start'].disabled = !g.canStart();
    e['b-cont'].disabled = !g.contUnlocked || !g.canStart();
    const u = CFG.contUnlock;
    e['cont-sub'].textContent = g.contUnlocked ? 'C' : `🔒 建設${u.builder}・運搬${u.carrier}・回収${u.collector}で解放`;
    e['b-place'].disabled = g.stock <= 0;
    const odPct = g.odTime > 0 ? (g.odTime / CFG.overdriveTime) * 100 : (g.energy / CFG.energyMax) * 100;
    e['od-fill'].style.width = odPct + '%';
    e['b-od'].classList.toggle('ready', g.canOverdrive());
    e['b-od'].classList.toggle('active', g.odTime > 0);
    e['b-od'].disabled = !g.canOverdrive();
    e['od-sub'].textContent = g.odTime > 0 ? `発動中！ 残り${g.odTime.toFixed(1)}秒` : g.canOverdrive() ? '満タン！ O で発動' : `ぜんまい ${Math.floor(g.energy)} / ${CFG.energyMax}`;
    e['speedlines'].classList.toggle('show', g.odTime > 0);

    // バナー
    let banner = '';
    if (g.odTime > 0) banner = `⚡ オーバードライブ！ 残り ${g.odTime.toFixed(1)} 秒`;
    else if (c.active && c.mode === 'cont') banner = `♾ 連続運転中　${fmt(c.count)} 連鎖`;
    else if (c.active) banner = `連鎖中！ ${fmt(c.count)}`;
    else if (g.stats.chains === 0 && buf < 5) banner = '画面をクリックして ▼ の場所にドミノを並べよう';
    else if (!c.active && buf > 0) banner = `${fmt(buf)} 個スタンバイ中 — 「▶ 倒す！」で連鎖`;
    e.banner.textContent = banner;

    // 連続運転の危機表示
    const contActive = c.active && c.mode === 'cont';
    const margin = fr > 0 ? buf / fr : Infinity;
    const danger = contActive && margin < 3.5;
    e.warning.classList.toggle('show', danger);
    e.vignette.classList.toggle('show', danger && margin < 2);
    e.warning.textContent = margin < 1.5 ? '⚠ 追いつかれる！ オーバードライブ！' : '⚠ 連鎖が建設隊に迫っている！';
    if (danger) {
      this.warnBeep -= 0.1;
      if (this.warnBeep <= 0) { g.audio.warn(); this.warnBeep = margin < 1.5 ? 0.6 : 1.2; }
    }
    e.race.classList.toggle('hidden', !c.active);
    if (c.active) {
      const pct = Math.min(1, buf / 80);
      e['race-fill'].style.width = `calc(${pct * 100}% - ${pct * 40}px)`;
      e['race-front'].style.left = `calc(${pct * 100}% - ${pct * 40}px + 18px)`;
      e['race-text'].textContent = fr > 0 ? `余裕 ${buf} 個（約 ${margin === Infinity ? '∞' : margin.toFixed(1)} 秒）` : `余裕 ${buf} 個`;
      e['race-text'].style.color = danger ? '#e4483c' : '';
    }
    e['s-buffer'].classList.toggle('low', danger);

    // ショップ
    for (const id in this.shopItems) {
      const it = this.shopItems[id];
      const lv = g.levels[id];
      const max = lv >= it.u.max;
      const cost = g.upgradeCost(id);
      it.lv.textContent = id === 'builder' || id === 'carrier' || id === 'collector' ? `${lv}人` : `Lv.${lv}`;
      it.cost.textContent = max ? 'MAX' : `${fmt(cost)}コイン`;
      it.cost.classList.toggle('no', !max && g.coins < cost);
      it.d.classList.toggle('locked', max || g.coins < cost);
      const ds = it.u.effect(lv);
      if (it.ds.textContent !== ds) it.ds.textContent = ds;
    }
    e['b-buy10'].disabled = g.coins < CFG.buy10Cost;
  }
}
