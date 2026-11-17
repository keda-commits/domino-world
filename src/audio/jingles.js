/**
 * 連鎖のあとに鳴る短い音楽（Ver.0.5）
 * - success：途中まででも倒し切ったときの「やった！」（明るく短い。次も倒したくなる）
 * - grand  ：最終ゴール到達の大成功（ファンファーレ。通常成功より明確に格上）
 * - crowd  ：建設中の事故のあとの観客の「おぉ〜……あぁ〜……」（短く、コミカルに）
 * どれも AudioContext とつなぎ先を受け取って音を組み立てる（OfflineAudioContext で書き出して比較できる）。
 */

const N = (name) => {
  // 'C4' → 周波数
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * Math.pow(2, (base + (+m[3] - 4) * 12 - 9) / 12);
};

/** 1音：発音（アタック）→ 余韻（リリース）。type ごとに音色を変える */
function note(ctx, dest, t, f, dur, o = {}) {
  const { type = 'triangle', vol = 0.12, attack = 0.008, release = 0.25, detune = 0, cutoff = 0, vibrato = 0 } = o;
  const osc = ctx.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(f, t); osc.detune.value = detune;
  if (vibrato) { const l = ctx.createOscillator(); l.frequency.value = 5.5; const lg = ctx.createGain(); lg.gain.value = f * vibrato; l.connect(lg).connect(osc.frequency); l.start(t + 0.08); l.stop(t + dur + release + 0.1); }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(vol * 0.55, t + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  let node = osc;
  if (cutoff) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.7; node.connect(lp); node = lp; }
  node.connect(g).connect(dest);
  osc.start(t); osc.stop(t + dur + release + 0.05);
}
/** 和音（同時に複数の音） */
const chord = (ctx, dest, t, names, dur, o) => names.forEach((n, i) => note(ctx, dest, t + i * (o.strum || 0), N(n), dur, o));
/** 金管っぽい音（のこぎり波を少し丸め、2本を少しずらして厚みを出す） */
const brass = (ctx, dest, t, n, dur, vol = 0.07) => { note(ctx, dest, t, N(n), dur, { type: 'sawtooth', vol, attack: 0.03, release: 0.2, cutoff: 2400, vibrato: 0.004 }); note(ctx, dest, t, N(n), dur, { type: 'sawtooth', vol: vol * 0.7, attack: 0.03, release: 0.2, cutoff: 1800, detune: 9 }); };
/** 鉄琴（キラッとした高音） */
const glock = (ctx, dest, t, n, vol = 0.07) => { note(ctx, dest, t, N(n), 0.05, { type: 'sine', vol, attack: 0.002, release: 0.6 }); note(ctx, dest, t, N(n) * 4.01, 0.02, { type: 'sine', vol: vol * 0.25, attack: 0.002, release: 0.25 }); };
/** 打楽器（ノイズ） */
function noise(ctx, dest, t, dur, freq, vol, type = 'bandpass') {
  const len = Math.ceil(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const s = ctx.createBufferSource(); s.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(dest); s.start(t);
}
const kick = (ctx, dest, t, vol = 0.35) => { const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18); const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(g).connect(dest); o.start(t); o.stop(t + 0.3); };

// ======================= 通常成功（2案） =======================
export const SUCCESS = {
  /** 案A「ピロリロ・ジャン！」：C メジャーの駆け上がり → 主和音を響かせ、最後に鉄琴のキラッ（約1.4秒・テンポ160） */
  A(ctx, dest, t) {
    const s = 60 / 160 / 2; // 8分音符
    ['E5', 'G5', 'C6', 'E6'].forEach((n, i) => note(ctx, dest, t + i * s * 0.5, N(n), s * 0.45, { type: 'square', vol: 0.045, release: 0.08, cutoff: 3200 }));
    const hit = t + s * 2;
    chord(ctx, dest, hit, ['C5', 'E5', 'G5', 'C6'], 0.55, { type: 'triangle', vol: 0.07, release: 0.5, strum: 0.012 });
    note(ctx, dest, hit, N('C3'), 0.4, { type: 'triangle', vol: 0.16, release: 0.3 });
    kick(ctx, dest, hit, 0.25);
    noise(ctx, dest, hit, 0.25, 7000, 0.12, 'highpass');
    glock(ctx, dest, hit + 0.35, 'G6', 0.05); glock(ctx, dest, hit + 0.45, 'C7', 0.05);
    return 1.4;
  },
  /** 案B「ポロロン」：G ペンタトニックの上昇アルペジオ → ベル風の主和音（約1.6秒・柔らかい） */
  B(ctx, dest, t) {
    const s = 0.075;
    ['G4', 'A4', 'B4', 'D5', 'E5', 'G5'].forEach((n, i) => note(ctx, dest, t + i * s, N(n), 0.12, { type: 'sine', vol: 0.09, release: 0.3 }));
    const hit = t + 6 * s;
    chord(ctx, dest, hit, ['G4', 'B4', 'D5', 'G5'], 0.7, { type: 'sine', vol: 0.07, release: 0.7 });
    note(ctx, dest, hit, N('G2'), 0.6, { type: 'triangle', vol: 0.12, release: 0.4 });
    glock(ctx, dest, hit + 0.2, 'D6', 0.04);
    return 1.6;
  },
};

