import { PARTS, EVOLUTIONS } from '../data/parts.js';

/**
 * ホバーステータス（Ver.0.4）
 * カーソルの先にある 3D のもの（手前優先）の情報を、実際のゲームデータから作る。
 * 返り値：{ title, rows: [[ラベル, 値]], note, warn } または null
 */
const ROLE_ICON = { builder: '👷', carrier: '📦', collector: '🧺', stopperCrew: '🦺', restorer: '🚑', guard: '👮' };
const STATE_TEXT = {
  walk: '移動中', flee: '避難中！', trip: '転んでいる…',
  act: { place: 'ドミノを設置中', pick: '拾う・立て直し中', kneel: 'ストッパー設置中', salute: '待機（敬礼）', idle: '待機中', cheer: '大喜び！', surprised: 'びっくり！', oops: 'あっ！（事故）', shrug: '在庫切れで待機', alarm: '警報！', carry: '運搬中' },
};
const ROOMBA_STATE = { dock: '充電台で待機', patrol: '掃除中', return: '充電台へ帰還中', leave: '出発中', warn: '出発準備中' };

function partLine(game, id) {
  const p = PARTS[id];
  if (!p) return null;
  const lv = game.level(id);
  return { name: p.name, lv, desc: typeof p.desc === 'function' ? p.desc(lv) : p.desc, max: p.max };
}
/** 関係する進化（あと少しで進化できるもの） */
function evoHint(game, id) {
  for (const [eid, e] of Object.entries(EVOLUTIONS)) {
    if (!e.requires || !(id in e.requires) || game.evolved(eid)) continue;
    const lack = Object.entries(e.requires).filter(([k, v]) => game.level(k) < v).map(([k, v]) => `${PARTS[k] ? PARTS[k].name : k} Lv${v}`);
    return lack.length ? `進化「${e.name}」まで：${lack.join('・')}` : `進化「${e.name}」が可能（ガチャに出現）`;
  }
  return null;
}

function describeDomino(game, d) {
  const b = d.body, lv = b.linvel();
  const moving = Math.hypot(lv.x, lv.y, lv.z) > 0.4;
  const kindName = { normal: 'ドミノ', wide: '幅広ドミノ（中間ゴール用）', present: 'プレゼントドミノ', clover: '四つ葉ドミノ' }[d.kind] || 'ドミノ';
  let state;
  if (d.held) state = 'つかまれている';
  else if (moving) state = '動いている';
  else if (d.toppled) state = '倒れている';
  else if (d.slot && game.dominoes.isStandingAt(d, d.slot)) state = '立っている（設計図どおり）';
  else if (game.dominoes.upY(d) > 0.95) state = d.slot ? '立っている（少しずれている）' : '立っている（設計図の外）';
  else state = '傾いている';
  const total = game.course.allSlots.length;
  const rows = [['状態', state], ['位置', d.slot && d.slot.order >= 0 ? `${d.slot.order + 1} / ${total} 番目` : '設計図の外（拾われると在庫へ）']];
  const eff = { wide: '連鎖で横の装置を動かす', present: '連鎖で倒すとガチャ券', clover: '連鎖で倒すと次のガチャの選択肢が増える' }[d.kind];
  if (eff) rows.push(['効果', eff]);
  if (d.slot && d.slot.order >= 0) {
    const o = d.slot.order;
    let before = null, after = null;
    for (const s of game.stoppers) { const so = s.slot.order; if (so < o && (!before || so > before.slot.order)) before = s; if (so >= o && (!after || so < after.slot.order)) after = s; }
    rows.push(['ストッパー', before || after ? `${before ? `${o - before.slot.order}枚前` : 'なし'} ／ ${after ? `${after.slot.order - o + 1}枚先` : 'なし'}` : '保護なし']);
  }
  return { title: `🁢 ${kindName}`, rows, note: d.held ? '' : 'ドラッグでつかむ／ダブルクリックでデコピン' };
}

