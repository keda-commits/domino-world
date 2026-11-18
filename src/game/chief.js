import * as THREE from 'three';

/**
 * 設計主任の日常（Ver.0.6）
 * 線路の交差だけでなく、ふだんから建設の最前線を歩き回って段取りをする指揮官。
 * 普段は仕草（図面を広げる・先を指さす・見回す）で見せ、せりふは状況が変わったときだけ短く言う（言いすぎない）。
 * 指示された人は振り向いて返事をし、走り出す。
 *   ・遊んでいる人に仕事ができた → 村へ行って「仕事だ！」と呼ぶ（campLife.invite）
 *   ・資材箱が空に近い → 「資材が足りない！ 運搬班、頼む！」→ 運搬担当が返事して急ぐ
 *   ・列の向こうへ行けずに困っている人がいる → 「ここは通れないな。迂回してくれ！」
 *   ・ふだん → 建設の先頭へ行って図面を広げ、先を指さす／できた所を見て回る
 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function chiefRoutine(w, g) {
  const life = g.campLife, now = g.time;
  const C = (w.chiefMem ||= { sayT: -99, materialT: -99, stuckSeen: 0, patrolN: 0, inviteT: -99 });
  const talk = (text, cls = '', force = false) => { if (force || now - C.sayT > 9) { C.sayT = now; w.say(text, cls); return true; } return false; };
  const replyFrom = (list, lines, run = 1.3) => {
    list.slice(0, 3).forEach((o, i) => setTimeoutGame(g, 0.6 + i * 0.4, () => {
      if (o.removed || o.state === 'trip' || o.state === 'held' || o.haul) return;
      o.say(lines[i % lines.length]);
      if (o.state === 'act' && (o.pose === 'idle' || o.pose === 'shrug')) { o.face2(w.pos); o.act(0.5, 'salute', () => { o.runMult = run; o.think(); }); }
      else o.runMult = run;
    }));
  };

  // 1) 遊んでいる人に仕事ができた：村へ呼びに行く
  if (life && now - C.inviteT > 25) {
    const t = life.inviteTarget();
    if (t) {
      C.inviteT = now;
      const spot = t.v.center.clone().add(t.v.spots.greet);
      w.goto(() => spot, () => { w.face2(t.v.center); w.act(1.4, 'point', () => w.think()); life.invite(w, t.v); C.sayT = g.time; }, 1.4);
      return true;
    }
  }
  // 2) 資材が足りない：運搬担当を急がせる
  const carriers = g.workers.list.filter((o) => o.role === 'carrier' && !o.haul);
  if (carriers.length && g.crate.count < 8 && g.stock > 10 && g.unbuiltCount() > 0 && now - C.materialT > 40) {
    C.materialT = now;
    const spot = g.crate.pos.clone().add(V(2.2, 0, 1.5));
    w.goto(() => spot, () => {
      w.face2(g.nearestDepot(w.pos).pos);
      w.act(1.4, 'point', () => w.think());
      if (talk('資材が足りない！ 運搬班、頼む！', 'warn', true)) {
        const near = carriers.slice().sort((a, b) => a.pos.distanceToSquared(w.pos) - b.pos.distanceToSquared(w.pos));
        replyFrom(near, ['はい、すぐ運びます！', 'りょうかい！', '急ぎます！'], 1.45);
        g.stats.chiefMaterial = (g.stats.chiefMaterial || 0) + 1;
      }
    }, 1.3);
    return true;
  }
  // 3) 列の向こうへ行けずに困っている人：迂回を指示
  const st = g.lastStuck;
  if (st && st.t > C.stuckSeen && now - st.t < 8 && st.w && !st.w.removed) {
    C.stuckSeen = st.t;
    const who = st.w, p = st.pos.clone();
    w.goto(() => p.clone().add(V(1.2, 0, 1.2)), () => {
      w.face2(who.pos);
      if (talk('ここは通れないな。迂回してくれ！', '', true)) {
        w.act(1.2, 'point', () => w.think());
        setTimeoutGame(g, 0.8, () => { if (!who.removed) who.say(Math.random() < 0.5 ? 'わかりました、回ります！' : 'はい、ぐるっと回ります'); });
        g.stats.chiefDetour = (g.stats.chiefDetour || 0) + 1;
      } else w.act(1.0, 'point', () => w.think());
    }, 1.3);
    return true;
  }
  // 4) ふだん：建設の先頭へ行って図面を広げ、先を指さす（ときどき「次はあっちだ！」）。合間にできた所を見て回る
  const head = g.buildHead && g.buildHead();
  if (head && g.mode === 'build') {
    C.patrolN++;
    if (C.patrolN % 3 === 0) {
      // できた所の点検：少し手前のドミノの横を歩いて、しゃがんで見る
      const back = g.course.allSlots.find((s) => s.order === Math.max(0, head.order - 12 - Math.floor(Math.random() * 10)));
      if (back && back.domino) {
        const p = g.sideOf(back, back.order % 2 ? 1.6 : -1.6, V());
        w.goto(() => p, () => { w.face2(V(back.x, 0, back.z)); w.act(1.6, 'pick', () => { if (Math.random() < 0.3) talk(Math.random() < 0.5 ? 'よし、まっすぐ並んでる' : 'この調子だ'); w.act(0.6, 'idle', () => w.think()); }); });
        return true;
      }
    }
    const ahead = g.course.allSlots.find((s) => s.order === head.order + 14) || head;
    const p = g.sideOf(head, -2.6, V()).add(V(Math.sin(head.yaw) * -1.2, 0, Math.cos(head.yaw) * -1.2));
    w.goto(() => p, () => {
      w.face2(V(head.x, 0, head.z));
      w.act(1.8, 'read', () => {
        w.face2(V(ahead.x, 0, ahead.z));
        const said = Math.random() < 0.35 && talk(['次はあっちだ！', 'この先へまっすぐだ！', 'カーブは慎重にな！'][Math.floor(Math.random() * 3)]);
        if (said) {
          const bs = g.workers.list.filter((o) => o.role === 'builder' && o.pos.distanceTo(w.pos) < 9).slice(0, 1);
          replyFrom(bs, ['了解！', 'はい！'], 1.2);
        }
        w.act(1.3, 'point', () => w.act(1.5 + Math.random(), 'idle', () => w.think()));
      });
    }, 1.0);
    return true;
  }
  return false;
}

/** ゲーム内時間での遅延（一時停止・早送りに合わせる） */
export function setTimeoutGame(g, sec, fn) { if (g.campLife) g.campLife.after(sec, fn); else fn(); }

