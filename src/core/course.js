import * as THREE from 'three';
import { CFG } from '../config.js';

/**
 * ドミノコースの計画。
 * スタート → (セグメント) → [ピース（ミニカー/ビー玉/高架橋）] → (セグメント) → ... → ゴール
 * セグメントはプレイヤーが描いた線。線に沿って等間隔のスロットが並ぶ。
 * 分岐セグメントは親セグメントの途中のスロットから枝分かれする。
 */
export class Course {
  constructor(stage) {
    this.stage = stage;
    this.segments = [];
    this.pieces = []; // ポート付きピース（minicar, marble, bridge）
    this.nextSeg = 1;
    this.version = 0;
    this.allSlots = [];
  }

  // ---------- ポート ----------
  startPort() { const s = this.stage.start; return { x: s.x, z: s.z, yaw: s.yaw, y: 0 }; }
  goalPort() { const g = this.stage.goal; return { x: g.x, z: g.z, yaw: g.yaw, y: 0 }; }

  /** まだ何もつながっていない出口ポート（線を引き始められる場所） */
  openOutputs() {
    const outs = [];
    if (!this.segments.some((s) => s.from.type === 'start')) outs.push({ type: 'start', port: this.startPort() });
    for (const p of this.pieces) if (!this.segments.some((s) => s.from.type === 'piece' && s.from.piece === p.id)) outs.push({ type: 'piece', piece: p.id, port: p.out });
    return outs;
  }
  openInputs() {
    const ins = [];
    if (!this.segments.some((s) => s.to && s.to.type === 'goal')) ins.push({ type: 'goal', port: this.goalPort() });
    for (const p of this.pieces) if (!this.segments.some((s) => s.to && s.to.type === 'piece' && s.to.piece === p.id)) ins.push({ type: 'piece', piece: p.id, port: p.in });
    return ins;
  }
  /** 線を延長できる末端（ゴールに未接続のセグメント） */
  openEnds() { return this.segments.filter((s) => !s.to && s.slots.length); }

  // ---------- 構築 ----------
  /**
   * 描いた点列からセグメントを追加・延長する。
   * 返り値：{seg, added, cut} もしくは null
   */
  addStroke(points, opts = {}) {
    if (points.length < 2) return null;
    const p0 = points[0];
    const near = (a, b, r) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < r * r;
    // 1) 既存セグメントの末端からの延長
    for (const s of this.openEnds()) {
      const last = s.slots[s.slots.length - 1];
      if (near(p0, last, 1.6)) {
        s.pts.push(...points.slice(1).map((p) => ({ x: p.x, z: p.z })));
        this.snapEnd(s);
        return this.rebuild(s);
      }
    }
    // 2) 出口ポートから新規
    for (const o of this.openOutputs()) {
      if (near(p0, o.port, 2.2)) {
        const s = { id: this.nextSeg++, pts: points.map((p) => ({ x: p.x, z: p.z })), from: o.type === 'start' ? { type: 'start' } : { type: 'piece', piece: o.piece }, to: null, slots: [] };
        this.segments.push(s);
        this.snapEnd(s);
        return this.rebuild(s);
      }
    }
    // 3) 途中のスロットから分岐
    if (opts.allowBranch) {
      let best = null, bd = 0.9 * 0.9;
      for (const s of this.segments) {
        for (let i = 1; i < s.slots.length - 2; i++) {
          const sl = s.slots[i];
          if (sl.branchChild || sl.kind === 'wide') continue;
          const d = (sl.x - p0.x) ** 2 + (sl.z - p0.z) ** 2;
          if (d < bd) { bd = d; best = { s, i }; }
        }
      }
      if (best) {
        const parent = best.s.slots[best.i];
        // 分岐方向（左か右か）
        const dirx = points[points.length - 1].x - parent.x, dirz = points[points.length - 1].z - parent.z;
        const nx = Math.cos(parent.yaw), nz = -Math.sin(parent.yaw); // 右手側
        const side = dirx * nx + dirz * nz >= 0 ? 1 : -1;
        const s = { id: this.nextSeg++, pts: points.map((p) => ({ x: p.x, z: p.z })), from: { type: 'branch', seg: best.s.id, slot: best.i, side }, to: null, slots: [] };
        this.segments.push(s);
        this.snapEnd(s);
        return this.rebuild(s);
      }
    }
    return null;
  }

  /** 線の終点がゴールやピースの入口に近ければ接続 */
  snapEnd(s) {
    const end = s.pts[s.pts.length - 1];
    for (const i of this.openInputs()) {
      if ((end.x - i.port.x) ** 2 + (end.z - i.port.z) ** 2 < 3.0 * 3.0) {
        s.to = i.type === 'goal' ? { type: 'goal' } : { type: 'piece', piece: i.piece };
        return;
      }
    }
  }

