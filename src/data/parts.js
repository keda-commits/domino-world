// ガチャで手に入るパーツ・進化・ガチャ重みの設定ファイル。
// 調整はこのファイルだけで完結するようにしている。
//
// category: build（建設） / logistics（運搬・回収） / defense（防衛・ストッパーズ） / gimmick（連鎖ギミック） / special（特殊）
// rarity:   common / rare / epic / legendary
// stages:   出現するステージ番号
// minLevel: このプレイヤーレベル以上で出現
// requires: 出現に必要な他パーツ（{id: レベル}）

export const RARITY = {
  common: { label: 'ノーマル', weight: 60, color: '#d9d2c5' },
  rare: { label: 'レア', weight: 28, color: '#4dabf7' },
  epic: { label: 'スーパーレア', weight: 10, color: '#b07cff' },
  legendary: { label: 'レジェンド', weight: 2, color: '#ffc531' },
};

export const CATEGORY = {
  build: { label: '建設', color: '#ff8c2a', icon: '🔨' },
  logistics: { label: '運搬・回収', color: '#3b8cff', icon: '📦' },
  defense: { label: '防衛（ストッパーズ）', color: '#1f6fe0', icon: '🛡' },
  gimmick: { label: '連鎖ギミック', color: '#2fb36b', icon: '⚙' },
  special: { label: '特殊', color: '#e6a100', icon: '✨' },
};

