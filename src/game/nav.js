import * as THREE from 'three';
import { CFG } from '../config.js';

/**
 * 経路探索（Ver.0.5）：軽量なグリッド A*
 *
 * Recast（ナビメッシュ）や Rapier の Character Controller も調べたが、このゲームは
 * 「平らな床＋家具（静的）＋ドミノの列（毎秒のように増減）」で、障害物の形がほぼ点の集まり。
 * ナビメッシュは列が変わるたびに作り直しが必要で重く、キャラクターコントローラーは衝突の解決であって
 * 経路は決めてくれない。そこで 0.5 単位のグリッドに
 *   - 家具・壁・小物（stage.obstacles）
 *   - 床にあるドミノ（立っている・倒れている）
 * を書き込み、A* で経路を求めて、見通しのよい所は直線にまとめる（文字列引き）。
 * ドミノは 0.5 秒ごとに書き直す。歩道橋の上は、下にドミノがあっても通れる。
 * Ver.0.6：ドミノは実際の形を小人の体の半径だけ太らせて書き込む（すき間が肩幅より広い所だけ通れる）。列はまたげない。
 */
const CELL = 0.5;

class Heap {
  constructor() { this.a = []; }
  push(n, f) { const a = this.a; a.push([f, n]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top[1]; }
  get size() { return this.a.length; }
}

export class NavGrid {
  constructor(game) {
    this.game = game;
    const b = game.stage.bounds;
    this.x0 = b.minX; this.z0 = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / CELL); this.h = Math.ceil((b.maxZ - b.minZ) / CELL);
    this.stat = new Uint8Array(this.w * this.h); // 家具・壁（1=通れない）
    this.dyn = new Uint8Array(this.w * this.h); // ドミノ
    this.bridge = new Uint8Array(this.w * this.h); // 歩道橋の通路
    this.clear = new Uint8Array(this.w * this.h); // 障害物からの距離（マス数、最大15）
    this.region = new Int32Array(this.w * this.h); // つながっている範囲の番号（0＝通れない）。行けない所はA*を回さずすぐ分かる
    this.version = 0; this.dynT = -1;
    this.buildStatic();
  }
  idx(x, z) { const i = Math.floor((x - this.x0) / CELL), j = Math.floor((z - this.z0) / CELL); return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i; }
  center(k) { return new THREE.Vector3(this.x0 + ((k % this.w) + 0.5) * CELL, 0, this.z0 + (Math.floor(k / this.w) + 0.5) * CELL); }
  buildStatic() {
    const st = this.game.stage;
    this.bridge.fill(0); // 歩道橋は呼び出し側で登録し直す
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL;
      this.stat[j * this.w + i] = !st.inBounds(x, z, 0.4) || st.blocked(x, z, 0.3, false) ? 1 : 0;
    }
    this.dynT = -1;
  }
  /** 歩道橋の通路を登録（両端の階段の間。幅1マス強） */
  addBridge(a, b) {
    const len = a.distanceTo(b), n = Math.ceil(len / (CELL * 0.5));
    for (let s = 0; s <= n; s++) {
      const p = a.clone().lerp(b, s / n);
      for (const o of [-0.4, 0, 0.4]) { const k = this.idx(p.x + o, p.z + o); if (k >= 0) this.bridge[k] = 1; const k2 = this.idx(p.x - o, p.z + o); if (k2 >= 0) this.bridge[k2] = 1; }
    }
    this.dynT = -1;
  }
  /** ドミノを書き込む（0.5秒ごと） */
  refresh(time) {
    if (time - this.dynT < 0.5) return;
    this.dynT = time;
    this.dyn.fill(0);
    // Ver.0.6：ドミノの実際の形（幅0.5×厚み0.15、倒れていれば幅0.5×長さ1.0）を小人の体の半径だけ太らせて、
    // そのマスの中心が入っていれば「通れない」。すき間が小人の肩幅より広い所だけ通れる
    const R = CFG.gnomeR + 0.03, x0 = this.x0, z0 = this.z0, NW = this.w;
    for (const d of this.game.dominoes.list) {
      if (d.held || d.removed) continue;
      const t = d.body.translation();
      if (t.y > 1.5) continue;
      const q = d.body.rotation();
      // ドミノの局所 x 軸（幅）と z 軸（厚み）、y 軸（高さ）を床に投影
      const ax = [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)]; // local x → (x, z)
      const az = [2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)]; // local z → (x, z)
      const ay = [2 * (q.x * q.y - q.w * q.z), 2 * (q.y * q.z + q.w * q.x)]; // local y → (x, z)
      // 床に落とした外形：3軸それぞれの半分の長さ×投影の長さを合計した平行四辺形を、2本の軸で近似
      const ex = [CFG.dominoW / 2, CFG.dominoH / 2, CFG.dominoT / 2];
      const axes = [ax, ay, az];
      // 床面での主軸2本：幅の向きと、それに直交する向き
      const ul = Math.hypot(ax[0], ax[1]) > 0.3 ? ax : ay; const n = Math.hypot(ul[0], ul[1]); const u = [ul[0] / n, ul[1] / n], v = [-u[1], u[0]];
      let hu = 0, hv = 0;
      for (let a = 0; a < 3; a++) { hu += ex[a] * Math.abs(axes[a][0] * u[0] + axes[a][1] * u[1]); hv += ex[a] * Math.abs(axes[a][0] * v[0] + axes[a][1] * v[1]); }
      hu += R; hv += R;
      const rr = Math.hypot(hu, hv);
      const i0 = Math.max(0, Math.floor((t.x - rr - x0) / CELL)), i1 = Math.min(NW - 1, Math.floor((t.x + rr - x0) / CELL));
      const j0 = Math.max(0, Math.floor((t.z - rr - z0) / CELL)), j1 = Math.min(this.h - 1, Math.floor((t.z + rr - z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * CELL - t.x, pz = z0 + (j + 0.5) * CELL - t.z;
        const pu = Math.abs(px * u[0] + pz * u[1]), pv = Math.abs(px * v[0] + pz * v[1]);
        if (pu > hu || pv > hv) continue;
        // 角は丸める（太らせた分の円）
        const cu = pu - (hu - R), cv = pv - (hv - R);
        if (cu > 0 && cv > 0 && cu * cu + cv * cv > R * R) continue;
        this.dyn[j * NW + i] = 1;
      }
    }
    // 実際に体が当たって進めなかった所（急なカーブの内側など）：しばらく通れないことにして、道を引き直させる
    if (this.soft && this.soft.length) {
      this.soft = this.soft.filter((b) => time - b.t < 20);
      for (const b of this.soft) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const k = this.idx(b.x + dx * CELL, b.z + dz * CELL); if (k >= 0) this.dyn[k] = 1; }
    }
    // 障害物からの距離（多点 BFS）
    const W = this.w, H = this.h, c = this.clear;
    const q = new Int32Array(W * H); let qh = 0, qt = 0;
    for (let k = 0; k < W * H; k++) { if (this.blockedK(k)) { c[k] = 0; q[qt++] = k; } else c[k] = 15; }
    while (qh < qt) { const k = q[qh++]; const i = k % W, j = (k / W) | 0; const nv = c[k] + 1; if (nv >= 15) continue; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const nk = nj * W + ni; if (c[nk] > nv) { c[nk] = nv; q[qt++] = nk; } } }
    // つながっている範囲に番号をつける（小人が歩ける所。歩道橋の上は通れる）
    const rg = this.region; rg.fill(0); let id = 0;
    for (let k0 = 0; k0 < W * H; k0++) {
      if (rg[k0] || this.blockedK(k0)) continue;
      id++; rg[k0] = id; qh = 0; qt = 0; q[qt++] = k0;
      while (qh < qt) { const k = q[qh++]; const i = k % W, j = (k / W) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const nk = nj * W + ni; if (!rg[nk] && !this.blockedK(nk)) { rg[nk] = id; q[qt++] = nk; } } }
    }
    this.version++;
  }
  /** a から b へ歩いて行けるか（つながっている範囲が同じか）。分からないときは true */
  reachable(a, b, rb = 12) {
    const ka = this.nearestFree(a, 0, 1);
    if (ka < 0) return true; // 自分の居場所が分からない（家具の上など）：止めない
    // 行き先のまわり（倉庫のおもちゃ箱のように大きな物は、その外側）に、同じ範囲の通れるマスがあれば行ける
    return this.nearestFree(b, 0, rb, this.region[ka]) >= 0;
  }
  /** 体が当たって進めなかった所を、しばらく通れないことにする */
  blockAt(x, z, time) { (this.soft ||= []).push({ x, z, t: time }); if (this.soft.length > 40) this.soft.shift(); this.dynT = -1; }
  /** ドミノの列をまたいでいるマス（歩道橋の上は除く） */
  isCrossing(k) { return k >= 0 && this.dyn[k] === 1 && this.bridge[k] !== 1 && this.stat[k] === 0; }
  blockedK(k) { return this.stat[k] === 1 || (this.dyn[k] === 1 && this.bridge[k] !== 1); }
  /** 通れるか（clearance：必要な余白マス数） */
  free(k, clearance = 0) { return k >= 0 && !this.blockedK(k) && this.clear[k] >= clearance; }
  /** p に一番近い通れるマス */
  nearestFree(p, clearance = 0, maxR = 8, region = 0) {
    const k0 = this.idx(p.x, p.z);
    if (this.free(k0, clearance) && (!region || this.region[k0] === region)) return k0;
    const i0 = Math.floor((p.x - this.x0) / CELL), j0 = Math.floor((p.z - this.z0) / CELL);
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
        const k = j * this.w + i; if (!this.free(k, clearance) || (region && this.region[k] !== region)) continue;
        const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  /** 直線で通れるか（マスをたどる） */
  lineFree(a, b, clearance = 0) {
    const d = a.distanceTo(b), n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    for (let s = 1; s < n; s++) { const t = s / n; if (!this.free(this.idx(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), clearance)) return false; }
    return true;
  }
  /**
   * A*：from → to の経路（Vector3 の点列、最後が to の近くの通れる点）。見つからなければ null
   * clearance：列車など大きいものは障害物から離れた所しか通らない
   */
  path(from, to, clearance = 0, maxNodes = Math.max(30000, Math.round(this.w * this.h * 0.7))) {
    const s0 = this.idx(from.x, from.z);
    const s = clearance === 0 && s0 >= 0 && !this.blockedK(s0) ? s0 : this.nearestFree(from, clearance, 6);
    this.lastCrossings = 0;
    if (s < 0) return null;
    // 人（clearance 0）：行き先は、自分と同じつながった範囲の中で一番近いマス。範囲が違えば（列の向こう側）すぐ「道なし」
    const g = this.nearestFree(to, clearance, 10, clearance === 0 && this.version > 0 ? this.region[s] : 0);
    if (g < 0) return null;
    // 同じ範囲にあると分かっている（必ず道がある）：遠回りの長い道でも最後まで探す
    if (clearance === 0 && this.region[s] && this.region[s] === this.region[g]) maxNodes = Math.max(maxNodes, this.w * this.h);
    if (s === g) return [to.clone()];
    const W = this.w;
    const gi = g % W, gj = (g / W) | 0;
    const cost = new Map([[s, 0]]), prev = new Map();
    const open = new Heap(); open.push(s, 0);
    let n = 0;
    const closed = new Uint8Array(this.w * this.h); // 一度調べたマス（同じマスを何度も取り出して上限に達しないように）
    while (open.size) {
      const k = open.pop();
      if (k === g) break;
      if (closed[k]) continue;
      closed[k] = 1;
      if (++n > maxNodes) return null;
      const i = k % W, j = (k / W) | 0, ck = cost.get(k);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        // Ver.0.6：ドミノの列は「またげない」。迂回するか、歩道橋を渡るか、待つ
        if (!this.free(nk, clearance)) continue;
        if (di && dj && (!this.free(j * W + ni, clearance) || !this.free(nj * W + i, clearance))) continue; // 角をすり抜けない
        // 障害物のすぐ横は少し避ける（ドミノの列に沿ってぎりぎりを歩かない）
        const nc = ck + (di && dj ? 1.414 : 1) + (this.clear[nk] <= 1 ? 0.6 : 0);
        if (nc < (cost.get(nk) ?? Infinity)) {
          cost.set(nk, nc); prev.set(nk, k);
          const hx = Math.abs(ni - gi), hz = Math.abs(nj - gj);
          open.push(nk, nc + 1.5 * ((hx + hz) + (1.414 - 2) * Math.min(hx, hz))); // 重み付き A*（広い部屋でも速く。少しだけ遠回りを許す）
        }
      }
    }
    if (!prev.has(g)) return null;
    const cells = []; for (let k = g; k !== s; k = prev.get(k)) cells.push(k); cells.reverse();
    this.lastCrossings = cells.filter((k) => this.isCrossing(k)).length;
    // 遠回りの記録（まっすぐなら近いのに、列を回りこんで何倍も歩く道）。設計主任が歩道橋を架ける場所を選ぶのに使う
    if (clearance === 0) {
      const straight = Math.hypot(to.x - from.x, to.z - from.z), walk = cells.length * CELL * 1.1;
      if (straight > 2 && straight < 20 && walk > straight * 2.5 + 4) { (this.detours ||= []).push({ a: from.clone(), b: to.clone(), t: this.game.time }); if (this.detours.length > 60) this.detours.shift(); }
    }
    // 見通しのよい所は直線にまとめる
    const pts = [from.clone()];
    let anchor = from.clone();
    for (let a = 0; a < cells.length; a++) {
      const next = a + 1 < cells.length ? this.center(cells[a + 1]) : null;
      const cur = this.center(cells[a]);
      if (!next || !this.lineFree(anchor, next, clearance)) { pts.push(cur); anchor = cur; }
    }
    const end = this.center(g);
    // 行き先が別の範囲（列の向こう）なら、こちら側の一番近いマスで止まる（その先へまっすぐ突っ込まない）
    if (g !== this.idx(to.x, to.z) || !this.free(g, clearance)) pts.push(end); else pts.push(to.clone());
    pts.shift();
    return pts;
  }
}

