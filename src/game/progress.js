import { PARTS, EVOLUTIONS, RARITY, GACHA, XP } from '../data/parts.js';

/**
 * 経験値・レベル・3択ガチャ・進化。
 * ガチャ券（tickets）は連鎖が終わってから順番に開封する。
 * ticket: {source, label, rarityMin?, category?, choices?}
 */
export class Progress {
  constructor() {
    this.level = 1;
    this.xp = 0;
    this.parts = {}; // id -> level
    this.evolutions = {}; // id -> true
    this.tickets = [];
    this.lastOffered = new Set();
    this.extraChoice = 0; // 四つ葉ドミノで次のガチャ +2
    this.seen = 0;
  }
  need() { return XP.need(this.level); }
  /** 経験値を加算。上がったレベル数を返す（ガチャ券も積む） */
  addXP(n) {
    this.xp += n;
    let ups = 0;
    while (this.xp >= this.need()) {
      this.xp -= this.need();
      this.level++;
      ups++;
      this.tickets.push({ source: 'level', label: `レベル ${this.level} 到達！` });
    }
    return ups;
  }
  lv(id) { return this.parts[id] || 0; }

  /** 出現候補 */
  eligible(stage, ticket = {}) {
    const out = [];
    for (const [id, p] of Object.entries(PARTS)) {
      if (!p.stages.includes(stage)) continue;
      if ((p.minLevel || 0) > this.level && !ticket.ignoreLevel) continue;
      if (this.lv(id) >= p.max) continue;
      if (p.requires && Object.entries(p.requires).some(([k, v]) => this.lv(k) < v)) continue;
      if (ticket.category && p.category !== ticket.category) continue;
      if (ticket.rarityMin && RARITY[p.rarity].weight > RARITY[ticket.rarityMin].weight) continue;
      out.push(id);
    }
    return out;
  }
  readyEvolutions() {
    return Object.entries(EVOLUTIONS).filter(([id, e]) => !this.evolutions[id] && Object.entries(e.requires).every(([k, v]) => this.lv(k) >= v)).map(([id]) => id);
  }

  /** 選択肢を作る。rand: 0..1 の乱数関数 */
  offer(stage, ticket, rand = Math.random) {
    let n = ticket.choices || GACHA.choices;
    const clover = this.lv('clover');
    if (clover && rand() < 0.25 * (clover + 1)) n = Math.max(n, 4);
    if (this.extraChoice) { n = Math.max(n, 3 + this.extraChoice); this.extraChoice = 0; }
    const picks = [];
    // 確実に出す選択肢（防衛チュートリアルのストッパーズなど）
    for (const id of ticket.force || []) if (PARTS[id] && this.lv(id) < PARTS[id].max) picks.push({ id, guaranteed: true });
    // 合体設計図（進化）は条件を満たしたら優先して出す
    if (!ticket.category) for (const ev of this.readyEvolutions()) if (picks.length < 1) picks.push({ evo: ev });
    // 序盤の保証
    if (!ticket.category) for (const gu of GACHA.guarantees) {
      if (this.level >= gu.level && gu.when(this.parts) && PARTS[gu.id].stages.includes(stage) && !picks.some((p) => p.id === gu.id)) { picks.push({ id: gu.id, guaranteed: true }); break; }
    }
    const pool = this.eligible(stage, ticket).filter((id) => !picks.some((p) => p.id === id));
    const weight = (id) => {
      const p = PARTS[id];
      let w = RARITY[p.rarity].weight;
      if (stage === 2 && p.category === 'defense') w *= GACHA.stage2DefenseBias;
      if (this.lastOffered.has(id)) w *= GACHA.repeatPenalty;
      if (p.consumable) w *= 0.6;
      return w;
    };
    while (picks.length < n && pool.length) {
      const tot = pool.reduce((a, id) => a + weight(id), 0);
      let r = rand() * tot, k = 0;
      for (; k < pool.length - 1; k++) { r -= weight(pool[k]); if (r <= 0) break; }
      picks.push({ id: pool[k] });
      pool.splice(k, 1);
    }
    // 何も出ない（全部最大）ときは巻き戻しアイテム
    while (picks.length < Math.min(n, 3)) picks.push({ id: 'rewind' });
    this.lastOffered = new Set(picks.filter((p) => p.id).map((p) => p.id));
    return picks;
  }

  /** 選択を適用。返り値：{kind:'part'|'evo', id, level} */
  take(pick) {
    if (pick.evo) { this.evolutions[pick.evo] = true; return { kind: 'evo', id: pick.evo }; }
    this.parts[pick.id] = this.lv(pick.id) + 1;
    return { kind: 'part', id: pick.id, level: this.parts[pick.id] };
  }

  serialize() { return { level: this.level, xp: this.xp, parts: this.parts, evolutions: this.evolutions, tickets: this.tickets, extraChoice: this.extraChoice }; }
  load(d) {
    if (!d) return;
    this.level = d.level || 1; this.xp = d.xp || 0; this.parts = d.parts || {}; this.evolutions = d.evolutions || {};
    this.tickets = d.tickets || []; this.extraChoice = d.extraChoice || 0;
  }
}

export function xpForRun(n, best, piggyBonus = 0) {
  const base = XP.forRun(n);
  const record = Math.round(Math.max(0, n - best) * XP.recordBonusPerDomino);
  return { base, record, piggy: piggyBonus, total: base + record + piggyBonus };
}