export const PARTS = {
  // ---------- 建設 ----------
  builder: {
    name: '建設担当', icon: '👷', category: 'build', rarity: 'common', max: 8, stages: [1, 2],
    desc: (lv) => `設計図に沿ってドミノを先頭から並べる人（${lv}→${lv + 1}人）`,
  },
  boots: {
    name: '作業ブーツ', icon: '👢', category: 'build', rarity: 'common', max: 5, stages: [1, 2], minLevel: 2,
    desc: (lv) => `全員の移動・作業速度 +20%（いま ×${(1 + 0.2 * lv).toFixed(1)}）。赤いブーツを履く`,
  },
  machine: {
    // Ver.0.5：ステージ1・2では出現・稼働しない（並べるのは人の仕事）。将来のエンドレスモード用にコードとセーブのレベルは残す
    name: 'ドミノ自動設置機', icon: '🚜', category: 'build', rarity: 'epic', max: 4, stages: [], minLevel: 4,
    desc: (lv) => lv === 0 ? 'おもちゃのブルドーザーが計画コースを走りながら毎秒2.5個を設置' : `設置速度 毎秒${(2.5 + 1.5 * lv).toFixed(1)}個へ`,
  },
  level: {
    name: '水平器', icon: '📏', category: 'build', rarity: 'rare', max: 3, stages: [1, 2], minLevel: 3,
    desc: (lv) => `うっかりドミノを倒す確率 -30%（いま -${30 * lv}%）`,
  },

  architect: {
    // Ver.0.6：ステージ2から。設計主任の指示で、線路との交差地点を建築で解決する
    name: 'エリート建築士', icon: '📐', category: 'build', rarity: 'rare', max: 2, stages: [2],
    desc: (lv) => lv === 0 ? 'Lv.1：人が線路を安全に渡る歩道橋を架ける（よく渡る所に自動で）' : 'Lv.2：ドミノ階段（立体交差）も建てられる。ドミノは線路の上を越え、列車は下を通る',
  },

  // ---------- 運搬・回収 ----------
  carrier: {
    name: '運搬担当', icon: '📦', category: 'logistics', rarity: 'common', max: 6, stages: [1, 2], minLevel: 2,
    desc: (lv) => `倉庫から最前線の資材置き場へ運ぶ（${lv}→${lv + 1}人）`,
  },
  collector: {
    name: '回収担当', icon: '🧺', category: 'logistics', rarity: 'common', max: 6, stages: [1, 2],
    desc: (lv) => `倒れたドミノを立て直し、散らばったドミノを拾う（${lv}→${lv + 1}人）`,
  },
  basket: {
    name: '運搬カゴ', icon: '🧺', category: 'logistics', rarity: 'common', max: 5, stages: [1, 2], minLevel: 3,
    desc: (lv) => `一度に運べる数 +2（いま 建設${3 + lv}・運搬${8 + 3 * lv}）`,
  },
  factory: {
    name: 'ドミノ製造機', icon: '🏭', category: 'logistics', rarity: 'rare', max: 4, stages: [1, 2], minLevel: 3,
    desc: (lv) => `新品ドミノを毎秒 +0.8個 製造（いま 合計 毎秒${(0.7 + 0.8 * lv).toFixed(1)}個）`,
  },
  train: {
    name: '運搬列車', icon: '🚂', category: 'logistics', rarity: 'epic', max: 3, stages: [1, 2], minLevel: 5,
    desc: (lv) => `おもちゃの列車が倉庫と最前線を往復し一度に${20 * (lv + 1)}個を運ぶ`,
  },

  footbridge: {
    name: '歩道橋', icon: '🪜', category: 'logistics', rarity: 'rare', max: 4, stages: [1, 2], minLevel: 3,
    desc: (lv) => `人がドミノの列を上から越える橋（${lv}→${lv + 1}本）。「配置」で列をまたぐように置くと、遠回りが減って事故も減る`,
  },

  // ---------- 防衛（ストッパーズ） ----------
  soldier: {
    // Ver.0.5：防衛の作り直し。2案（射撃型／押し返し型）を試作し、DEFENSE.style で切り替え（採用は射撃型）
    name: 'おもちゃの兵隊', icon: '💂', category: 'defense', rarity: 'rare', max: 5, stages: [1, 2], minLevel: 4,
    desc: (lv) => `持ち場の近くに来た敵をスポンジ弾で撃退する兵隊（${lv}→${lv + 1}人）。ネズミは1発、ロボットは3発で逃げ帰る。速すぎる暴走ミニカーには効かない。つかんで置いた所が持ち場`,
  },
  stopperCrew: {
    name: 'ストッパー設置係', icon: '🦺', category: 'defense', rarity: 'rare', max: 4, stages: [1, 2], minLevel: 3,
    desc: (lv) => `青ヘルメット隊員が${Math.max(14, 34 - 6 * lv)}個ごとに安全ストッパーを設置（本番開始で自動解除）`,
  },
  restorer: {
    name: '復旧係', icon: '🚑', category: 'defense', rarity: 'rare', max: 4, stages: [1, 2], minLevel: 3,
    desc: (lv) => `事故現場へ駆けつけ、倒れたドミノを素早く起こす隊員（${lv}→${lv + 1}人）`,
  },
  watchtower: {
    name: '見張り塔', icon: '🗼', category: 'defense', rarity: 'rare', max: 3, stages: [] /* Ver.0.6：ルンバ用。ステージ2から外した */,
    desc: (lv) => `見張り係がルンバと事故を半径${12 + 6 * lv}で検知し警報。みんな早めに退避`,
  },
  guard: {
    name: '警備係', icon: '👮', category: 'defense', rarity: 'rare', max: 4, stages: [] /* Ver.0.6：ルンバ用 */,
    desc: (lv) => `警報で出動し、ルンバの進路に臨時バリケードを置く隊員（${lv}→${lv + 1}人）`,
  },
  barricade: {
    name: 'バリケード', icon: '🚧', category: 'defense', rarity: 'common', max: 5, stages: [1], minLevel: 5,
    desc: (lv) => `柵を3つ追加（いま ${3 * lv}個）。暴走ミニカーを跳ね返し、ルンバは方向転換する。「配置」で置く`,
  },
  sensor: {
    // Ver.0.5：おもちゃの兵隊（見張り＋撃退）に統合。新しくは出ない（置いてある分はそのまま動く）
    name: '接近センサー', icon: '📡', category: 'defense', rarity: 'common', max: 4, stages: [],
    desc: (lv) => `置いた場所の半径7にルンバが来ると警報（いま ${2 * lv}本→${2 * lv + 2}本）`,
  },
  gate: {
    name: '自動遮断ゲート', icon: '🚦', category: 'defense', rarity: 'epic', max: 2, stages: [2], requires: { stopperCrew: 1 },
    desc: () => 'ストッパーが本番中も閉じたまま守り、連鎖の波が来る直前に自動で開く',
  },
  bridge: {
    name: '高架橋', icon: '🌉', category: 'defense', rarity: 'epic', max: 3, stages: [] /* 自由設計（将来のエンドレスモード）用 */,
    desc: (lv) => `ルンバの上を越える高架ドミノ橋を1基追加（いま ${lv}基）`,
  },

  // ---------- 連鎖ギミック ----------
  branch: {
    name: '分岐ドミノ', icon: '🔱', category: 'gimmick', rarity: 'rare', max: 3, stages: [] /* 自由設計（将来のエンドレスモード）用 */, minLevel: 4,
    desc: (lv) => `コースの途中から枝分かれするコースを引ける（分岐 ${2 * lv}→${2 * lv + 2}か所）`,
  },
  minicar: {
    name: 'ミニカー発射台', icon: '🏎', category: 'gimmick', rarity: 'rare', max: 3, stages: [] /* 自由設計（将来のエンドレスモード）用 */, minLevel: 5,
    desc: (lv) => `ドミノが押したミニカーが走って、離れた場所のドミノを倒す（${lv}→${lv + 1}台）`,
  },
  marble: {
    name: 'ビー玉スロープ', icon: '🔵', category: 'gimmick', rarity: 'rare', max: 3, stages: [] /* 自由設計（将来のエンドレスモード）用 */, minLevel: 4,
    desc: (lv) => `ドミノがビー玉を押し出し、坂を転がって先のドミノへ（${lv}→${lv + 1}基）`,
  },
  bell: {
    name: '特殊ベル', icon: '🔔', category: 'gimmick', rarity: 'rare', max: 2, stages: [] /* Ver.0.6：ルンバ用 */, minLevel: 4,
    desc: () => 'コースの横に置く警報ベル。連鎖で鳴ると、ルンバが充電台へ帰りみんな退避',
  },

  // ---------- 特殊 ----------
  magnet: {
    name: 'ドミノ磁石', icon: '🧲', category: 'special', rarity: 'rare', max: 3, stages: [] /* 自由設計（将来のエンドレスモード）用 */, minLevel: 3,
    desc: (lv) => `連鎖後、床のボーナス星を半径${6 + 6 * lv}から吸い寄せて回収`,
  },
  clover: {
    name: '四つ葉の加護', icon: '🍀', category: 'special', rarity: 'rare', max: 3, stages: [1, 2], minLevel: 3,
    // Ver.0.5：ガチャは基本2択（10%で3択）。四つ葉は「3択になる確率」を上げる（最大3択）
    desc: (lv) => `ガチャが3択になる確率 ${10 + 15 * lv}% → ${10 + 15 * (lv + 1)}%`,
  },
  piggy: {
    name: '欲張り貯金箱', icon: '🐷', category: 'special', rarity: 'epic', max: 1, stages: [1, 2], minLevel: 5,
    desc: () => '連鎖が長いほど貯金（追加経験値）が増える。ゴール到達で全額、失敗すると半分を失う',
  },
  rewind: {
    // Ver.0.5 で廃止（通常ステージには出ない。将来用に定義だけ残す）
    name: 'ぜんまい巻き戻し', icon: '⏪', category: 'special', rarity: 'common', max: 99, stages: [], minLevel: 3, consumable: true,
    desc: () => '消費アイテム×2。連鎖失敗後、コースとギミックを倒す前の状態に一瞬で戻す',
  },
  xpPack: {
    // 抽選候補が足りないときの代わりの報酬（何度でも出る）
    name: '経験値パック', icon: '⭐', category: 'special', rarity: 'common', max: 9999, stages: [], consumable: true,
    desc: () => '経験値 +30（次のガチャが近づく）',
  },
};