/**
 * 仮設の歩道橋（Ver.0.6）：ドミノの列は通れないので、コースが長くなると部屋がいくつもの「区画」に分かれ、
 * 小人がたどり着けない仕事（未建設のマス・倒れたドミノ・階段・線路の工事・資材）が出てくる。
 * 8秒ごとに調べ、みんなのいる区画から仕事のある区画へ、設計主任の指示で歩道橋を架ける（1回に1本、ステージで14本まで）。
 */
export function autoConnect(g) {
  const N = g.nav; if (!N || !N.version || g.mode !== 'build') return false;
  const made = g.placed.filter((p) => p.auto).length;
  if (made >= 24) return false;
  const reg = (p, r = 3) => { const k = N.nearestFree(p, 0, r); return k < 0 ? 0 : N.region[k]; };
  const V3 = (x, z) => new THREE.Vector3(x, 0, z);
  // みんながいる区画
  const cnt = new Map();
  for (const w of g.workers.list) { if (['soldier', 'guard', 'railchief'].includes(w.role) || w.state === 'held') continue; const r = reg(w.pos, 1); if (r) cnt.set(r, (cnt.get(r) || 0) + 1); }
  let M = 0, best = -1; for (const [r, n] of cnt) if (n > best) { best = n; M = r; }
  if (!M) return false;
  const workerIn = (r) => (cnt.get(r) || 0) > 0;
  // 仕事のある所（区画と位置）
  const work = [];
  let k = 0;
  for (const s of g.unbuiltList()) { if (s.domino || g.crossBlocked(s)) continue; work.push(s); if (++k > 12) break; }
  for (const d of g.dominoes.list) if (d.slot && d.toppled && work.length < 40) work.push(d.slot);
  for (const st of (g.crossings ? g.crossings.sites : [])) if (['stairs', 'removing', 'inspect'].includes(st.state)) work.push(st.center);
  const plan = g.railPlans && g.railPlans.active();
  if (plan) { const li = 0, pc = plan.lines[li].pieces[Math.min(plan.laid[li], plan.lines[li].pieces.length - 1)]; work.push({ x: pc.mid.x, z: pc.mid.z, yaw: 0, plan: true }); }
  let target = null;
  // 長く立ち往生している人（設計主任・建築士なども）が、みんなと別の区画に閉じこめられている
  for (const w of g.workers.list) {
    if ((w.stuckT || 0) < 3) continue;
    const r = reg(w.pos, 1);
    if (r && r !== M) { target = { p: w.pos.clone(), regs: [r] }; break; }
    // みんなと同じ区画にいるが、行き先が列の向こう：その人の区画から行き先の区画へ
    const tg = w.targetFn ? w.targetFn() : null, r2 = tg ? reg(tg, 4) : 0;
    if (r && r2 && r2 !== r) { target = { p: tg.clone(), regs: [r2] }; M = r; break; }
  }
  if (!target) for (const w of work) {
    const sides = w.plan ? [reg(V3(w.x, w.z), 4)] : [reg(g.sideOf(w, 0.9, V3(0, 0)), 1), reg(g.sideOf(w, -0.9, V3(0, 0)), 1)];
    if (sides.some((r) => r === M || (r && workerIn(r)))) continue; // だれかが行ける
    target = { p: V3(w.x, w.z), regs: sides.filter((r) => r) };
    break;
  }
  if (!target) return detourBridge(g, made);
  // みんなの区画と隣り合う別の区画の境目（立っているドミノの列）で、仕事に一番近い所に架ける
  let pick = null, pd = Infinity;
  for (const s of g.course.allSlots) {
    if (!s.domino || s.domino.toppled || (s.site && s.site.state !== 'open') || s.y > 0.05) continue;
    const a = reg(g.sideOf(s, 1.9, V3(0, 0)), 1), b = reg(g.sideOf(s, -1.9, V3(0, 0)), 1);
    if (!a || !b || a === b || (a !== M && b !== M)) continue;
    const other = a === M ? b : a;
    const d = Math.hypot(s.x - target.p.x, s.z - target.p.z) * (target.regs.includes(other) ? 0.5 : 1);
    if (d < pd && g.canPlacePiece('footbridge', s.x, s.z, s.yaw, true).ok) { pd = d; pick = s; }
  }
  if (!pick) return false;
  const p = g.placePiece('footbridge', pick.x, pick.z, pick.yaw, true, true);
  if (!p) return false;
  p.auto = true;
  p.mesh.scale.y = 0.05; (g.growMeshes ||= []).push(p.mesh);
  g.stats.autoBridges = (g.stats.autoBridges || 0) + 1;
  const chief = g.workers.list.find((w) => w.role === 'chief') || g.workers.list.find((w) => w.role === 'architect') || g.workers.list.find((w) => w.role === 'builder');
  if (chief) chief.say('ここは列で囲まれて通れないな…歩道橋を架けよう！', 'coin');
  g.fx.confetti && g.fx.confetti(new THREE.Vector3(pick.x, 2.4, pick.z), 20, 3);
  return true;
}

