// 寸法・物理・バランスの基本定数（パーツやガチャは src/data/parts.js）
export const CFG = {
  // ドミノ（1単位 ≒ 5cm のおもちゃスケール）
  dominoW: 0.5,
  dominoH: 1.0,
  dominoT: 0.15,
  spacing: 0.6, // 高さの60%
  minTurnRadius: 1.1, // これより急なカーブは「危険」表示
  wideW: 1.25, // 分岐ドミノ

  // 物理
  gravity: 80,
  fixedDt: 1 / 120,
  solverIterations: 4,
  maxSubSteps: 10,
  toppleUpY: 0.75, // up ベクトルの y がこれ未満で「倒れた」
  freezeAfter: 1.0, // 倒れて落ち着いたら固定剛体に切り替え（性能対策）
  restandDistance: 1.1, // スロットからこの距離以内なら「その場で立て直し」

  // 連鎖の終了判定
  runIdleEnd: 2.6, // 新たな転倒がこの秒数ないと終了

  // 資材
  startStock: 60,
  baseSupplyRate: 0.7, // おもちゃ箱からの基本補充（個/秒）。在庫不足で詰まない保証
  manualRestoreRate: 6, // 「片付け」長押しで立て直す速さ

  // 小人
  walkSpeed: 3.4,
  placeTime: 0.5,
  pickTime: 0.3,
  restandTime: 0.45,
  accidentChance: 0.004, // 設置1回あたりのうっかり率
  tripChancePerSec: 0.01,
  maxGnomes: 60,

  // ストッパー
  stopperEvery: 34,

  // 経験値オーブ
  orbXP: 6,
};