// ======================= ステージクリア（2案） =======================
export const GRAND = {
  /**
   * 案A「ファンファーレ」：ソソソ・ドー（3連の呼び込み）→ ミレド・ファー（IV）→ ソの掛留（Gsus4→G）→ 高いドの主和音
   * 金管＋ティンパニ＋シンバル＋鉄琴。テンポ120・約3.6秒。通常成功より長く、和声が進行する
   */
  A(ctx, dest, t) {
    const q = 60 / 120; // 4分音符
    const tri = q / 3;
    ['G4', 'G4', 'G4'].forEach((n, i) => brass(ctx, dest, t + i * tri, n, tri * 0.8, 0.06));
    let x = t + q;
    // I：ドー
    brass(ctx, dest, x, 'C5', q * 1.4, 0.075); chord(ctx, dest, x, ['E4', 'G4', 'C4'], q * 1.4, { type: 'sawtooth', vol: 0.022, cutoff: 1600, release: 0.2 });
    note(ctx, dest, x, N('C3'), q, { type: 'triangle', vol: 0.18 }); kick(ctx, dest, x, 0.3); noise(ctx, dest, x, 0.6, 6000, 0.12, 'highpass');
    x += q * 1.5;
    // ミレド → IV：ファー
    ['E5', 'D5', 'C5'].forEach((n, i) => brass(ctx, dest, x + i * tri, n, tri * 0.85, 0.06));
    x += q;
    brass(ctx, dest, x, 'F5', q, 0.075); chord(ctx, dest, x, ['A4', 'C5', 'F4'], q, { type: 'sawtooth', vol: 0.022, cutoff: 1600, release: 0.2 });
    note(ctx, dest, x, N('F2'), q, { type: 'triangle', vol: 0.18 }); kick(ctx, dest, x, 0.22);
    x += q;
    // V の掛留（sus4 → 3度）で期待をためる
    brass(ctx, dest, x, 'G5', q * 1.0, 0.07); chord(ctx, dest, x, ['C5', 'D5', 'G4'], q * 0.5, { type: 'sawtooth', vol: 0.022, cutoff: 1600, release: 0.08 });
    chord(ctx, dest, x + q * 0.5, ['B4', 'D5', 'G4'], q * 0.5, { type: 'sawtooth', vol: 0.022, cutoff: 1600, release: 0.1 });
    note(ctx, dest, x, N('G2'), q, { type: 'triangle', vol: 0.18 });
    for (let i = 0; i < 8; i++) noise(ctx, dest, x + i * q / 8, 0.08, 180, 0.22, 'lowpass'); // ティンパニのロール
    x += q;
    // 解決：高いドの主和音を長く
    brass(ctx, dest, x, 'C6', q * 2.2, 0.08); chord(ctx, dest, x, ['E5', 'G5', 'C5'], q * 2.2, { type: 'sawtooth', vol: 0.026, cutoff: 2000, release: 0.5 });
    chord(ctx, dest, x, ['C4', 'G4', 'E5'], q * 2.2, { type: 'triangle', vol: 0.05, release: 0.6 });
    note(ctx, dest, x, N('C2'), q * 2, { type: 'triangle', vol: 0.2, release: 0.5 }); kick(ctx, dest, x, 0.4);
    noise(ctx, dest, x, 1.4, 5000, 0.18, 'highpass');
    ['C6', 'E6', 'G6', 'C7'].forEach((n, i) => glock(ctx, dest, x + 0.15 + i * 0.09, n, 0.05));
    return x - t + q * 2.4;
  },
  /** 案B「行進曲」：I–vi–IV–V–I の和音進行に上昇する旋律（約4.2秒・明るいが少し長い） */
  B(ctx, dest, t) {
    const q = 60 / 132;
    const prog = [['C4', 'E4', 'G4', 'C3', 'E5'], ['A3', 'C4', 'E4', 'A2', 'A5'], ['F3', 'A3', 'C4', 'F2', 'F5'], ['G3', 'B3', 'D4', 'G2', 'G5'], ['C4', 'E4', 'G4', 'C2', 'C6']];
    prog.forEach((c, i) => {
      const x = t + i * q * 1.5;
      const len = i === 4 ? q * 2.5 : q * 1.4;
      chord(ctx, dest, x, c.slice(0, 3), len, { type: 'sawtooth', vol: 0.024, cutoff: 1700, release: 0.3 });
      note(ctx, dest, x, N(c[3]), len, { type: 'triangle', vol: 0.16 });
      brass(ctx, dest, x, c[4], len, 0.07);
      kick(ctx, dest, x, i === 4 ? 0.4 : 0.22);
    });
    noise(ctx, dest, t + 6 * q, 1.4, 5000, 0.16, 'highpass');
    return 6 * q + q * 2.6;
  },
};