  segById(id) { return this.segments.find((s) => s.id === id); }
  pieceById(id) { return this.pieces.find((p) => p.id === id); }

  /** セグメントの始点の姿勢 */
  startPose(s) {
    if (s.from.type === 'start') return this.startPort();
    if (s.from.type === 'piece') return this.pieceById(s.from.piece).out;
    // 分岐：親スロットの1つ先を横にずらし、外向きに傾ける
    const ps = this.segById(s.from.seg);
    const p = ps.slots[s.from.slot];
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const nx = Math.cos(p.yaw), nz = -Math.sin(p.yaw);
    const off = s.from.side * 0.55;
    return { x: p.x + fx * CFG.spacing * 0.95 + nx * off, z: p.z + fz * CFG.spacing * 0.95 + nz * off, yaw: p.yaw + s.from.side * 0.3, first: true };
  }

  /** セグメントのスロットを作り直す（不正な位置で打ち切る） */
  rebuild(s) {
    const oldSlots = s.slots;
    const st = this.startPose(s);
    // 点列：始点ポート → 少し前 → 描いた線（始点付近は捨てる）
    const head = [{ x: st.x, z: st.z }, { x: st.x + Math.sin(st.yaw) * 0.6, z: st.z + Math.cos(st.yaw) * 0.6 }];
    let pts = s.pts.filter((p, i) => i > 0 || (p.x - st.x) ** 2 + (p.z - st.z) ** 2 > 1.0);
    // 終点ポートへの接続
    let tail = [];
    if (s.to) {
      const ip = s.to.type === 'goal' ? this.goalPort() : this.pieceById(s.to.piece).in;
      const bx = Math.sin(ip.yaw), bz = Math.cos(ip.yaw);
      // 入口の手前で一直線に入るように
      pts = pts.filter((p) => (p.x - ip.x) ** 2 + (p.z - ip.z) ** 2 > 2.2 * 2.2);
      tail = [{ x: ip.x - bx * 2.0, z: ip.z - bz * 2.0 }, { x: ip.x - bx * CFG.spacing * 0.85, z: ip.z - bz * CFG.spacing * 0.85 }];
    }
    const poly = smooth([...head, ...pts, ...tail]);
    const res = resample(poly, CFG.spacing);
    const slots = [];
    const others = this.slotGrid(s);
    let prevYaw = st.yaw;
    for (let i = 0; i < res.length; i++) {
      const p = res[i];
      const n = res[Math.min(res.length - 1, i + 1)], b = res[Math.max(0, i - 1)];
      let yaw = Math.atan2(n.x - b.x, n.z - b.z);
      if (i === 0) yaw = st.yaw;
      if (i === res.length - 1 && s.to) {
        const ip = s.to.type === 'goal' ? this.goalPort() : this.pieceById(s.to.piece).in;
        yaw = ip.yaw;
      }
      // 同じ線の中での交差（6個以上前のスロットに近すぎる）
      let selfHit = false;
      for (let k = 0; k < slots.length - 6; k++) { const q = slots[k]; if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < 0.55 * 0.55) { selfHit = true; break; } }
      if (selfHit || !this.stage.inBounds(p.x, p.z, 0.4) || this.stage.blocked(p.x, p.z, 0.45) || others(p.x, p.z)) {
        s.to = null; // 途中で打ち切り → 未接続
        s.cutAt = { x: p.x, z: p.z };
        break;
      }
      let dYaw = yaw - prevYaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const radius = Math.abs(dYaw) > 1e-4 ? CFG.spacing / Math.abs(dYaw) : Infinity;
      prevYaw = yaw;
      const y = this.stage.heightAt(p.x, p.z);
      const old = oldSlots[i];
      const slot = {
        seg: s, i, x: p.x, y, z: p.z, yaw, pitch: 0,
        warn: radius < CFG.minTurnRadius,
        domino: null, claim: 0, kind: 'normal', special: null, order: 0,
      };
      // 既に建っているドミノは、位置がほぼ同じなら引き継ぐ
      if (old && old.domino && (old.x - slot.x) ** 2 + (old.z - slot.z) ** 2 < 0.01) { slot.domino = old.domino; old.domino.slot = slot; }
      slots.push(slot);
    }
    // 打ち切られたら終点ポートとの接続は無効。古いスロットで余ったドミノは呼び出し側が処理
    const orphan = oldSlots.slice(slots.length).filter((o) => o.domino).map((o) => o.domino);
    for (let i = 0; i < Math.min(oldSlots.length, slots.length); i++) {
      if (oldSlots[i].domino && slots[i].domino !== oldSlots[i].domino) orphan.push(oldSlots[i].domino);
    }
    s.slots = slots;
    if (s.from.type === 'branch') { const ps = this.segById(s.from.seg); if (ps) ps.slots[s.from.slot].branchChild = s.id; }
    this.refresh();
    return { seg: s, orphan };
  }

  /** 他セグメントのスロットに近すぎないか判定する関数 */
  slotGrid(except) {
    const grid = new Map();
    const key = (x, z) => `${Math.floor(x)},${Math.floor(z)}`;
    for (const s of this.segments) {
      if (s === except) continue;
      for (const sl of s.slots) { const k = key(sl.x, sl.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(sl); }
    }
    for (const p of this.pieces) for (const sl of p.slots || []) { const k = key(sl.x, sl.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(sl); }
    const branchParent = except && except.from.type === 'branch' ? this.segById(except.from.seg) : null;
    const bi = except && except.from.type === 'branch' ? except.from.slot : -1;
    return (x, z) => {
      const cx = Math.floor(x), cz = Math.floor(z);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = grid.get(`${cx + a},${cz + b}`);
        if (!arr) continue;
        for (const sl of arr) {
          if (branchParent && sl.seg === branchParent && Math.abs(sl.i - bi) <= 4) continue;
          if ((sl.x - x) ** 2 + (sl.z - z) ** 2 < 0.5 * 0.5) return true;
        }
      }
      return false;
    };
  }

  /** 順番・特殊スロット・全スロット一覧を更新 */
  refresh() {
    this.version++;
    this.allSlots = [];
    for (const s of this.segments) for (const sl of s.slots) { sl.kind = 'normal'; this.allSlots.push(sl); }
    for (const p of this.pieces) for (const sl of p.slots || []) this.allSlots.push(sl);
    // 分岐元は幅広ドミノ
    for (const s of this.segments) if (s.from.type === 'branch') { const ps = this.segById(s.from.seg); const sl = ps && ps.slots[s.from.slot]; if (sl) sl.kind = 'wide'; }
    // 順番（スタートからの距離）
    for (const sl of this.allSlots) sl.order = -1;
    const visit = (seg, start, depth = 0) => {
      if (depth > 40) return;
      seg.slots.forEach((sl, i) => { sl.order = start + i; });
      for (const ch of this.segments) if (ch.from.type === 'branch' && ch.from.seg === seg.id && seg.slots[ch.from.slot]) visit(ch, seg.slots[ch.from.slot].order + 1, depth + 1);
      if (seg.to && seg.to.type === 'piece') {
        const p = this.pieceById(seg.to.piece);
        let o = start + seg.slots.length;
        if (p.slots) { p.slots.forEach((sl, i) => { sl.order = o + i; }); o += p.slots.length; }
        p.order = o;
        const out = this.segments.find((x) => x.from.type === 'piece' && x.from.piece === p.id);
        if (out) visit(out, o + 1, depth + 1);
      }
    };
    const root = this.segments.find((s) => s.from.type === 'start');
    if (root) visit(root, 0);
  }

  /** ゴールまでつながっているか */
  connected() {
    const root = this.segments.find((s) => s.from.type === 'start');
    if (!root) return false;
    const seen = new Set();
    const reach = (seg) => {
      if (!seg || seen.has(seg.id)) return false;
      seen.add(seg.id);
      if (seg.to && seg.to.type === 'goal') return true;
      for (const ch of this.segments) if (ch.from.type === 'branch' && ch.from.seg === seg.id && reach(ch)) return true;
      if (seg.to && seg.to.type === 'piece') {
        const out = this.segments.find((x) => x.from.type === 'piece' && x.from.piece === seg.to.piece);
        return reach(out);
      }
      return false;
    };
    return reach(root);
  }

  /** スロットの「前」：連鎖がどこから伝わってくるべきか。'start' / スロット / {piece} */
  predecessor(sl) {
    if (sl.seg && sl.seg.slots) {
      if (sl.i > 0) return sl.seg.slots[sl.i - 1];
      const f = sl.seg.from;
      if (f.type === 'start') return 'start';
      if (f.type === 'branch') { const ps = this.segById(f.seg); return ps ? ps.slots[f.slot] : null; }
      if (f.type === 'piece') { const pc = this.pieceById(f.piece); if (pc && pc.type === 'bridge') return pc.slots[pc.slots.length - 1]; return { piece: pc }; }
    } else if (sl.piece) {
      if (sl.i > 0) return sl.piece.slots[sl.i - 1];
      const inSeg = this.segments.find((x) => x.to && x.to.type === 'piece' && x.to.piece === sl.piece.id);
      return inSeg ? inSeg.slots[inSeg.slots.length - 1] : null;
    }
    return null;
  }
  /** ゴールの直前のスロット */
  goalFeeder() { const s = this.segments.find((x) => x.to && x.to.type === 'goal'); return s ? s.slots[s.slots.length - 1] : null; }

  /** スロットの「次」（連鎖が伝わる先）。ピースの場合は {piece} */
  successors(sl) {
    const out = [];
    const seg = sl.seg;
    if (seg && seg.slots) {
      if (sl.i + 1 < seg.slots.length) out.push(seg.slots[sl.i + 1]);
      for (const ch of this.segments) if (ch.from.type === 'branch' && ch.from.seg === seg.id && ch.from.slot === sl.i && ch.slots[0]) out.push(ch.slots[0]);
      if (sl.i === seg.slots.length - 1) {
        if (seg.to && seg.to.type === 'goal') out.push({ goal: true });
        if (seg.to && seg.to.type === 'piece') { const pc = this.pieceById(seg.to.piece); if (pc && pc.type === 'bridge' && pc.slots[0]) out.push(pc.slots[0]); else out.push({ piece: pc }); }
      }
    } else if (sl.piece) {
      const p = sl.piece;
      if (sl.i + 1 < p.slots.length) out.push(p.slots[sl.i + 1]);
      else {
        const o = this.segments.find((x) => x.from.type === 'piece' && x.from.piece === p.id);
        if (o && o.slots[0]) out.push(o.slots[0]);
      }
    }
    return out;
  }

  /** スロット sl から先（同じセグメントの残りと子孫）を削除。消えたスロットのドミノを返す */
  cutFrom(sl) {
    const removed = [];
    const killSeg = (seg) => {
      for (const x of seg.slots) if (x.domino) removed.push(x.domino);
      for (const ch of this.segments.filter((c) => c.from.type === 'branch' && c.from.seg === seg.id)) killSeg(ch);
      if (seg.to && seg.to.type === 'piece') {
        const o = this.segments.find((x) => x.from.type === 'piece' && x.from.piece === seg.to.piece);
        // ピースの出口側はそのまま残す（ピースからまた引き直せる）
        void o;
      }
      this.segments = this.segments.filter((x) => x !== seg);
    };
    const seg = sl.seg;
    if (!seg || !seg.slots) return removed;
    if (sl.i <= 0) { killSeg(seg); this.refresh(); return removed; }
    // 枝分かれ子孫のうち、切った位置以降から出るものは削除
    for (const ch of this.segments.filter((c) => c.from.type === 'branch' && c.from.seg === seg.id && c.from.slot >= sl.i)) killSeg(ch);
    for (const x of seg.slots.slice(sl.i)) if (x.domino) removed.push(x.domino);
    // 点列も切った位置まで縮める
    const keep = seg.slots[sl.i - 1];
    let best = 0, bd = Infinity;
    seg.pts.forEach((p, k) => { const d = (p.x - keep.x) ** 2 + (p.z - keep.z) ** 2; if (d < bd) { bd = d; best = k; } });
    seg.pts = seg.pts.slice(0, best + 1);
    seg.slots = seg.slots.slice(0, sl.i);
    seg.to = null;
    this.refresh();
    return removed;
  }

  // ---------- セーブ ----------
  serialize() {
    return {
      segments: this.segments.map((s) => ({ id: s.id, pts: s.pts.map((p) => [+p.x.toFixed(2), +p.z.toFixed(2)]), from: s.from, to: s.to })),
      nextSeg: this.nextSeg,
    };
  }
}

// ---------- 幾何ユーティリティ ----------
export function smooth(pts) {
  if (pts.length < 3) return pts;
  // 重複を除去
  const clean = [pts[0]];
  for (const p of pts) { const l = clean[clean.length - 1]; if ((p.x - l.x) ** 2 + (p.z - l.z) ** 2 > 0.04) clean.push(p); }
  let cur = clean;
  for (let it = 0; it < 2; it++) {
    const out = [cur[0], cur[1]];
    for (let i = 1; i < cur.length - 2; i++) {
      const a = cur[i], b = cur[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(cur[cur.length - 1]);
    cur = out;
  }
  return cur;
}

export function resample(pts, step) {
  const out = [{ x: pts[0].x, z: pts[0].z }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let d = step - carry;
    while (d <= len) {
      const t = d / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      d += step;
    }
    carry = len - (d - step);
  }
  return out;
}

export const tmpV = new THREE.Vector3();