// 合体設計図（進化）。requires を満たすと、ガチャに設計図が出現する。
export const EVOLUTIONS = {
  massBuild: {
    name: '大量建設隊', icon: '🏗', requires: { builder: 3, basket: 2 },
    desc: '建設担当が金ヘルメットの大量建設隊に。2倍の資材を背負い、1回で2個ずつ並べる',
  },
  fastLine: {
    name: '高速建設ライン', icon: '🛤', requires: { machine: 1, train: 1 }, stages: [], // Ver.0.5：ステージ1・2では出ない（自動設置機とともに休止）
    desc: '列車が自動設置機に直結。設置機の速度 ×2、補給待ちがほぼ無くなる',
  },
  autoSafety: {
    name: '自動事故防止チーム', icon: '🚨', requires: { stopperCrew: 1, soldier: 1 },
    desc: '兵隊の見張りとストッパー隊が連動。ルンバ接近・うっかり連鎖を検知すると自動で緊急ストッパーを差し込み、隊員の移動 ×1.6',
  },
  stopperHQ: {
    name: 'ストッパーズ本部', icon: '🏢', requires: { stopperCrew: 2, watchtower: 1, gate: 1 },
    desc: '本部が建ち、見張り・ストッパー・復旧を統合。全ストッパーがゲート化し、復旧速度 ×2、警報が全域に届く',
  },
};

export const GACHA = {
  choices: 2, // 基本2択
  threeChance: 0.1, // 10% で3択
  // 序盤の保証：建設・回収の最低限の能力をガチャ運に依存させない
  guarantees: [
    { level: 2, id: 'builder', when: (p) => (p.builder || 0) === 0 },
    { level: 3, id: 'collector', when: (p) => (p.collector || 0) === 0 },
    { level: 5, id: 'builder', when: (p) => (p.builder || 0) < 2 },
    { level: 6, id: 'soldier', when: (p) => (p.soldier || 0) === 0 }, // ロボット（Lv5〜）への対策
    { level: 7, id: 'stopperCrew', when: (p) => (p.stopperCrew || 0) === 0 },
    { level: 8, id: 'barricade', when: (p) => (p.barricade || 0) === 0 }, // 暴走ミニカー（Lv7〜）への対策
  ],
  stage2DefenseBias: 1.0, // Ver.0.6：ステージ2にルンバはいない
  stage1DefenseBias: 1.7, // ステージ1：レベル5（敵が増え始める）からの防衛パーツの重み倍率
  stage1DefenseFrom: 5,
  repeatPenalty: 0.6, // 前回出たパーツの重み
};

// XP 設定
// 経験値：倒れたドミノ1枚 ＝ 1XP（「あと何枚でガチャ」がそのまま枚数になる）。
// 自己ベストを超えた分は別枠のボーナス。中間ゴールは経験値ではなく確定ガチャ。
export const XP = {
  need: (lv) => (lv === 1 ? 15 : Math.round(25 + 14 * Math.pow(lv - 1, 1.35))), // 最初のガチャは手で並べた短い連鎖で届く
  forRun: (n) => n,
  recordBonusPerDomino: 0.5,
};

// Ver.0.5 防衛方式（試作2案）。'shoot'：スポンジ弾で撃退（採用） / 'push'：走って行って盾で押し返す
export const DEFENSE = { style: 'shoot' };
