// WebAudio だけで作る効果音とオリジナルBGM（外部音源ファイルなし）。
// 効果音とBGMは別々の音量で調整できる。

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---- BGM：オリジナルの短い曲（ドレミの数字はMIDIノート） ----
// 建設：のんびりしたおもちゃ箱のワルツ風（3/4ではなく4/4の軽いスウィング）
const SONGS = {
  build: {
    bpm: 104,
    chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62], [60, 64, 67], [57, 60, 64], [62, 65, 69], [55, 59, 62]],
    melody: [
      76, null, 79, 76, 74, null, 72, null, 72, 74, 76, null, 72, null, null, null,
      77, null, 76, 74, 72, null, 69, null, 71, 72, 74, null, 67, null, null, null,
      76, null, 79, 81, 79, null, 76, null, 74, 76, 77, null, 74, null, 72, null,
      69, 71, 72, null, 74, null, 71, null, 72, null, null, null, null, null, null, null,
    ],
    drums: 'k...h.s.k.k.h.s.',
  },
  // 本番：テンポアップして盛り上がる
  run: {
    bpm: 138,
    chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]],
    melody: [
      69, 72, 76, 72, 79, 76, 72, 76, 77, 76, 74, 72, 74, null, 71, null,
      72, 76, 79, 76, 84, 79, 76, 79, 81, 79, 77, 76, 74, 76, 79, null,
      81, null, 79, 77, 76, null, 74, 72, 74, 76, 77, 79, 76, null, 72, null,
      74, 72, 71, 69, 71, 72, 74, 76, 71, null, 68, null, 69, null, null, null,
    ],
    drums: 'k.h.s.hkk.h.s.hs',
  },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.musicVol = 0.5;
    this.sfxVol = 0.8;
    this.muted = false;
    this.song = 'build';
    this.clickBudget = 0;
    this.lastClickT = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(c.destination);
    // 音の飽和を防ぐコンプレッサー
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 6; this.comp.attack.value = 0.003; this.comp.release.value = 0.15;
    this.comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.comp);
    this.music = c.createGain(); this.music.gain.value = this.musicVol * 0.5; this.music.connect(this.master);
    const len = c.sampleRate * 0.06;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const ln = c.sampleRate * 1.0;
    this.longNoise = c.createBuffer(1, ln, c.sampleRate);
    const dd = this.longNoise.getChannelData(0);
    for (let i = 0; i < ln; i++) dd[i] = Math.random() * 2 - 1;
    this.startMusic();
    return true;
  }
  get ok() { return this.ctx && this.ctx.state === 'running'; }
  setMusicVol(v) { this.musicVol = v; if (this.music) this.music.gain.value = v * 0.5; }
  setSfxVol(v) { this.sfxVol = v; if (this.sfx) this.sfx.gain.value = v; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 1; }

  tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = null, dest = null) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noiseHit(freq, q, vol, dur = 0.05, when = 0, rate = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t);
  }

  /**
   * ドミノのカタッ。大量に倒れても1秒あたりの発音数を制限し、超えた分は音量で表現する。
   * pitch: 素材・サイズ（大きいほど低い）
   */
  click(pitch = 1) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    const dt = now - this.lastClickT;
    this.clickBudget = Math.min(1, this.clickBudget + dt * 28); // 最大 約28音/秒
    this.lastClickT = now;
    if (this.clickBudget < 1) { this.pendingLoud = (this.pendingLoud || 0) + 1; return; }
    this.clickBudget -= 1;
    const extra = Math.min(4, this.pendingLoud || 0); this.pendingLoud = 0;
    const v = 0.55 + extra * 0.08;
    this.noiseHit(2400 * pitch + Math.random() * 900, 2.5, v, 0.045, 0, 0.8 + Math.random() * 0.5);
    this.tone((1100 + Math.random() * 300) * pitch, 0.035, 'triangle', 0.05 + extra * 0.01);
    if (Math.random() < 0.3) this.noiseHit(700 * pitch, 1.2, 0.2, 0.06);
  }
  place() { this.tone(520 + Math.random() * 80, 0.07, 'sine', 0.1, 0, 760); this.noiseHit(3000, 3, 0.15, 0.03); }
  pick() { this.tone(700, 0.06, 'triangle', 0.06, 0, 900); }
  drop() { this.tone(330, 0.07, 'triangle', 0.06); }
  buy() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.12, i * 0.06)); }
  deny() { this.tone(200, 0.15, 'sawtooth', 0.05, 0, 140); }
  squeak(p = 1) { this.tone(1200 * p, 0.12, 'sine', 0.07, 0, 1800 * p); }
  oops() { this.tone(500, 0.25, 'sine', 0.1, 0, 220); }
  clunk() { this.noiseHit(900, 1.5, 0.5, 0.08); this.tone(180, 0.08, 'square', 0.06); }
  bonk() { this.tone(160, 0.2, 'sine', 0.25, 0, 90); this.noiseHit(500, 1, 0.4, 0.1); }
  punch() { this.noiseHit(400, 1, 0.8, 0.12); this.tone(120, 0.15, 'sine', 0.3, 0, 60); }
  start() { this.tone(300, 0.25, 'sawtooth', 0.05, 0, 900); }
  siren() { for (let i = 0; i < 3; i++) { this.tone(880, 0.18, 'square', 0.045, i * 0.36, 1320); this.tone(1320, 0.18, 'square', 0.045, i * 0.36 + 0.18, 880); } }
  present() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.13, i * 0.06)); }
  chest() { [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.12, i * 0.07)); }
  bell() { [1318, 1568, 2093].forEach((f, i) => this.tone(f, 1.4, 'sine', 0.12, i * 0.02)); this.tone(659, 1.6, 'sine', 0.1); }
  goal() { this.bell(); [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'square', 0.06, 0.3 + i * 0.12)); }
  magnet(n) { for (let i = 0; i < Math.min(n, 12); i++) this.tone(900 + i * 80, 0.08, 'sine', 0.06, 0.4 + i * 0.05); }
  rewind() { this.tone(1600, 0.6, 'sawtooth', 0.05, 0, 200); for (let i = 0; i < 10; i++) this.tone(2000 - i * 120, 0.03, 'square', 0.04, i * 0.05); }
  toot() { this.tone(587, 0.18, 'square', 0.06); this.tone(740, 0.25, 'square', 0.06, 0.2); }
  roombaStart() { // 低いうなり＋2音のサイレン
    this.tone(70, 0.9, 'sawtooth', 0.09, 0, 55); this.tone(110, 0.9, 'square', 0.03, 0, 90);
    for (let i = 0; i < 3; i++) { this.tone(392, 0.16, 'square', 0.05, 0.25 + i * 0.36, 392); this.tone(311, 0.16, 'square', 0.05, 0.43 + i * 0.36, 311); }
  }
  gachaSpin() { for (let i = 0; i < 8; i++) this.tone(600 + i * 60, 0.05, 'square', 0.04, i * 0.07); }
  gachaReveal(rarity) {
    const tbl = { common: [659, 784], rare: [659, 784, 988], epic: [659, 831, 988, 1319], legendary: [523, 659, 784, 1046, 1319, 1568, 2093] };
    (tbl[rarity] || tbl.common).forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.13, i * 0.08));
    if (rarity === 'legendary' || rarity === 'epic') this.noiseHit(6000, 0.8, 0.3, 0.8, 0.1, 0.5);
  }
  evolve() { [392, 523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.06, i * 0.09)); this.bell(); }
  fail() { [600, 450, 300].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, i * 0.14)); }
  levelUp() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, i * 0.08)); }

  /** ルンバの掃除音（距離で音量） */
  roombaHum(vol) {
    if (!this.ok) return;
    if (!this.hum) {
      const s = this.ctx.createBufferSource(); s.buffer = this.longNoise; s.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 95;
      const og = this.ctx.createGain(); og.gain.value = 0.15;
      const g = this.ctx.createGain(); g.gain.value = 0;
      s.connect(f).connect(g); o.connect(og).connect(g); g.connect(this.sfx);
      s.start(); o.start();
      this.hum = { g };
    }
    this.hum.g.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.2);
  }

  checkpoint() { [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.12, i * 0.06)); this.bell(); }
  capsule() { this.noiseHit(1800, 2, 0.35, 0.06); this.tone(420 + Math.random() * 80, 0.08, 'sine', 0.1, 0, 300); }
  gachaPick(rarity, evo) {
    // 決定音：ポンッ＋きらきら（レア度で豪華に）
    this.tone(330, 0.12, 'square', 0.08, 0, 660); this.noiseHit(3500, 1, 0.4, 0.15);
    const n = { common: 3, rare: 5, epic: 7, legendary: 9 }[rarity] || 3;
    for (let i = 0; i < n; i++) this.tone(1046 * Math.pow(1.122, i), 0.25, 'triangle', 0.08, 0.12 + i * 0.05);
    if (evo) this.evolve();
  }
  /** スタートの一押し：パンチ → カチッ → 最初の数枚 */
  firstPush() { this.punch(); this.tone(90, 0.3, 'sine', 0.25, 0, 50); }
  chainSwell(rate) {
    // 連鎖が加速するにつれて、低いうなり（ざわめき）を重ねる
    if (!this.ok) return;
    if (!this.swell) {
      const s = this.ctx.createBufferSource(); s.buffer = this.longNoise; s.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
      const g = this.ctx.createGain(); g.gain.value = 0;
      s.connect(f).connect(g).connect(this.sfx); s.start();
      this.swell = { g, f };
    }
    this.swell.g.gain.setTargetAtTime(Math.min(0.12, rate * 0.007), this.ctx.currentTime, 0.3);
    this.swell.f.frequency.setTargetAtTime(700 + rate * 40, this.ctx.currentTime, 0.3);
  }

  // ---------------- BGM シーケンサ ----------------
  setSong(name) { if (this.song !== name) { this.song = name; this.step = 0; } }
  startMusic() {
    if (this.musicTimer) return;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.schedule(), 50);
  }
  schedule() {
    if (!this.ok) return;
    const song = SONGS[this.song];
    const stepDur = 60 / song.bpm / 4;
    while (this.nextT < this.ctx.currentTime + 0.25) {
      const s = this.step % 64;
      const t = this.nextT - this.ctx.currentTime;
      const chord = song.chords[Math.floor(s / 8) % song.chords.length];
      const swing = s % 2 ? stepDur * 0.12 : 0;
      // ベース
      if (s % 4 === 0) this.voice(NOTE(chord[0] - 12), stepDur * 3, 'triangle', 0.22, t);
      if (s % 4 === 2 && this.song === 'run') this.voice(NOTE(chord[0] - 12 + 7), stepDur * 1.5, 'triangle', 0.14, t);
      // 和音（オルゴール風アルペジオ）
      if (s % 2 === 0) this.voice(NOTE(chord[(s / 2) % 3] + 12), stepDur * 3, 'sine', 0.07, t + swing);
      // メロディ（オルゴール：三角波＋高い倍音）
      const m = song.melody[s];
      if (m) { this.voice(NOTE(m), stepDur * 2.6, 'triangle', 0.16, t); this.voice(NOTE(m + 12), stepDur * 1.4, 'sine', 0.05, t); }
      // ウッドブロック風の打楽器
      const dch = song.drums[s % 16];
      if (dch === 'k') this.drum(140, 0.35, t);
      if (dch === 's') this.wood(1800, 0.18, t);
      if (dch === 'h') this.wood(5200, 0.06, t);
      this.nextT += stepDur;
      this.step++;
    }
  }
  voice(f, dur, type, vol, when) {
    const t = this.ctx.currentTime + Math.max(0, when);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }
  drum(f, vol, when) {
    const t = this.ctx.currentTime + Math.max(0, when);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.2);
  }
  wood(f, vol, when) {
    const t = this.ctx.currentTime + Math.max(0, when);
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(bp).connect(g).connect(this.music); s.start(t);
  }
}
