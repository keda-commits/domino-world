import * as THREE from 'three';
import { MAT, rbox, shadow } from '../world/props.js';
import { footbridgeMesh } from '../world/devices.js';

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
 * 通路の確保（Ver.0.6 安定化）
 * ドミノの列は通れないので、コースが長くなると部屋が「区画」に分かれ、小人がたどり着けない仕事が出ることがある。
 *  ・踏み板（基本の通路）：たどり着けない仕事があるときだけ、設計主任（いなければ建設担当）が決めて、建設担当が実際に組み立てる。
 *    低い木の板と小さな坂。ステージで6本まで。ふつうに回りこめる所には作らない
 *  ・歩道橋（エリート建築士 Lv.1 以上の技術）：遠回りがひどい所に、建築士が実際に架ける。ステージで4本まで
 * どちらも「突然現れる」のではなく、作業員が現場で組み立てる間に少しずつできていく。
 */
const PLANK_L = 5.4, PLANK_H = 1.3;

export function plankMesh(L = PLANK_L, H = PLANK_H) {
  const g = new THREE.Group();
  const wood = MAT.wood('#d8a86a'), dark = MAT.wood('#9c6b3a');
  const top = new THREE.Mesh(rbox(L - 2.0, 0.1, 0.9, 0.03), wood); top.position.y = H; g.add(top);
  for (const sx of [-1, 1]) {
    const ramp = new THREE.Mesh(rbox(Math.hypot(1.0, H), 0.08, 0.9, 0.03), wood);
    ramp.position.set(sx * (L / 2 - 0.5), H / 2, 0); ramp.rotation.z = -sx * Math.atan2(H, 1.0); g.add(ramp);
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(rbox(0.35, H / 3 - 0.02, 0.8, 0.04), dark); b.position.set(sx * 1.15, (k + 0.5) * (H / 3), 0); g.add(b); } // 積み木の脚（列の外側）
    for (let k = 0; k < 4; k++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.9), dark); c.position.set(sx * (L / 2 - 0.2 - k * 0.22), (H * (k + 0.6)) / 4, 0); g.add(c); } // 坂のすべり止め
  }
  return shadow(g);
}
/** 通路を置けるか（両端が床の上で、ドミノ・線路・家具・ほかの通路と重ならない） */
export function canPlaceWalkway(g, x, z, yaw, L = PLANK_L) {
  const ax = Math.cos(yaw), az = -Math.sin(yaw);
  for (const t of [-L / 2, -L / 2 + 0.6, L / 2 - 0.6, L / 2]) {
    const px = x + ax * t, pz = z + az * t;
    if (!g.stage.inBounds(px, pz, 0.4) || g.stage.blocked(px, pz, 0.3, false, true)) return false;
    if (g.railway && g.railway.track.onTrack(px, pz, 0.3)) return false;
    for (const d of g.dominoes.near(px, pz)) { const tt = d.body.translation(); if ((tt.x - px) ** 2 + (tt.z - pz) ** 2 < 0.8 * 0.8) return false; }
  }
  if (g.placed.some((p) => (p.type === 'plank' || p.type === 'footbridge') && Math.hypot(p.x - x, p.z - z) < 4)) return false;
  return true;
}

/** 区画の番号（その点の近くの通れるマス） */
function regionAt(N, p, r = 3) { const k = N.nearestFree(p, 0, r); return k < 0 ? 0 : N.region[k]; }

