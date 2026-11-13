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
    name: 'ドミノ自動設置機', icon: '🚜', category: 'build', rarity: 'epic', max: 4, stages: [1, 2], minLevel: 4,
    desc: (lv) => lv === 0 ? 'おもちゃのブルドーザーが計画コースを走りながら毎秒2.5個を設置' : `設置速度 毎秒${(2.5 + 1.5 * lv).toFixed(1)}個へ`,
  },
  level: {
    name: '水平器', icon: '📏', category: 'build', rarity: 'rare', max: 3, stages: [1, 2], minLevel: 3,
    desc: (lv) => `うっかりドミノを倒す確率 -30%（いま -${30 * lv}%）`,
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

  // ---------- 防衛（ストッパーズ） ----------
  stopperCrew: {
    name: 'ストッパー設置係', icon: '🦺', category: 'defense', rarity: 'rare', max: 4, stages: [1, 2], minLevel: 3,
    desc: (lv) => `青ヘルメット隊員が${Math.max(14, 34 - 6 * lv)}個ごとに安全ストッパーを設置（本番開始で自動解除）`,
  },
  restorer: {
    name: '復旧係', icon: '🚑', category: 'defense', rarity: 'rare', max: 4, stages: [1, 2], minLevel: 3,
    desc: (lv) => `事故現場へ駆けつけ、倒れたドミノを素早く起こす隊員（${lv}→${lv + 1}人）`,
  },
  watchtower: {
    name: '見張り塔', icon: '🗼', category: 'defense', rarity: 'rare', max: 3, stages: [2],
    desc: (lv) => `見張り係がルンバと事故を半径${12 + 6 * lv}で検知し警報。みんな早めに退避`,
  },
  guard: {
    name: '警備係', icon: '👮', category: 'defense', rarity: 'rare', max: 4, stages: [2],
    desc: (lv) => `警報で出動し、ルンバの進路に臨時バリケードを置く隊員（${lv}→${lv + 1}人）`,
  },
  barricade: {
    name: 'バリケード', icon: '🚧', category: 'defense', rarity: 'common', max: 5, stages: [2],
    desc: (lv) => `ルンバが避けて方向転換する柵を3つ追加（いま ${3 * lv}個）`,
  },
  sensor: {
    name: '接近センサー', icon: '📡', category: 'defense', rarity: 'common', max: 4, stages: [2],
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
    name: '特殊ベル', icon: '🔔', category: 'gimmick', rarity: 'rare', max: 2, stages: [2], minLevel: 4,
    desc: () => 'コースの横に置く警報ベル。連鎖で鳴ると、ルンバが充電台へ帰りみんな退避',
  },

  // ---------- 特殊 ----------
  magnet: {
    name: 'ドミノ磁石', icon: '🧲', category: 'special', rarity: 'rare', max: 3, stages: [] /* 自由設計（将来のエンドレスモード）用 */, minLevel: 3,
    desc: (lv) => `連鎖後、床のボーナス星を半径${6 + 6 * lv}から吸い寄せて回収`,
  },
  clover: {
    name: '四つ葉の加護', icon: '🍀', category: 'special', rarity: 'rare', max: 3, stages: [1, 2], minLevel: 3,
    desc: (lv) => `ガチャの選択肢が4つになる確率 ${25 * (lv + 1)}%`,
  },
  piggy: {
    name: '欲張り貯金箱', icon: '🐷', category: 'special', rarity: 'epic', max: 1, stages: [1, 2], minLevel: 5,
    desc: () => '連鎖が長いほど貯金（追加経験値）が増える。ゴール到達で全額、失敗すると半分を失う',
  },
  rewind: {
    name: 'ぜんまい巻き戻し', icon: '⏪', category: 'special', rarity: 'common', max: 99, stages: [1, 2], minLevel: 3, consumable: true,
    desc: () => '消費アイテム×2。連鎖失敗後、コースとギミックを倒す前の状態に一瞬で戻す',
  },
};

// 合体設計図（進化）。requires を満たすと、ガチャに設計図が出現する。
export const EVOLUTIONS = {
  massBuild: {
    name: '大量建設隊', icon: '🏗', requires: { builder: 3, basket: 2 },
    desc: '建設担当が金ヘルメットの大量建設隊に。2倍の資材を背負い、1回で2個ずつ並べる',
  },
  fastLine: {
    name: '高速建設ライン', icon: '🛤', requires: { machine: 1, train: 1 },
    desc: '列車が自動設置機に直結。設置機の速度 ×2、補給待ちがほぼ無くなる',
  },
  autoSafety: {
    name: '自動事故防止チーム', icon: '🚨', requires: { stopperCrew: 1, sensor: 1 },
    desc: 'センサーとストッパー隊が連動。ルンバ接近・うっかり連鎖を検知すると自動で緊急ストッパーを差し込み、隊員の移動 ×1.6',
  },
  stopperHQ: {
    name: 'ストッパーズ本部', icon: '🏢', requires: { stopperCrew: 2, watchtower: 1, gate: 1 },
    desc: '本部が建ち、見張り・ストッパー・復旧を統合。全ストッパーがゲート化し、復旧速度 ×2、警報が全域に届く',
  },
};

export const GACHA = {
  choices: 3,
  // 序盤の保証：建設・回収の最低限の能力をガチャ運に依存させない
  guarantees: [
    { level: 2, id: 'builder', when: (p) => (p.builder || 0) === 0 },
    { level: 3, id: 'collector', when: (p) => (p.collector || 0) === 0 },
    { level: 5, id: 'builder', when: (p) => (p.builder || 0) < 2 },
    { level: 6, id: 'stopperCrew', when: (p) => (p.stopperCrew || 0) === 0 },
  ],
  stage2DefenseBias: 1.8, // ステージ2での防衛パーツの重み倍率
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