// ======================= 事故の観客（おぉ〜……あぁ〜……） =======================
/**
 * 何人分かの「声」：のこぎり波（声帯）を、母音の共鳴（フォルマント）に相当する2つのバンドパスに通す。
 * 「おぉ〜」（F1≈450, F2≈800）で少し上がり、「あぁ〜」（F1≈750, F2≈1150）で下がっていく。
 * size：倒れた枚数。大きな事故ほど人数が増え、最後に低い「ブー」が混ざる
 */
export function crowd(ctx, dest, t, size = 10) {
  const voices = Math.min(14, 5 + Math.floor(size / 6));
  const oohT = 0.55, awwT = 0.95;
  const out = ctx.createGain(); out.gain.value = 2.0; out.connect(dest); // 書き出して比べると他の曲より10dBほど小さかったので上げる
  for (let i = 0; i < voices; i++) {
    const start = t + Math.random() * 0.12;
    const base = 150 + Math.random() * 130; // 男声〜女声のばらつき
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 0.92, start);
    o.frequency.linearRampToValueAtTime(base * 1.12, start + oohT); // おぉ〜（上がる）
    o.frequency.linearRampToValueAtTime(base * 1.05, start + oohT + 0.12);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, start + oohT + awwT); // あぁ〜（下がる）
    const vib = ctx.createOscillator(); vib.frequency.value = 4.5 + Math.random() * 2; const vg = ctx.createGain(); vg.gain.value = base * 0.025; vib.connect(vg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7;
    f1.frequency.setValueAtTime(450, start); f1.frequency.linearRampToValueAtTime(480, start + oohT); f1.frequency.linearRampToValueAtTime(760, start + oohT + 0.2);
    f2.frequency.setValueAtTime(800, start); f2.frequency.linearRampToValueAtTime(850, start + oohT); f2.frequency.linearRampToValueAtTime(1150, start + oohT + 0.2);
    const g = ctx.createGain(); const v = 0.22 / Math.sqrt(voices);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(v * 0.8, start + 0.12);
    g.gain.linearRampToValueAtTime(v, start + oohT);
    g.gain.linearRampToValueAtTime(v * 0.9, start + oohT + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, start + oohT + awwT);
    const g2 = ctx.createGain(); g2.gain.value = 0.7;
    o.connect(f1).connect(g); o.connect(f2).connect(g2).connect(g); g.connect(out);
    o.start(start); vib.start(start); o.stop(start + oohT + awwT + 0.05); vib.stop(start + oohT + awwT + 0.05);
  }
  // 息づかい（ざわっ）
  noise(ctx, out, t, 0.5, 1200, 0.03);
  if (size >= 40) {
    // 大事故：最後に短いブーイング
    for (let i = 0; i < 4; i++) { const st = t + oohT + awwT * 0.55 + i * 0.03; note(ctx, out, st, 110 + i * 9, 0.35, { type: 'sawtooth', vol: 0.03, attack: 0.06, release: 0.15, cutoff: 500 }); }
  }
  return oohT + awwT + 0.15;
}