/** 8秒ごと：たどり着けない仕事があれば踏み板を、遠回りがひどければ（建築士がいれば）歩道橋を注文する */
export function autoConnect(g) {
  const N = g.nav; if (!N || !N.version || g.mode !== 'build') return false;
  if ((g.walkJobs || []).some((j) => !j.done)) return false; // 注文は1件ずつ
  const V3 = (x, z) => new THREE.Vector3(x, 0, z);
  const cnt = new Map();
  for (const w of g.workers.list) { if (['soldier', 'guard', 'railchief'].includes(w.role) || w.state === 'held') continue; const r = regionAt(N, w.pos, 1); if (r) cnt.set(r, (cnt.get(r) || 0) + 1); }
  let M = 0, best = -1; for (const [r, n] of cnt) if (n > best) { best = n; M = r; }
  if (!M) return false;
  const workerIn = (r) => (cnt.get(r) || 0) > 0;
  const work = [];
  let k = 0;
  for (const s of g.unbuiltList()) { if (s.domino || g.crossBlocked(s)) continue; work.push(s); if (++k > 12) break; }
  for (const d of g.dominoes.list) if (d.slot && d.toppled && work.length < 40) work.push(d.slot);
  for (const st of (g.crossings ? g.crossings.sites : [])) if (['stairs', 'removing', 'inspect'].includes(st.state)) work.push(st.center);
  const plan = g.railPlans && g.railPlans.active();
  if (plan) { const pc = plan.lines[0].pieces[Math.min(plan.laid[0], plan.lines[0].pieces.length - 1)]; work.push({ x: pc.mid.x, z: pc.mid.z, yaw: 0, plan: true }); }
  let target = null;
  // 長く立ち往生している人が、行き先と別の区画にいる（本当に行けない）
  for (const w of g.workers.list) {
    if ((w.stuckT || 0) < 3) continue;
    const r = regionAt(N, w.pos, 1);
    if (r && r !== M) { target = { p: w.pos.clone(), regs: [r] }; break; }
    const tg = w.targetFn ? w.targetFn() : null, r2 = tg ? regionAt(N, tg, 4) : 0;
    if (r && r2 && r2 !== r) { target = { p: tg.clone(), regs: [r2] }; M = r; break; }
  }
  if (!target) for (const w of work) {
    const sides = w.plan ? [regionAt(N, V3(w.x, w.z), 4)] : [regionAt(N, g.sideOf(w, 0.9, V3(0, 0)), 1), regionAt(N, g.sideOf(w, -0.9, V3(0, 0)), 1)];
    if (sides.some((r) => r === M || (r && workerIn(r)))) continue; // だれかが行ける（回りこめば行ける）
    target = { p: V3(w.x, w.z), regs: sides.filter((r) => r) };
    break;
  }
  if (!target) return detourOrder(g);
  if (g.placed.filter((p) => p.type === 'plank').length >= 6) return false;
  // みんなの区画と、仕事のある区画の境目（立っているドミノの列）で、仕事に一番近い所
  let pick = null, pd = Infinity;
  for (const s of g.course.allSlots) {
    if (!s.domino || s.domino.toppled || (s.site && s.site.state !== 'open') || s.y > 0.05) continue;
    const a = regionAt(N, g.sideOf(s, 1.9, V3(0, 0)), 1), b = regionAt(N, g.sideOf(s, -1.9, V3(0, 0)), 1);
    if (!a || !b || a === b || (a !== M && b !== M)) continue;
    const other = a === M ? b : a;
    const d = Math.hypot(s.x - target.p.x, s.z - target.p.z) * (target.regs.includes(other) ? 0.5 : 1);
    if (d < pd && canPlaceWalkway(g, s.x, s.z, s.yaw)) { pd = d; pick = s; }
  }
  if (!pick) return false;
  orderWalkway(g, 'plank', pick, M);
  return true;
}

/** 遠回りがひどい所（同じあたりで3回以上）：エリート建築士がいれば歩道橋を注文する（いなければ回りこむ） */
function detourOrder(g) {
  const N = g.nav;
  if (!(g.level('architect') >= 1) || !g.workers.list.some((w) => w.role === 'architect')) return false;
  if (g.placed.filter((p) => p.type === 'footbridge' && p.auto).length >= 4) return false;
  const list = (N.detours || []).filter((d) => g.time - d.t < 60);
  if (list.length < 3) return false;
  const key = (d) => `${Math.round((d.a.x + d.b.x) / 16)},${Math.round((d.a.z + d.b.z) / 16)}`;
  const cnt = new Map(); for (const d of list) cnt.set(key(d), (cnt.get(key(d)) || 0) + 1);
  let bk = null, bn = 0; for (const [k, n] of cnt) if (n > bn) { bn = n; bk = k; }
  if (bn < 3) return false;
  const d = list.filter((x) => key(x) === bk).pop();
  N.detours = list.filter((x) => key(x) !== bk);
  let pick = null;
  const L = d.a.distanceTo(d.b);
  for (let t = 0.3; t < L && !pick; t += 0.3) {
    const x = d.a.x + (d.b.x - d.a.x) * (t / L), z = d.a.z + (d.b.z - d.a.z) * (t / L);
    for (const dm of g.dominoes.near(x, z)) {
      const s = dm.slot; if (!s || dm.toppled || (s.site && s.site.state !== 'open') || s.y > 0.05) continue;
      if (Math.hypot(s.x - x, s.z - z) > 0.6) continue;
      if (g.placed.some((p) => (p.type === 'footbridge' || p.type === 'plank') && Math.hypot(p.x - s.x, p.z - s.z) < 7)) return false;
      if (g.canPlacePiece('footbridge', s.x, s.z, s.yaw, true).ok) { pick = s; break; }
    }
  }
  if (!pick) return false;
  orderWalkway(g, 'footbridge', pick, regionAt(N, d.a, 2));
  return true;
}

