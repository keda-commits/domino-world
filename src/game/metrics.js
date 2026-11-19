/**
 * 進行の計測（Ver.0.6 安定化）：どこで時間を失っているかを調べるための軽い記録。
 * 画面には出さない（デバッグの __dbg.metrics() で読む）。毎フレームの処理は小人の数だけの足し算に限る。
 */
export class Metrics {
  constructor(game) {
    this.game = game;
    this.reset();
  }
  reset() {
    this.t0 = this.game.time || 0;
    this.samples = []; // [時刻, 立っている建設済み, 倒れたまま, いま立ち往生の人数, いま一番長い立ち往生(秒)]
    this.sampleT = 0;
    this.dist = {}; // 役目ごとの歩いた距離
    this.idle = {}; // 役目ごとの「仕事がなくて待っている」時間
    this.play = {}; // 役目ごとの遊び・休憩の時間
    this.pathFail = {}; // 経路が見つからない理由
    this.counts = { supplyFail: 0, slotByGnome: 0, buildNoJob: 0, topples: 0, restands: 0, accidents: 0 };
    this.arrive = []; // 復旧の仕事を受けてから現場に着くまで（秒）
    this.repair = []; // 倒れてから起こされるまで（秒）
    this.backToWork = []; // 仕事ができてから遊びをやめるまで（秒）
    this.maxStuckEver = 0;
  }
  add(obj, key, v) { obj[key] = (obj[key] || 0) + v; }
  count(name, n = 1) { this.counts[name] = (this.counts[name] || 0) + n; }
  push(arr, v) { if (arr.length < 4000) arr.push(+v.toFixed(2)); }
  tick(dt) {
    const g = this.game;
    for (const w of g.workers.list) {
      if (w.life) this.add(this.play, w.role, dt);
      else if (w.state === 'act' && !w.job && !w.haul && (w.pose === 'idle' || w.pose === 'shrug')) this.add(this.idle, w.role, dt);
      if ((w.stuckT || 0) > 0) { w._stallFor = (w._stallFor || 0) + dt; } else if (w.walking) w._stallFor = 0;
      if (w._stallFor > this.maxStuckEver) this.maxStuckEver = w._stallFor;
      // 長い立ち往生（60秒）を詳しく記録（最初の12件）
      if (w._stallFor > 60 && !w._stallLogged && (this.longStuck ||= []).length < 12) {
        w._stallLogged = true;
        const tg = w.targetFn ? w.targetFn() : null, N = g.nav;
        const reg = (p) => { if (!N || !p) return null; const k = N.nearestFree(p, 0, 2); return k < 0 ? -1 : N.region[k]; };
        this.longStuck.push({ t: Math.round(g.time), role: w.role, state: w.state, pose: w.pose, pos: [+w.pos.x.toFixed(1), +w.pos.z.toFixed(1)], tg: tg && [+tg.x.toFixed(1), +tg.z.toFixed(1)], job: w.job ? (w.job.order ?? (w.job.slot ? 'd' + w.job.slot.order : w.job.kind || '?')) : null, regHere: reg(w.pos), regTg: reg(tg), pf: w.pf && { fail: w.pf.fail, last: w.pf.lastFail, pts: w.pf.pts && w.pf.pts.length }, forcing: !!w.forcing, haul: !!w.haul, life: w.life && w.life.kind, contact: +g.bodyContact(w.pos.x, w.pos.z, w.pos.y).toFixed(2) });
      }
      if (w._stallFor < 1) w._stallLogged = false;
    }
    if ((this.sampleT -= dt) > 0) return;
    this.sampleT = 10;
    let built = 0, fallen = 0;
    for (const s of g.course.allSlots) { const d = s.domino; if (!d) continue; if (!d.toppled && g.dominoes.isStandingAt(d, s)) built++; else fallen++; }
    let stuck = 0, longest = 0;
    for (const w of g.workers.list) { if ((w._stallFor || 0) > 2) { stuck++; longest = Math.max(longest, w._stallFor); } }
    this.samples.push([Math.round(g.time - this.t0), built, fallen, stuck, +longest.toFixed(1)]);
    if (this.samples.length > 3000) this.samples.shift();
  }
  avg(a) { return a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null; }
  max(a) { return a.length ? Math.max(...a) : null; }
  snapshot() {
    const r = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    return {
      cause: this.cause || {}, samples: this.samples, dist: r(this.dist), idle: r(this.idle), play: r(this.play), pathFail: this.pathFail, counts: this.counts,
      arrive: { n: this.arrive.length, avg: this.avg(this.arrive), max: this.max(this.arrive) },
      repair: { n: this.repair.length, avg: this.avg(this.repair), max: this.max(this.repair) },
      backToWork: { n: this.backToWork.length, avg: this.avg(this.backToWork), max: this.max(this.backToWork) },
      maxStuckEver: +this.maxStuckEver.toFixed(1), longStuck: this.longStuck || [], longArrive: this.longArrive || [],
      recovery: { n: (this.recoveryTimes || []).length, avg: this.avg(this.recoveryTimes || []), max: this.max(this.recoveryTimes || []) },
    };
  }
}
