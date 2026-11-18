import * as THREE from 'three';

/**
 * 小人の村での暮らし（Ver.0.6）
 * 手が空いた小人が村に戻ると、ここで「相手のいる行動」を割り当てる。全員どうしを毎フレーム調べることはせず、
 * 少数の出来事（イベント）だけを持って進める：
 *   ・キャッチボール：2人で投げて、受けたら投げ返す。取りそこねたら拾いに走る。片方が仕事に呼ばれたら、もう片方がボールを片付ける
 *   ・ハンモック：昼寝をしている人は自分では起きにくい。仕事ができると、仲間（いなければ設計主任）が起こしに来る
 *   ・お誘い：設計主任が村に来て「仕事だ！」と呼ぶと、遊んでいた人が振り向いて返事をし、走って仕事に戻る
 *   ・おかえり：ベンチで休んでいる人が、戻ってきた仲間を迎える
 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export class CampLife {
  constructor(game) {
    this.game = game;
    this.villages = new Map(); // kind → { kind, center, spots, ball:{ mesh, flight, holder }, hammock: w|null, seats: [w|null, w|null], loiter:Set }
    this.timers = []; // [t, fn]（短い遅れのせりふ・反応）
    this.stats = { ball: 0, throws: 0, drops: 0, wakes: 0, invites: 0, greets: 0 };
  }
  addVillage(kind, center, spots) {
    const v = { kind, center: center.clone(), spots, ball: { mesh: spots.ball, flight: null, game: null }, hammock: null, seats: [null, null], loiter: new Set(), wakeT: 0 };
    this.villages.set(kind, v);
    return v;
  }
  w2(v, p) { return V(v.center.x + p.x, p.y || 0, v.center.z + p.z); }
  after(sec, fn) { this.timers.push([this.game.time + sec, fn]); }
  villageOf(w) {
    const home = this.game.campPos(w.role);
    if (!home) return null;
    for (const v of this.villages.values()) if (Math.abs(v.center.x - home.x) < 0.1 && Math.abs(v.center.z - home.z) < 0.1) return v;
    return null;
  }

  /** 仕事があるか（遊びをやめて戻る理由になるか）。重い探索はしない */
  hasWork(w) {
    const g = this.game;
    if (g.mode !== 'build') return false;
    if (w.role === 'builder') {
      if (g.unbuiltCount() === 0 || (g.stock <= 0 && g.crate.count <= 0)) return false;
      let k = 0;
      for (const s of g.unbuiltList()) { if (!s.domino && !s.claim && !g.crossBlocked(s) && !g.slotBlocker(s)) return true; if (++k > 40) break; }
      return false;
    }
    if (w.role === 'carrier') return g.stock > 0 && g.crate.count < g.crate.cap * 0.5 && g.unbuiltCount() > 0;
    if (w.role === 'collector') return [...g.dominoes.list].some((d) => d.toppled && d.slot && !d.claim);
    return false;
  }
  /** 遊んでいる人は、仕事ができてもすぐには気づかない（仲間や設計主任に呼ばれて戻る）。20秒たてば自分で気づく */
  workWait(w) {
    if (!this.hasWork(w)) { w._workT = 0; return false; }
    if (!w._workT) w._workT = this.game.time;
    return this.game.time - w._workT > 20;
  }
  /** 遊んで（休んで）いる人か */
  isFun(w) { return !!(w.life && ['ball', 'loiter', 'seat', 'hammock'].includes(w.life.kind)); }

  // ================= 村に戻ってきた人に、すること割り当て =================
  /** 手が空いて村にいる人：相手がいれば一緒に遊ぶ。true なら割り当てた */
  offer(w, time) {
    const g = this.game, v = this.villageOf(w);
    // 村で遊ぶ・休むのは、建設・運搬・回収の人だけ（建築士・撤去班・防災班などは呼ばれたらすぐ動けるように、ここでは遊ばない）
    if (!v || g.mode !== 'build' || !['builder', 'carrier', 'collector'].includes(w.role)) return false;
    if (Math.hypot(w.pos.x - v.center.x, w.pos.z - v.center.z) > 6) return false;
    // ベンチの人が迎える
    const sitter = v.seats.find((o) => o && o !== w && o.life && o.life.kind === 'seat');
    if (sitter && !w._greeted && Math.random() < 0.7) {
      w._greeted = g.time;
      sitter.face2(w.pos); sitter.act(1.0, 'wave', () => this.resume(sitter));
      sitter.say(['おかえり〜', 'おつかれさま！', 'おかえり！ どうだった？'][Math.floor(Math.random() * 3)]);
      this.after(0.7, () => { if (w.state !== 'trip') w.say(['ただいま！', 'つかれた〜', 'ただいま〜'][Math.floor(Math.random() * 3)]); });
      this.stats.greets++;
    }
    if (w._greeted && g.time - w._greeted > 30) w._greeted = 0;
    // 1) キャッチボール：村でぶらぶらしている人を誘う
    if (!v.ball.game && !v.ball.flight) {
      const mate = [...v.loiter].find((o) => o !== w && o.life && o.life.kind === 'loiter' && o.state === 'act');
      if (mate && Math.random() < 0.85) return this.startBall(v, w, mate);
    }
    // 2) ハンモックで昼寝（なまけ者ほど）
    if (!v.hammock && Math.random() < 0.25 + w.trait.lazy * 0.5) return this.startNap(v, w);
    // 3) ベンチでひと休み
    const si = v.seats.findIndex((o) => !o);
    if (si >= 0 && Math.random() < 0.5) return this.startSeat(v, w, si);
    // 4) ボールのそばでぶらぶら（次に来た人と遊ぶ）
    return this.startLoiter(v, w, time);
  }
  /** 遊びの途中で別のことが入った（転んだ・つかまれた・考え直した） */
  leave(w) {
    const L = w.life; if (!L) return;
    w.life = null; w.liftY = 0;
    const v = L.v;
    if (!v) return;
    // ハンモック・ベンチから降りる（家具の上＝通れないマスに立ったままにしない）
    if (L.kind === 'hammock' && v.hammock === w) { const sd = this.w2(v, v.spots.hammockSide); w.pos.x = sd.x; w.pos.z = sd.z; }
    if (L.kind === 'seat') { const i = v.seats.indexOf(w); if (i >= 0) { const st = this.w2(v, v.spots.seats[i]); w.pos.x = st.x + (i === 0 ? -0.6 : 0.6); w.pos.z = st.z; } }
    if (w.pf) w.pf.reset();
    v.loiter.delete(w);
    if (v.hammock === w) v.hammock = null;
    v.seats = v.seats.map((o) => (o === w ? null : o));
    const bg = v.ball.game;
    if (bg && (bg.a === w || bg.b === w)) this.endBall(v, w, 'left');
  }
  /** 遊び・休憩を続けるか、仕事へ戻るか */
  resume(w) {
    const L = w.life;
    if (!L) return w.think();
    if (this.workWait(w) || this.game.mode !== 'build') { this.leave(w); w.say(Math.random() < 0.5 ? 'あっ、仕事があったんだ！' : 'さて、仕事仕事！'); return w.think(); }
    if (L.kind === 'seat') return w.act(2 + Math.random() * 2, Math.random() < 0.4 ? 'talk' : 'sit', () => this.resume(w));
    if (L.kind === 'loiter') { if (this.game.time > L.until) { this.leave(w); return w.think(); } return w.act(1.2, 'idle', () => this.resume(w)); }
    this.leave(w); w.think();
  }

  // ---------- ぶらぶら・ベンチ ----------
  startLoiter(v, w, time) {
    w.life = { kind: 'loiter', v, until: this.game.time + Math.max(6, time * 2) };
    v.loiter.add(w);
    const p = this.w2(v, V(-0.4 + Math.random() * 1.2, 0, -0.6 + Math.random() * 0.8));
    w.goto(() => p, () => { w.face2(this.w2(v, v.spots.ballHome)); w.act(1.0, 'idle', () => this.resume(w)); });
    return true;
  }
  startSeat(v, w, i) {
    v.seats[i] = w;
    w.life = { kind: 'seat', v };
    const s = this.w2(v, v.spots.seats[i]);
    const stand = s.clone(); stand.x += i === 0 ? -0.45 : 0.45;
    w.goto(() => stand, () => {
      if (w.life?.kind !== 'seat') return w.think();
      w.pos.x = s.x; w.pos.z = s.z; w.liftY = 0.35; w.face2(this.w2(v, V(-2.4, 0, 1.7)));
      // 隣に人がいれば、おしゃべり
      const other = v.seats.find((o) => o && o !== w);
      if (other && Math.random() < 0.8) { w.say(['ねえねえ、聞いて', 'さっきの連鎖、すごかったね', '今日はよく並べたなあ'][Math.floor(Math.random() * 3)]); this.after(1.2, () => { if (other.life?.kind === 'seat') { other.say(['うんうん', 'ほんとだね！', 'へえ〜！'][Math.floor(Math.random() * 3)]); other.face2(w.pos); other.act(1.5, 'talk', () => this.resume(other)); } }); }
      w.act(2.5, other ? 'talk' : 'sit', () => this.resume(w));
    });
    return true;
  }

  // ---------- キャッチボール ----------
  startBall(v, a, b) {
    v.loiter.delete(b);
    const bg = (v.ball.game = { a, b, holder: a, throws: 0, ready: new Set(), max: 6 + Math.floor(Math.random() * 8) });
    a.life = { kind: 'ball', v }; b.life = { kind: 'ball', v };
    this.stats.ball++;
    a.say(Math.random() < 0.5 ? 'キャッチボールしよう！' : 'ボール投げるよ〜'); this.after(0.8, () => b.life?.kind === 'ball' && b.say('いいよ！'));
    // a はボールを拾ってから A 地点へ、b は B 地点へ
    const home = this.w2(v, v.spots.ballHome), pa = this.w2(v, v.spots.playA), pb = this.w2(v, v.spots.playB);
    a.goto(() => home, () => {
      if (a.life?.kind !== 'ball') return a.think();
      a.act(0.35, 'pick', () => { if (a.life?.kind !== 'ball') return a.think(); bg.carry = a; a.goto(() => pa, () => this.ballReady(v, a)); });
    });
    b.goto(() => pb, () => this.ballReady(v, b));
    return true;
  }
  ballReady(v, w) {
    const bg = v.ball.game; if (!bg || w.life?.kind !== 'ball') return w.think();
    if (bg.started && bg.holder !== w) return w.act(20, 'ready', () => this.endBall(v, w, 'left'));
    bg.ready.add(w);
    const other = w === bg.a ? bg.b : bg.a;
    w.face2(other.pos);
    // 相手が来るまで待つ。そろったら、ボールを持っている人が投げる（持っていない人は構えて待つ）
    if (bg.ready.size < 2) return w.act(0.4, 'idle', () => this.ballReady(v, w));
    if (bg.holder === w) { bg.started = true; this.throwBall(v, w); }
    else w.act(20, 'ready', () => this.endBall(v, w, 'left'));
  }
  throwBall(v, w) {
    const bg = v.ball.game; if (!bg) return;
    const to = w === bg.a ? bg.b : bg.a;
    // 投げる前に：仕事ができた／もう十分遊んだ → 終わり
    const ww = this.workWait(w) || this.workWait(to);
    if (bg.throws >= bg.max || ww) return this.endBall(v, w, ww ? 'work' : 'done');
    w.face2(to.pos);
    w.act(0.4, 'throw', () => {
      if (v.ball.game !== bg) return;
      bg.carry = null; bg.holder = null; bg.throws++; this.stats.throws++;
      // 受け手の上手さ（体育会系ほど落とさない）
      const drop = Math.random() > 0.72 + to.trait.sporty * 0.25;
      const from = w.pos.clone().setY(w.pos.y + 0.75), aim = to.pos.clone().setY(to.pos.y + 0.7);
      if (drop) aim.add(V((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6));
      v.ball.flight = { from, to: aim, t: 0, dur: 0.85, catcher: to, drop };
      to.face2(w.pos); to.act(20, 'ready', () => this.endBall(v, to, 'left'));
      w.act(20, 'idle', () => this.endBall(v, w, 'left'));
    });
  }
  /** ボールが届いた */
  landBall(v) {
    const f = v.ball.flight, bg = v.ball.game; v.ball.flight = null;
    const c = f.catcher;
    if (!bg || c.life?.kind !== 'ball') { this.dropBallAt(v, f.to); return; }
    if (!f.drop) {
      bg.holder = c; bg.carry = c;
      c.act(0.5, 'catch', () => { if (v.ball.game !== bg) return; if (Math.random() < 0.25) c.say(['ナイスボール！', 'とった！', 'いくよ〜'][Math.floor(Math.random() * 3)]); this.throwBall(v, c); });
      return;
    }
    // 取りそこねた：ボールが転がる。受け手が拾いに走って、元の位置から投げる
    this.stats.drops++;
    const p = f.to.clone().setY(0.17); this.dropBallAt(v, p);
    c.say(Math.random() < 0.5 ? 'おっとっと！' : 'あっ、ごめん！');
    const back = c.pos.clone();
    c.goto(() => p, () => {
      if (v.ball.game !== bg) return c.think();
      c.act(0.35, 'pick', () => { bg.holder = c; bg.carry = c; c.goto(() => back, () => this.throwBall(v, c)); });
    }, 1.3);
    const t = c === bg.a ? bg.b : bg.a; if (Math.random() < 0.5) this.after(0.5, () => t.life?.kind === 'ball' && t.say('ドンマイ！'));
  }
  dropBallAt(v, p) { v.ball.mesh.position.set(p.x - v.center.x, 0.17, p.z - v.center.z); }
  /** 遊び終わり：ボールを片付けて仕事へ（片方が抜けたら、残った人が片付ける） */
  endBall(v, by, why) {
    const bg = v.ball.game; if (!bg || (by && bg.a !== by && bg.b !== by)) { if (by && by.life?.kind === 'ball') { by.life = null; } return; }
    v.ball.game = null; v.ball.flight = null;
    const rest = [bg.a, bg.b].filter((o) => o.life?.kind === 'ball' && o !== (why === 'left' ? by : null));
    for (const o of [bg.a, bg.b]) if (o.life?.kind === 'ball') o.life = null;
    const holder = bg.carry && rest.includes(bg.carry) ? bg.carry : rest[0];
    if (bg.carry) { const p = bg.carry.pos; this.dropBallAt(v, p); }
    if (why === 'left' && holder) holder.say('あれ？ 行っちゃった…', 'warn');
    else if (why === 'work' && holder) holder.say('仕事だ、行こう！');
    else if (holder) holder.say('楽しかった〜！');
    const home = this.w2(v, v.spots.ballHome);
    for (const o of rest) {
      if (o === holder) {
        o.goto(() => home, () => { this.dropBallAt(v, v.spots.ballHome.clone().add(v.center)); o.act(0.35, 'pick', () => o.think()); });
      } else o.act(0.4, 'cheer', () => o.think());
    }
  }

  // ---------- ハンモック ----------
  startNap(v, w) {
    v.hammock = w;
    w.life = { kind: 'hammock', v, since: this.game.time, workT: 0 };
    const side = this.w2(v, v.spots.hammockSide);
    w.goto(() => side, () => {
      if (w.life?.kind !== 'hammock') return w.think();
      const h = this.w2(v, v.spots.hammock);
      w.pos.x = h.x; w.pos.z = h.z; w.liftY = 1.02; w.yaw = 0; // 布の上に寝る（背中がまん中の一番低い所）
      w.say(Math.random() < 0.5 ? 'Zzz…' : 'ふぁ〜、ひと眠り…');
      w.act(90, 'nap', () => this.selfWake(v, w));
    });
    return true;
  }
  /** 誰も起こしに来なかった（長く寝た） */
  selfWake(v, w) { if (v.hammock === w) { w.say('ふぁ〜…よく寝た'); this.leave(w); } w.think(); }
  /** 起こす：起こす人がハンモックのそばへ行って揺する → 寝ていた人が飛び起きる */
  wake(v, waker, line = 'おーい、起きて！ 仕事だよ') {
    const sleeper = v.hammock; if (!sleeper || sleeper.life?.kind !== 'hammock' || sleeper.life.waker) return false;
    sleeper.life.waker = waker;
    if (this.isFun(waker)) this.leave(waker);
    waker.releaseJob();
    const side = this.w2(v, v.spots.hammockSide);
    waker.goto(() => side, () => {
      if (v.hammock !== sleeper) return waker.think();
      waker.face2(sleeper.pos); waker.say(line);
      waker.act(1.3, 'shake', () => {
        this.stats.wakes++;
        if (v.hammock === sleeper && sleeper.life?.kind === 'hammock') {
          sleeper.say(Math.random() < 0.5 ? 'はっ！ いま行く！' : 'うわっ、寝てた！');
          this.leave(sleeper);
          sleeper.pos.x = side.x + 0.5; sleeper.pos.z = side.z + 0.4;
          sleeper.act(0.8, 'surprised', () => { sleeper.runMult = 1.4; sleeper.think(); });
        }
        waker.act(0.5, 'point', () => waker.think());
      });
    }, 1.2);
    return true;
  }

  // ================= 設計主任のお誘い =================
  /** 遊んでいる人のうち、仕事がある人がいる村（設計主任が呼びに行く） */
  inviteTarget() {
    for (const v of this.villages.values()) {
      const fun = this.game.workers.list.filter((w) => w.life?.v === v && this.isFun(w) && this.hasWork(w));
      if (fun.length) return { v, fun };
    }
    return null;
  }
  /** 設計主任が村に着いて呼ぶ。遊んでいた人が振り向いて返事し、走って仕事へ */
  invite(chief, v) {
    const fun = this.game.workers.list.filter((w) => w.life?.v === v && this.isFun(w));
    if (!fun.length) return false;
    this.stats.invites++;
    chief.say(['みんな、仕事だ！ 次はあっちだ！', '休憩おわり！ 建設を再開するぞ！', '手が空いてる人、前線へ頼む！'][Math.floor(Math.random() * 3)]);
    const replies = ['はーい！', 'りょうかい！', 'いま行きます！', 'よーし！'];
    fun.forEach((w, i) => {
      if (w.life.kind === 'hammock') return; // 寝ている人は揺すって起こす
      this.after(0.5 + i * 0.35, () => {
        if (!this.isFun(w)) return;
        this.leave(w);
        w.face2(chief.pos);
        if (i < 3) w.say(replies[i % replies.length]);
        w.act(0.5, 'salute', () => { w.runMult = 1.4; w.think(); });
      });
    });
    if (v.hammock) { this.after(1.2, () => this.wake(v, chief, 'こら〜、起きろ！ 仕事だぞ')); }
    return true;
  }

  // ================= 毎フレーム：ボールの飛行と、昼寝の人を起こす段取りだけ =================
  update(dt) {
    const g = this.game;
    if (this.timers.length) { const now = g.time; const due = this.timers.filter((t) => t[0] <= now); this.timers = this.timers.filter((t) => t[0] > now); for (const [, fn] of due) fn(); }
    for (const v of this.villages.values()) {
      const f = v.ball.flight, bg = v.ball.game;
      if (f) {
        f.t += dt;
        const k = Math.min(1, f.t / f.dur);
        const p = f.from.clone().lerp(f.to, k); p.y += Math.sin(k * Math.PI) * 1.4;
        v.ball.mesh.position.set(p.x - v.center.x, p.y, p.z - v.center.z);
        if (k >= 1) this.landBall(v);
      } else if (bg && bg.carry) {
        const c = bg.carry; v.ball.mesh.position.set(c.pos.x - v.center.x + Math.sin(c.yaw) * 0.25, c.pos.y + 0.62, c.pos.z - v.center.z + Math.cos(c.yaw) * 0.25);
      }
      // 昼寝中の人に仕事ができた：2秒たったら、村の仲間か設計主任が起こしに行く（10秒だれも来なければ自分で起きる）
      const s = v.hammock;
      if (s && s.life?.kind === 'hammock' && !s.life.waker) {
        if (s.state !== 'act' || s.pose !== 'nap') { if (s.state !== 'walk') this.leave(s); continue; }
        if (this.hasWork(s)) {
          s.life.workT += dt;
          if (s.life.workT > 2 && (v.wakeT -= dt) <= 0) {
            v.wakeT = 1.5;
            const mate = g.workers.list.find((o) => o !== s && o.life?.v === v && (o.life.kind === 'loiter' || o.life.kind === 'seat' || o.life.kind === 'ball'))
              || g.workers.list.find((o) => o !== s && o.role === s.role && o.state === 'walk' && !o.haul && Math.hypot(o.pos.x - v.center.x, o.pos.z - v.center.z) < 10);
            if (mate) this.wake(v, mate);
            else if (s.life.workT > 20) { s.say('ふぁ…あ、仕事か！'); this.leave(s); s.act(0.6, 'surprised', () => s.think()); }
          }
        } else s.life.workT = 0;
      }
    }
  }
}