/** 通路の注文：現場に「工事中」の骨組みを置き、作業員が来て組み立てる */
export function orderWalkway(g, kind, slot, region) {
  const job = { kind, slot, x: slot.x, z: slot.z, yaw: slot.yaw, region, claim: 0, progress: 0, done: false, t: g.time };
  const ghost = kind === 'plank' ? plankMesh() : footbridgeGhost();
  ghost.position.set(slot.x, 0, slot.z); ghost.rotation.y = slot.yaw;
  ghost.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.28; o.material.depthWrite = false; o.castShadow = false; } });
  ghost.scale.y = 0.15;
  g.scene.add(ghost); job.ghost = ghost;
  (g.walkJobs ||= []).push(job);
  g.stats.walkwayOrders = (g.stats.walkwayOrders || 0) + 1;
  const boss = g.workers.list.find((w) => w.role === 'chief') || g.workers.list.find((w) => w.role === 'builder');
  if (boss) boss.say(kind === 'plank' ? 'ここは列で囲まれて行けないな…踏み板を渡そう！' : 'ここは遠回りだな。エリート、歩道橋を頼む！', 'coin');
}
function footbridgeGhost() { return footbridgeMesh(7.5, 2.0); }

/**
 * 通路の工事を受け持つ（踏み板＝建設担当、歩道橋＝エリート建築士）。true なら受け持った。
 * 現場の横（みんなの区画の側）へ歩いて行き、しゃがんで組み立てる。骨組みが少しずつ本物になる
 */
export function thinkWalkway(w, g) {
  const jobs = g.walkJobs; if (!jobs || g.mode !== 'build') return false;
  const job = jobs.find((j) => !j.done && (j.kind === 'plank' ? w.role === 'builder' : w.role === 'architect') && (!j.claim || j.claim === w.id || g.time - (j.claimT || 0) > 30));
  if (!job) return false;
  const V = new THREE.Vector3();
  let side = 0;
  for (const sd of [3.3, -3.3, 2.6, -2.6]) { g.sideOf(job.slot, sd, V); if (g.nav.reachable(w.pos, V, 2)) { side = sd; break; } }
  if (!side) return false;
  job.claim = w.id; job.claimT = g.time;
  w.releaseJob();
  const at = g.sideOf(job.slot, side, new THREE.Vector3());
  if (job.kind === 'plank' && !job.said) { job.said = true; w.say('踏み板、組み立てます！'); }
  if (job.kind === 'footbridge' && !job.said) { job.said = true; w.say('歩道橋、お任せを！'); }
  const step = () => {
    if (job.done || job.claim !== w.id || g.mode !== 'build') return w.think();
    w.face2(new THREE.Vector3(job.x, 0, job.z));
    w.act(1.0, 'place', () => {
      job.progress = Math.min(1, job.progress + (job.kind === 'plank' ? 0.2 : 0.12));
      job.ghost.scale.y = 0.15 + 0.85 * job.progress;
      job.ghost.traverse((o) => { if (o.isMesh) o.material.opacity = 0.28 + 0.6 * job.progress; });
      g.audio.click && g.audio.click(0.8);
      if (job.progress < 1) return step();
      finishWalkway(g, job);
      w.say(job.kind === 'plank' ? '踏み板、できた！ 向こうへ渡れるよ' : '歩道橋、完成！', 'coin');
      w.act(0.6, 'cheer', () => w.think());
    });
  };
  w.goto(() => at, step, 1.2);
  return true;
}
function finishWalkway(g, job) {
  job.done = true;
  g.scene.remove(job.ghost);
  g.addWalkway(job.kind, job.x, job.z, job.yaw);
  g.stats.autoBridges = (g.stats.autoBridges || 0) + 1;
  g.navDirty = true;
}
