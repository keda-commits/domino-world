import * as THREE from 'three';
import { MAT, rbox, shadow } from '../world/props.js';
import { BED_HW } from '../world/toyrail.js';

/**
 * Ver.0.6：ドミノのコースと青い線路が交わる「交差地点」と、それを解決する人たち。
 * - 交差地点のマスは、解決するまで建設担当が並べられない（線路がじゃま）。
 * - 設計主任：建設が交差地点に近づくと現場へ走り、エリート建築士のレベルを見て方法を決める
 *     Lv.2 → 「これなら上を越えられる！」ドミノ階段（立体交差）を建築士に指示
 *     それ以外 → 「ここが邪魔か。撤去班、頼む！」線路の撤去を指示
 * - 撤去したレールは、本番（連鎖）が終わると鉄道の修理班が元に戻す。次の建設でまた交差地点になる
 *   （ドミノ階段は一度建てればずっと使える）。
 * - プレイヤーは場所を指定しない。見守るだけで進み、ドミノは自分でも触れる。
 */
const UP = 8, DECK = 4, DOWN = 20; // 上り8段（段差0.25）・線路の上の床（前後4マス）・下り20段（段差0.1）
const V = (x, z, y = 0) => new THREE.Vector3(x, y, z);

export class Crossings {
  constructor(game, rail) {
    this.game = game; this.rail = rail;
    this.sites = [];
    this.bridgeCount = new Map(); // レールごとの「人が渡った回数」（歩道橋の場所選び）
    this.carried = [];
    this.findSites();
  }

  // ================= 交差地点の検出 =================
  findSites() {
    const g = this.game, tr = this.rail.track;
    const main = g.course.segments[0];
    if (!main) return;
    const sl = main.slots;
    let i = 0;
    while (i < sl.length) {
      if (!tr.onTrack(sl[i].x, sl[i].z, 0.1)) { i++; continue; }
      let j = i; while (j + 1 < sl.length && tr.onTrack(sl[j + 1].x, sl[j + 1].z, 0.1)) j++;
      const c = Math.round((i + j) / 2);
      const i0 = Math.max(0, c - UP - DECK + 1), i1 = Math.min(sl.length - 1, c + DECK + DOWN);
      const center = sl[c];
      const cs = tr.closest(center).s;
      const pieces = tr.pieces.filter((p) => p.mid.distanceTo(V(center.x, center.z)) < 2.2 && !p.elevated);
      const site = { id: this.sites.length, c, i0, i1, center, slots: sl.slice(i0, i1 + 1), trackS: cs, pieces, state: 'wait', plan: null, parts: null };
      for (const s of site.slots) s.site = site;
      this.sites.push(site);
      this.makeSign(site);
      i = j + 1;
    }
  }
  /** このマスは今は並べられない（交差地点が未解決） */
  blocks(slot) { return !!(slot && slot.site && slot.site.state !== 'open'); }

