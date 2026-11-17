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
  readyEvolutions(stage) {
    return Object.entries(EVOLUTIONS).filter(([id, e]) => !this.evolutions[id] && (!e.stages || e.stages.includes(stage)) && Object.entries(e.requires).every(([k, v]) => this.lv(k) >= v)).map(([id]) => id);
  }

  /** 選択肢を作る。rand: 0..1 の乱数関数 */
  offer(stage, ticket, rand = Math.random) {
    // Ver.0.5：基本2択、10% で3択（四つ葉の加護で確率アップ・四つ葉ドミノで次は確定3択）。最大3択
    const clover = this.lv('clover');
    let n = rand() < GACHA.threeChance + 0.15 * clover ? 3 : GACHA.choices;
    if (this.extraChoice) { n = 3; this.extraChoice = 0; }
    const picks = [];
    // 最初のガチャ：回収担当を必ず候補に（おすすめ）。倒れたドミノを拾ってくれるので並べ直しが楽になる
    const first = !this.firstGachaDone;
    // Ver.0.6：ステージ2のエリート建築士。最初のガチャでLv.1、その後4回以内にLv.2が必ず候補に出る
    if (stage === 2) {
      this.s2offers = (this.s2offers || 0) + 1;
      const a = this.lv('architect');
      if (a < 1 || (a < 2 && this.s2offers - (this.s2archAt || 0) >= 4)) picks.push({ id: 'architect', guaranteed: true, reason: a < 1 ? 'おすすめ！ 線路の上を越える建築の第一歩' : 'おすすめ！ Lv.2 でドミノ階段（立体交差）が建てられる' });
    }
    if (first && PARTS.collector.stages.includes(stage) && this.lv('collector') < PARTS.collector.max) picks.push({ id: 'collector', guaranteed: true, reason: 'おすすめ！ 倒れたドミノを拾ってくれるので、並べ直しが楽になります' });
    // 確実に出す選択肢（防衛チュートリアルのストッパーズなど）
    for (const id of ticket.force || []) if (PARTS[id] && this.lv(id) < PARTS[id].max && !picks.some((p) => p.id === id)) picks.push({ id, guaranteed: true });
    // 合体設計図（進化）は条件を満たしたら優先して出す
    if (!ticket.category) for (const ev of this.readyEvolutions(stage)) if (picks.length < 1) picks.push({ evo: ev });
    // 序盤の保証
    if (!ticket.category && !first) for (const gu of GACHA.guarantees) {
      if (this.level >= gu.level && gu.when(this.parts) && PARTS[gu.id].stages.includes(stage) && !picks.some((p) => p.id === gu.id)) { picks.push({ id: gu.id, guaranteed: true }); break; }
    }
    const pool = this.eligible(stage, ticket).filter((id) => !picks.some((p) => p.id === id));
    const weight = (id) => {
      const p = PARTS[id];
      let w = RARITY[p.rarity].weight;
      if (stage === 2 && p.category === 'defense') w *= GACHA.stage2DefenseBias;
      if (stage === 1 && p.category === 'defense' && this.level >= GACHA.stage1DefenseFrom) w *= GACHA.stage1DefenseBias;
      if (this.lastOffered.has(id)) w *= GACHA.repeatPenalty;
      if (p.consumable) w *= 0.6;
      return w;
    };
    while (picks.length < n && pool.length) {
      // 2択に意味があるよう、すでに並んでいるものと同じ種類は出にくくする
      const cats = new Set(picks.map((p) => p.id && PARTS[p.id] && PARTS[p.id].category));
      const w = (id) => weight(id) * (cats.has(PARTS[id].category) ? 0.25 : 1);
      const tot = pool.reduce((a, id) => a + w(id), 0);
      let r = rand() * tot, k = 0;
      for (; k < pool.length - 1; k++) { r -= w(pool[k]); if (r <= 0) break; }
      picks.push({ id: pool[k] });
      pool.splice(k, 1);
    }
    // 候補が足りない（ほとんど最大）ときは経験値パック（ぜんまい巻き戻しは廃止）
    while (picks.length < Math.min(n, 2)) picks.push({ id: 'xpPack' });
    if (picks.length > 3) picks.length = 3;
    this.lastOffered = new Set(picks.filter((p) => p.id).map((p) => p.id));
    return picks;
  }

  /** 選択を適用。返り値：{kind:'part'|'evo', id, level} */
  take(pick) {
    this.firstGachaDone = true;
    if (pick.id === 'xpPack') { this.addXP(30); return { kind: 'part', id: 'xpPack', level: 0 }; }
    if (pick.evo) { this.evolutions[pick.evo] = true; return { kind: 'evo', id: pick.evo }; }
    this.parts[pick.id] = this.lv(pick.id) + 1;
    if (pick.id === 'architect') this.s2archAt = this.s2offers || 0;
    return { kind: 'part', id: pick.id, level: this.parts[pick.id] };
  }

  serialize() { return { level: this.level, xp: this.xp, parts: this.parts, evolutions: this.evolutions, tickets: this.tickets, extraChoice: this.extraChoice, firstGachaDone: !!this.firstGachaDone, s2offers: this.s2offers || 0, s2archAt: this.s2archAt || 0 }; }
  load(d) {
    if (!d) return;
    this.level = d.level || 1; this.xp = d.xp || 0; this.parts = d.parts || {}; this.evolutions = d.evolutions || {};
    this.tickets = d.tickets || []; this.extraChoice = d.extraChoice || 0;
    // 既存セーブ：パーツを1つでも持っていれば最初のガチャは済んでいる
    this.firstGachaDone = d.firstGachaDone ?? Object.values(d.parts || {}).some((v) => v > 0);
    this.s2offers = d.s2offers || 0; this.s2archAt = d.s2archAt || 0;
  }
}

export function xpForRun(n, best, piggyBonus = 0) {
  const base = XP.forRun(n);
  const record = Math.round(Math.max(0, n - best) * XP.recordBonusPerDomino);
  return { base, record, piggy: piggyBonus, total: base + record + piggyBonus };
}
