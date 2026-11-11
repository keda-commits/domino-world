// WebAudio で合成するおもちゃっぽい効果音。外部音源ファイルは使わない。
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastClick = 0;
    this.master = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    // クリック音用のノイズ
    const len = this.ctx.sampleRate * 0.05;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    return true;
  }
  get ok() { return this.ctx && !this.muted && this.ctx.state === 'running'; }

  tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = null) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // カチッ（ドミノが当たる音）。連鎖が速いときは間引く
  click(pitch = 1) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClick < 0.03) return;
    this.lastClick = now;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200 * pitch + Math.random() * 600;
    f.Q.value = 3;
    const g = this.ctx.createGain();
    g.gain.value = 0.9;
    s.connect(f).connect(g).connect(this.master);
    s.start(now);
    this.tone(900 * pitch + Math.random() * 100, 0.04, 'triangle', 0.08);
  }
  place() { this.tone(520 + Math.random() * 80, 0.08, 'sine', 0.12, 0, 760); }
  pick() { this.tone(700, 0.06, 'triangle', 0.06, 0, 900); }
  drop() { this.tone(330, 0.07, 'triangle', 0.06); }
  coin() { this.tone(1320, 0.08, 'square', 0.04); this.tone(1760, 0.12, 'square', 0.04, 0.06); }
  buy() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.12, i * 0.06)); }
  deny() { this.tone(200, 0.15, 'sawtooth', 0.06, 0, 140); }
  squeak(p = 1) { this.tone(1200 * p, 0.12, 'sine', 0.08, 0, 1800 * p); }
  oops() { this.tone(500, 0.25, 'sine', 0.1, 0, 220); }
  warn() { this.tone(880, 0.12, 'square', 0.05); this.tone(660, 0.12, 'square', 0.05, 0.14); }
  milestone() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.13, i * 0.07)); }
  end() { [600, 450, 300].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.1, i * 0.12)); }
  start() { this.tone(300, 0.25, 'sawtooth', 0.06, 0, 900); }
  overdrive() {
    if (!this.ok) return;
    // ぜんまいを巻く音 → ギュイーン
    for (let i = 0; i < 8; i++) this.tone(1500 + i * 60, 0.03, 'square', 0.05, i * 0.04);
    this.tone(180, 1.0, 'sawtooth', 0.12, 0.3, 1400);
    this.tone(240, 1.0, 'square', 0.05, 0.3, 1900);
  }
  close() { this.tone(1000, 0.1, 'triangle', 0.1, 0, 1600); this.tone(1500, 0.16, 'triangle', 0.1, 0.08); }
}