  // ================= 現場の看板（状況が一目で分かるように） =================
  makeSign(site) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.06), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, transparent: true }));
    const g = new THREE.Group(); g.add(m);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), MAT.metal()); pole.position.y = -1.0; g.add(pole);
    const sl = site.center, nx = Math.cos(sl.yaw), nz = -Math.sin(sl.yaw);
    g.position.set(sl.x + nx * 3.2 - Math.sin(sl.yaw) * 4.5, 2.4, sl.z + nz * 3.2 - Math.cos(sl.yaw) * 4.5);
    g.rotation.y = sl.yaw + Math.PI / 2;
    this.game.scene.add(g);
    site.sign = { g, c, t };
    this.drawSign(site);
  }
  drawSign(site) {
    const { c, t } = site.sign, x = c.getContext('2d');
    const txt = {
      wait: ['🚧 線路と交差', '設計主任が確認に来ます'], inspect: ['🧐 設計主任が確認中', 'どう越えるか考えています'],
      stairs: ['🏗 立体交差を建設中', `エリート建築士 ${site.built || 0}/${site.parts ? site.parts.length : '?'}`],
      removing: ['⛏ 線路を撤去中', '撤去班が作業中'], repair: ['🔧 鉄道が線路を修理中', '本番のあと元に戻します'],
      open: site.plan === 'stairs' ? ['✅ 立体交差', 'ドミノは上、列車は下'] : ['✅ 線路を撤去', '本番のあと鉄道が戻します'],
    }[site.state];
    x.clearRect(0, 0, 512, 160);
    x.fillStyle = site.state === 'open' ? '#e6fcf5' : '#fff9db'; x.beginPath(); x.roundRect(4, 4, 504, 152, 22); x.fill();
    x.strokeStyle = site.state === 'open' ? '#0ca678' : '#f59f00'; x.lineWidth = 8; x.stroke();
    x.fillStyle = '#212529'; x.textAlign = 'center'; x.font = 'bold 54px sans-serif'; x.fillText(txt[0], 256, 70);
    x.font = 'bold 34px sans-serif'; x.fillStyle = '#495057'; x.fillText(txt[1], 256, 125);
    t.needsUpdate = true;
  }
  setState(site, st) { site.state = st; this.drawSign(site); this.game.unbuiltDirty = true; }

  // ================= 設計主任 =================
  /** 建設が交差地点に近づいた（手前の未建設が少ない）か */
  nearFront(site) {
    let n = 0;
    for (const s of this.game.course.segments[0].slots) { if (s.i >= site.i0) break; if (!s.domino) n++; }
    return n <= 30;
  }
  thinkChief(w) {
    const g = this.game;
    if (g.mode !== 'build') return false;
    // 1) 交差地点の確認と指示
    // 確認の途中で転んだ・つかまれた場合も、やり直す
    const site = this.sites.find((s) => (s.state === 'wait' && this.nearFront(s)) || s.state === 'inspect');
    if (site) {
      this.setState(site, 'inspect');
      w.say('建設が線路にぶつかる…確認に行ってくる！');
      const spot = g.sideOf(site.center, -2.0, new THREE.Vector3()).add(V(-Math.sin(site.center.yaw) * 3, -Math.cos(site.center.yaw) * 3));
      w.goto(() => spot, () => {
        w.face2(V(site.center.x, site.center.z));
        w.act(2.4, 'read', () => {
          const lv = g.level('architect');
          if (lv >= 2) {
            site.plan = 'stairs'; this.prepareStairs(site); this.setState(site, 'stairs');
            w.say('これなら上を越えられる！ エリート建築士、ここに立体交差を！', 'coin');
          } else {
            site.plan = 'removed'; this.setState(site, 'removing');
            w.say(lv >= 1 ? '階段はまだ設計できないな…ここが邪魔か。撤去班、頼む！' : 'ここが邪魔か。撤去班、頼む！', 'warn');
          }
          g.stats.chiefDecisions = (g.stats.chiefDecisions || 0) + 1;
          w.act(1.2, 'point', () => w.think());
        });
      }, 1.5);
      return true;
    }
    // 2) 人がよく線路を渡る所に、歩道橋（エリート建築士 Lv.1 から）
    if (g.level('architect') >= 1 && !this.bridgeOrder && (g.placed || []).filter((p) => p.type === 'footbridge').length < 2 && g.time - (this.lastBridgeCheck || 0) > 12) {
      this.lastBridgeCheck = g.time;
      const spot = this.footbridgeSpot();
      if (spot) {
        this.bridgeOrder = spot;
        w.say('みんなここで線路を渡っているな…歩道橋を架けよう！');
        w.goto(() => spot.p, () => w.act(1.5, 'point', () => w.think()), 1.3);
        return true;
      }
    }
    return false;
  }
  /** 人の「線路を渡った回数」が多いレールで、歩道橋を置ける場所 */
  footbridgeSpot() {
    const g = this.game, tr = this.rail.track;
    // 前後2本ずつのレールをまとめて数える（人は線路のあちこちで渡るので、1本ずつだと数がたまらない）
    const N = tr.pieces.length, win = (i) => { let n = 0; for (let k = -2; k <= 2; k++) n += this.bridgeCount.get((i + k + N) % N) || 0; return n; };
    const cand = tr.pieces.map((p, i) => [i, win(i)]).filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]);
    for (const [pi] of cand) {
      const p = tr.pieces[pi];
      if (!p || p.elevated || p.state !== 'ok') continue;
      if (this.sites.some((s) => V(s.center.x, s.center.z).distanceTo(p.mid) < 2.5)) continue; // ドミノの列のすぐ横（列の上は不可）
      if ((g.placed || []).some((q) => q.type === 'footbridge' && Math.hypot(q.x - p.mid.x, q.z - p.mid.z) < 10)) continue;
      const nx = Math.cos(p.yaw), nz = -Math.sin(p.yaw); // 線路に直角
      const yaw = Math.atan2(-nz, nx);
      if (g.canPlacePiece('footbridge', p.mid.x, p.mid.z, yaw, true).ok) return { p: V(p.mid.x + nx * 4.5, p.mid.z + nz * 4.5), x: p.mid.x, z: p.mid.z, yaw, piece: pi };
    }
    return null;
  }

  // ================= エリート建築士 =================
  thinkArchitect(w) {
    const g = this.game;
    if (g.mode !== 'build') return false;
    const site = this.sites.find((s) => s.state === 'stairs');
    if (site) {
      const part = site.parts.find((p) => !p.done && (!p.claim || p.claim === w.id)) || site.parts.find((p) => !p.done && p.claimT && g.time - p.claimT > 20);
      if (!part) return false;
      part.claim = w.id; part.claimT = g.time;
      const at = g.sideOf(part.slot, 1.5, new THREE.Vector3());
      w.goto(() => at, () => {
        w.face2(V(part.slot.x, part.slot.z));
        w.act(0.75, 'place', () => { this.buildPart(site, part); if (Math.random() < 0.12) w.say(['トントン…', '寸法よし！', 'もう少しで線路の上だ'][Math.floor(Math.random() * 3)]); w.think(); });
      });
      return true;
    }
    if (this.bridgeOrder && (!this.bridgeOrder.claim || this.bridgeOrder.claim === w.id)) {
      const o = this.bridgeOrder; o.claim = w.id;
      w.say('歩道橋、お任せを！');
      w.goto(() => o.p, () => {
        w.face2(V(o.x, o.z));
        w.act(5, 'place', () => {
          const ok = g.placePiece('footbridge', o.x, o.z, o.yaw, true, true);
          this.bridgeOrder = null;
          if (ok) { w.say('歩道橋、完成！ 線路を安全に渡れます', 'coin'); g.stats.autoFootbridges = (g.stats.autoFootbridges || 0) + 1; }
          w.think();
        });
      });
      return true;
    }
    return false;
  }
  /** ドミノ階段の部品（各マスの下の段・線路の上の床・橋脚） */
  prepareStairs(site) {
    const g = this.game;
    // 交差地点に置いてあったドミノは在庫へ（段の上に置き直す）
    for (const s of site.slots) if (s.domino) { g.dominoes.remove(s.domino); s.domino = null; g.stock++; }
    const parts = [];
    site.slots.forEach((s, k) => {
      const off = s.i - site.c; // 交差の中心からのマス数
      let y;
      if (off < -DECK) y = 0.25 * (off + DECK + UP);
      else if (off <= DECK) y = 2.0;
      else y = Math.max(0, +(2.0 - 0.1 * (off - DECK)).toFixed(2));
      s.stairY = y;
      if (y > 0) parts.push({ slot: s, y, deck: Math.abs(off) <= DECK, done: false });
    });
    // 線路の両側の橋脚
    for (const off of [-DECK - 0.5, DECK + 0.5]) {
      const a = site.slots.find((s) => s.i - site.c === Math.floor(off)), b = site.slots.find((s) => s.i - site.c === Math.ceil(off));
      if (a && b) parts.push({ slot: a, pillar: true, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: 1.75, done: false });
    }
    site.parts = parts; site.built = 0;
    site.group = new THREE.Group(); g.scene.add(site.group);
  }
  buildPart(site, p, instant = false) {
    const g = this.game, s = p.slot;
    const wood = MAT.wood('#e9b872'), deckM = MAT.plastic('#ffd43b'), pil = MAT.plastic('#fab005');
    let mesh, col;
    const yaw = s.yaw;
    if (p.pillar) {
      mesh = new THREE.Mesh(rbox(1.0, 1.75, 0.3, 0.05), pil); mesh.position.set(p.x, 0.875, p.z); mesh.rotation.y = yaw;
      col = g.physics.staticBox(p.x, 0.875, p.z, 0.5, 0.875, 0.15, yaw);
    } else if (p.deck) {
      mesh = new THREE.Mesh(rbox(1.2, 0.25, 0.62, 0.04), deckM); mesh.position.set(s.x, 1.875, s.z); mesh.rotation.y = yaw;
      col = g.physics.staticBox(s.x, 1.875, s.z, 0.6, 0.125, 0.301, yaw);
    } else {
      mesh = new THREE.Mesh(rbox(1.2, p.y, 0.62, 0.04), wood); mesh.position.set(s.x, p.y / 2, s.z); mesh.rotation.y = yaw;
      col = g.physics.staticBox(s.x, p.y / 2, s.z, 0.6, p.y / 2, 0.301, yaw);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    site.group.add(mesh);
    p.mesh = mesh; p.collider = col; p.done = true; p.grow = instant ? 1 : 0;
    // 人は階段をまたがない（よけて歩く）
    p.obstacle = { x: p.pillar ? p.x : s.x, z: p.pillar ? p.z : s.z, hw: 0.65, hd: 0.36, yaw, roomba: true, build: true };
    if (!instant) { mesh.scale.y = 0.05; this.growing = this.growing || []; this.growing.push(p); }
    site.built++;
    if (site.built >= site.parts.length) this.finishStairs(site, instant);
    else if (!instant && site.built % 4 === 0) this.drawSign(site);
  }
  finishStairs(site, instant = false) {
    for (const s of site.slots) s.y = s.stairY;
    // 完成したら、人がまたがない障害物として一度にまとめて登録（部品ごとに経路の地図を作り直すと重い）
    for (const p of site.parts) if (p.obstacle) this.game.stage.obstacles.push(p.obstacle);
    this.game.navDirty = true;
    this.setState(site, 'open');
    this.game.refreshCourse && this.game.refreshCourse();
    if (!instant) {
      const chief = this.game.workers.list.find((w) => w.role === 'chief');
      if (chief) chief.say('立体交差、完成！ ドミノは上を、列車は下を通る！', 'coin');
      this.game.fx.confetti(V(site.center.x, site.center.z, 2.5), 50, 5);
      this.game.stats.stairsBuilt = (this.game.stats.stairsBuilt || 0) + 1;
    }
  }

  // ================= 撤去班 =================
  thinkWrecker(w) {
    const g = this.game, rail = this.rail;
    if (g.mode !== 'build') return false;
    const site = this.sites.find((s) => s.state === 'removing');
    if (!site) return false;
    const crew = g.workers.list.filter((x) => x.role === 'wrecker');
    const k = crew.indexOf(w); if (k < 0 || k > 1) return false;
    site.crew ||= {};
    if (site.crew[k] === 'done') return false; // 途中で転んだら、もう一度向かう
    site.crew[k] = 'going';
    const p = site.pieces[0] || rail.track.pieceAt(site.trackS);
    const tr = rail.track, mid = tr.pointAt(site.trackS);
    const t = tr.pointAt(site.trackS + 0.5).sub(tr.pointAt(site.trackS - 0.5)).normalize();
    const n = V(-t.z, t.x);
    const sgn = k === 0 ? 1 : -1;
    const work = mid.clone().addScaledVector(t, sgn * 1.4); work.y = 0;
    const standby = work.clone().addScaledVector(n, 2.0);
    if (k === 0) w.say('撤去班、出動！');
    w.goto(() => standby, () => {
      const waitTrain = () => {
        if (rail.trainNear(mid, 9, true)) { if (!site.waitSaid) { site.waitSaid = true; w.say('列車が通りすぎるまで待機'); } return w.act(0.5, 'idle', waitTrain); }
        w.goto(() => work, () => {
          w.face2(mid);
          w.act(3.2, 'pry', () => {
            site.crew[k] = 'done';
            if (site.crew[0] === 'done' && site.crew[1] === 'done') this.removeRails(site, crew);
            w.act(0.6, 'cheer', () => w.think());
          });
        });
      };
      waitTrain();
    });
    return true;
  }
  removeRails(site, crew) {
    const g = this.game, rail = this.rail;
    const removed = [];
    for (const p of site.pieces) { const m = rail.track.detach(p); if (m) removed.push(p); }
    g.audio.punch && g.audio.punch();
    // 外したレールを撤去班が線路の脇へ運ぶ（本当に持ち上がって移動する）
    const sl = site.center;
    const pile = V(sl.x - Math.sin(sl.yaw) * 6 + Math.cos(sl.yaw) * 3.5, sl.z - Math.cos(sl.yaw) * 6 - Math.sin(sl.yaw) * 3.5);
    removed.forEach((p, i) => this.carried.push({ mesh: p.mesh, from: p.mesh.position.clone(), to: pile.clone().setY(0.1 + i * 0.18), t: 0, who: crew[i % crew.length] }));
    rail.onRemoved(removed);
    site.removedPieces = removed;
    this.setState(site, 'open');
    const chief = g.workers.list.find((w) => w.role === 'chief');
    if (chief) chief.say('よし、道ができた！ 建設再開だ！', 'coin');
    g.stats.railsRemoved = (g.stats.railsRemoved || 0) + 1;
  }

  /**
   * 本番の直前：階段の上のドミノを点検する（エリート建築士）。
   * 段の上では、少しずれた・傾いたドミノで連鎖が止まりやすいので、ずれているものをマスの上に置き直す
   */
  preRunCheck() {
    const g = this.game; let n = 0;
    for (const site of this.sites) {
      if (site.state !== 'open' || site.plan !== 'stairs') continue;
      for (const s of site.slots) {
        const d = s.domino; if (!d || d.toppled) continue;
        const t = d.body.translation();
        const off = Math.hypot(t.x - s.x, t.z - s.z), dy = Math.abs(t.y - 0.5 - (s.y || 0)), up = g.dominoes.upY(d);
        if (off > 0.03 || dy > 0.03 || up < 0.998) { g.dominoes.remove(d); s.domino = g.dominoes.create(s, { slot: s, colorIndex: Math.floor(Math.max(0, s.order) / 4) }); n++; }
      }
    }
    if (n) {
      g.stats.stairsFixed = (g.stats.stairsFixed || 0) + n;
      const a = g.workers.list.find((w) => w.role === 'architect') || g.workers.list.find((w) => w.role === 'chief');
      if (a) a.say(`階段のドミノを点検：${n}枚まっすぐに直しました`, 'coin');
    }
    return n;
  }

  // ================= 鉄道の修理班（本番のあと） =================
  afterRun() {
    for (const s of this.sites) if (s.state === 'open' && s.plan === 'removed') { this.setState(s, 'repair'); s.repairT = 0; }
  }
  update(dt) {
    const g = this.game, rail = this.rail;
    // 階段が下から伸びる
    if (this.growing) for (const p of [...this.growing]) { p.grow = Math.min(1, p.grow + dt * 3); p.mesh.scale.y = Math.max(0.05, p.grow); if (p.grow >= 1) this.growing.splice(this.growing.indexOf(p), 1); }
    // 外したレールを運ぶ
    for (const c of [...this.carried]) {
      c.t += dt / 2.2;
      const k = Math.min(1, c.t);
      c.mesh.position.lerpVectors(c.from, c.to, k); c.mesh.position.y = c.to.y + Math.sin(k * Math.PI) * 1.2;
      c.mesh.rotation.z = Math.sin(k * Math.PI) * 0.3;
      if (k >= 1) { this.carried.splice(this.carried.indexOf(c), 1); rail.scrapPile.push(c.mesh); }
    }
    // 人が線路を渡った回数（歩道橋の場所を選ぶため）
    this.cntT = (this.cntT || 0) + dt;
    if (this.cntT > 0.5) {
      this.cntT = 0;
      for (const w of g.workers.list) if (w.walking && w.pos.y < 0.5 && rail.track.onTrack(w.pos.x, w.pos.z)) { const pi = rail.track.pieces.indexOf(rail.track.pieceAt(rail.track.closest(w.pos).s)); this.bridgeCount.set(pi, (this.bridgeCount.get(pi) || 0) + 1); }
    }
    // 修理：鉄道の修理班が来て、すき間のドミノを脇へよけ、レールを戻す（建設中だけ。本番中は待つ）
    if (g.mode === 'build') for (const s of this.sites) if (s.state === 'repair') this.updateRepair(s, dt);
  }
  updateRepair(site, dt) {
    const g = this.game, rail = this.rail;
    site.repairT += dt;
    const crew = g.workers.list.filter((w) => w.role === 'railcrew');
    if (!site.crewSent && crew.length) {
      site.crewSent = true;
      const mid = rail.track.pointAt(site.trackS); mid.y = 0;
      crew.forEach((c, i) => {
        c.hold && c.hold('rail');
        c.busy = true;
        const at = mid.clone().add(V((i ? 1 : -1) * 1.3 * Math.sin(site.center.yaw + Math.PI / 2), (i ? 1 : -1) * 1.3 * Math.cos(site.center.yaw + Math.PI / 2)));
        c.goto(() => at, () => { c.face2(mid); c.atSite = site; c.act(0.3, 'idle', () => {}); }, 1.2);
      });
      crew[0] && crew[0].say('本番、おつかれさま。線路を元に戻しますね');
    }
    // 途中で転んだ・つかまれた修理班は、もう一度向かう
    if (site.crewSent && g.time - (site.resendT || 0) > 6) {
      site.resendT = g.time;
      const mid = rail.track.pointAt(site.trackS); mid.y = 0;
      crew.forEach((c, i) => { if (c.atSite !== site && c.state !== 'walk' && c.state !== 'held') { const at = mid.clone().add(V((i ? 1 : -1) * 1.3 * Math.sin(site.center.yaw + Math.PI / 2), (i ? 1 : -1) * 1.3 * Math.cos(site.center.yaw + Math.PI / 2))); c.goto(() => at, () => { c.face2(mid); c.atSite = site; c.act(0.3, 'idle', () => {}); }, 1.2); } });
    }
    const arrived = crew.length && crew.every((c) => c.atSite === site);
    if (!arrived || site.restored) return;
    if (!site.fixT) {
      site.fixT = g.time;
      // すき間に倒れているドミノを、線路の脇へよける（ドミノは回収担当が拾う）
      for (const s of site.slots) {
        const d = s.domino; if (!d) continue;
        const t = d.body.translation();
        if (!rail.track.onTrack(t.x, t.z, 0.4)) continue;
        s.domino = null; d.slot = null;
        g.dominoes.remove(d);
        const nx = Math.cos(s.yaw), nz = -Math.sin(s.yaw);
        g.dominoes.create({ x: t.x + nx * 2.2, y: 0, z: t.z + nz * 2.2, yaw: Math.random() * 6 }, { lying: true, color: d.color });
      }
      crew.forEach((c) => c.act(4, 'kneel', () => {}));
      g.audio.clunk && g.audio.clunk();
    }
    if (g.time - site.fixT > 4) {
      for (const p of site.removedPieces || site.pieces) rail.track.restore(p);
      rail.stats.repaired++;
      site.restored = true;
      crew.forEach((c) => { c.hold && c.hold(null); c.atSite = null; c.busy = false; c.goto(() => c.home, () => c.think()); });
      crew[0] && crew[0].say('線路、元通り！ 運行再開です', 'coin');
      site.plan = null; site.crew = null; site.crewSent = false; site.fixT = 0; site.restored = false; site.waitSaid = false;
      this.setState(site, 'wait');
    }
  }

  // ================= セーブ =================
  serialize() { return { v: 1, sites: this.sites.map((s) => ({ state: s.state === 'open' || s.state === 'repair' ? s.state : 'wait', plan: s.state === 'open' || s.state === 'repair' ? s.plan : null })) }; }
  load(d) {
    if (!d || !d.sites) return;
    d.sites.forEach((v, i) => {
      const site = this.sites[i]; if (!site || !v) return;
      if (v.plan === 'stairs') { site.plan = 'stairs'; this.prepareStairs(site); for (const p of site.parts) this.buildPart(site, p, true); }
      else if (v.plan === 'removed') {
        site.plan = 'removed';
        site.removedPieces = site.pieces.filter((p) => this.rail.track.detach(p));
        for (const p of site.removedPieces) this.rail.track.group.remove(p.mesh);
        this.setState(site, v.state === 'repair' ? 'repair' : 'open');
      }
    });
  }
  dispose() {
    for (const s of this.sites) { if (s.group) { s.parts.forEach((p) => p.collider && this.game.physics.remove(p.collider)); this.game.scene.remove(s.group); } this.game.scene.remove(s.sign.g); }
  }
}