/** 遠回りがよく起きる所（同じあたりで3回以上）に、列をまたぐ歩道橋を架ける */
function detourBridge(g, made) {
  const N = g.nav, list = (N.detours || []).filter((d) => g.time - d.t < 60);
  if (list.length < 3) return false;
  const key = (d) => `${Math.round((d.a.x + d.b.x) / 16)},${Math.round((d.a.z + d.b.z) / 16)}`;
  const cnt = new Map(); for (const d of list) cnt.set(key(d), (cnt.get(key(d)) || 0) + 1);
  let bk = null, bn = 0; for (const [k, n] of cnt) if (n > bn) { bn = n; bk = k; }
  if (bn < 3) return false;
  const d = list.filter((x) => key(x) === bk).pop();
  // まっすぐな線の上で最初にぶつかる、立っているドミノのマス
  let pick = null;
  const L = d.a.distanceTo(d.b);
  for (let t = 0.3; t < L && !pick; t += 0.3) {
    const x = d.a.x + (d.b.x - d.a.x) * (t / L), z = d.a.z + (d.b.z - d.a.z) * (t / L);
    for (const dm of g.dominoes.near(x, z)) {
      const s = dm.slot; if (!s || dm.toppled || (s.site && s.site.state !== 'open') || s.y > 0.05) continue;
      if (Math.hypot(s.x - x, s.z - z) > 0.6) continue;
      if (g.placed.some((p) => p.type === 'footbridge' && Math.hypot(p.x - s.x, p.z - s.z) < 7)) { N.detours = list.filter((x2) => key(x2) !== bk); return false; }
      if (g.canPlacePiece('footbridge', s.x, s.z, s.yaw, true).ok) { pick = s; break; }
    }
  }
  N.detours = list.filter((x) => key(x) !== bk);
  if (!pick) return false;
  const p = g.placePiece('footbridge', pick.x, pick.z, pick.yaw, true, true);
  if (!p) return false;
  p.auto = true; p.mesh.scale.y = 0.05; (g.growMeshes ||= []).push(p.mesh);
  g.stats.autoBridges = (g.stats.autoBridges || 0) + 1; g.stats.detourBridges = (g.stats.detourBridges || 0) + 1;
  const chief = g.workers.list.find((w) => w.role === 'chief') || g.workers.list.find((w) => w.role === 'builder');
  if (chief) chief.say('ここは遠回りだな…歩道橋を架けよう！', 'coin');
  return true;
}