function describeWorker(game, w) {
  const part = partLine(game, w.role);
  const st = w.state === 'act' ? STATE_TEXT.act[w.pose] || '作業中' : STATE_TEXT[w.state] || '作業中';
  const rows = [['いま', st], ['Lv', `${part ? part.lv : '-'}`], ['速さ', `×${w.speed.toFixed(2)}`]];
  if (['builder', 'carrier', 'collector'].includes(w.role)) rows.push(['運べる量', `${w.capacity}枚（持っている：${w.load}）`]);
  if (w.role === 'stopperCrew') rows.push(['ストッパー', `${game.stoppers.length}個 設置済み`]);
  if (w.role === 'restorer') rows.push(['対応', '事故で倒れたドミノを素早く起こす']);
  if (w.role === 'guard') rows.push(['対応', '警報でルンバの進路にバリケード']);
  return { title: `${ROLE_ICON[w.role] || '🧑'} ${part ? part.name : w.role}`, rows, note: part ? part.desc : '' };
}

function describeFacility(game, id, extra = []) {
  const part = partLine(game, id);
  const rows = [['Lv', part ? `${part.lv} / ${part.max}` : '-'], ...extra];
  const hint = evoHint(game, id);
  return { title: `🏗 ${part ? part.name : id}`, rows, note: [part && part.desc, hint].filter(Boolean).join('\n') };
}

function describeRoomba(game, r) {
  const rows = [['行動', ROOMBA_STATE[r.state] || r.state]];
  if (r.state === 'dock') rows.push(['次の出動', `あと ${Math.max(0, Math.ceil(r.timer))} 秒`], ['次のルート', r.pattern.name]);
  else rows.push(['ルート', r.pattern.name]);
  rows.push(['危険度', r.state === 'patrol' ? '高（列を押し倒す・倒れたドミノを吸う）' : r.state === 'dock' ? '待機中は安全' : '中']);
  rows.push(['吸い込み', `${r.bin}枚`]);
  return { title: '🤖 ルンバ', rows, note: '対策：バリケード（向きを変える）／特殊ベル・警報ベル（充電台へ帰す）／見張り塔', warn: r.state === 'patrol' };
}

/** レイの先の一番手前のもの */
export function describeAt(game, hand, ray) {
  const cands = [];
  const dh = hand.pickDomino(ray);
  if (dh) cands.push({ dist: ray.ray.origin.distanceTo(dh.point), f: () => describeDomino(game, dh.d) });
  const add = (obj, f) => { if (!obj || !obj.visible) return; const h = ray.intersectObject(obj, true)[0]; if (h) cands.push({ dist: h.distance, f }); };
  for (const w of game.workers.list) add(w.root, () => describeWorker(game, w));
  if (game.roomba) add(game.roomba.group, () => describeRoomba(game, game.roomba));
  for (const th of game.threats || []) add(th.group, () => th.describe());
  for (const dp of game.depots) add(dp.mesh, () => ({ title: '🧸 おもちゃ箱（倉庫）', rows: [['在庫', `${game.stock}枚`]], note: 'ドラッグでドミノを1枚取り出せる' }));
  add(game.crate.group, () => ({ title: '📦 前線の資材箱', rows: [['中身', `${game.crate.count} / ${game.crate.cap}枚`]], note: '建設の先頭についていく。ドラッグで取り出せる' }));
  if (game.level('machine')) add(game.machine.group, () => describeFacility(game, 'machine', [['ホッパー', `${game.machine.hopper}枚`]]));
  if (game.level('train')) add(game.train.mesh || game.train.group, () => describeFacility(game, 'train', [['積み荷', `${game.train.load}枚`]]));
  if (game.level('factory')) add(game.factory.group, () => describeFacility(game, 'factory'));
  if (game.tower) add(game.tower, () => describeFacility(game, 'watchtower', [['見張り半径', `${game.watchRadius()}`]]));
  for (const s of game.stoppers) add(s.mesh, () => ({ title: s.gate ? '🚦 自動遮断ゲート' : '🟨 安全ストッパー', rows: [['場所', `${s.slot.order + 1}〜${s.next.order + 1} 番目の間`], ['状態', s.armed ? (s.locked ? '設置中（本番でも外さない）' : '設置中（本番で自動解除）') : '解除'], ['役割', '事故の連鎖をここで止める']] }));
  for (const cp of game.checkpoints || []) add(cp.toy, () => ({ title: `🎯 中間ゴール${cp.index + 1}「${cp.def.name}」`, rows: [['位置', `${cp.slotIndex + 1} 番目`], ['報酬', cp.done ? '受け取り済み' : '確定ガチャ（一度きり）']] }));
  if (!cands.length) return null;
  cands.sort((a, b) => a.dist - b.dist);
  return cands[0].f();
}