/** 経路をたどる小さなヘルパー（人・列車で共通） */
export class PathFollower {
  constructor(clearance = 0) { this.clearance = clearance; this.pts = null; this.goal = null; this.t = 0; this.ver = -1; this.fail = 0; }
  reset() { this.pts = null; this.goal = null; }
  /**
   * 次に向かう点。目的地が大きく動いた・時間が経った・道がふさがったら引き直す
   * 経路が見つからないときは null（呼び出し側で直進するか待つか決める）
   */
  next(nav, pos, goal, time) {
    const moved = !this.goal || this.goal.distanceTo(goal) > 1.0;
    const blocked = !!(this.pts && this.pts.length && nav.version !== this.ver && !nav.lineFree(pos, this.pts[0], this.clearance));
    const need = moved || !this.pts || time - this.t > 6 || blocked;
    // さっき道が見つからなかった：少し待ってから探し直す（毎フレーム探すと重い）
    if (need && this.failT != null && time - this.failT < 3 && this.goal && this.goal.distanceTo(goal) < 4) return null;
    // 1フレームに引ける経路の数には上限がある（大勢が同時に引き直すと重くなる）。
    // 順番待ちの間：定期的な引き直しなら前の道を使う。道がふさがった・目的地が変わったときは、その場で待つ（突っ込まない）
    if (need && (nav.budget ?? 1) <= 0) { if (this.pts && this.pts.length && !moved && !blocked) return this.pts[0]; return null; }
    if (need) {
      nav.budget = (nav.budget ?? 1) - 1;
      this.goal = goal.clone(); this.t = time; this.ver = nav.version;
      this.pts = nav.path(pos, goal, this.clearance, this.clearance >= 2 ? 20000 : undefined);
      if (!this.pts) { this.fail++; this.failT = time; return null; }
      this.fail = 0; this.failT = null;
    }
    while (this.pts.length > 1 && pos.distanceTo(this.pts[0]) < 0.35) this.pts.shift();
    // 先の点が見えていれば近道
    if (this.pts.length > 1 && nav.lineFree(pos, this.pts[1], this.clearance)) this.pts.shift();
    // 途中までの道の終わりに着いた（行き先は列の向こう）：これ以上近づけない
    if (this.pts.length === 1 && pos.distanceTo(this.pts[0]) < 0.4 && this.pts[0].distanceTo(goal) > 0.6) return null;
    return this.pts[0] || goal;
  }
}
