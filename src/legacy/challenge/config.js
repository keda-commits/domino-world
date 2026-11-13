// ゲームバランスや寸法など、調整したい数値はすべてここに集める。
export const CFG = {
  // ドミノ寸法（1 単位 ≒ 5cm）
  dominoH: 1.0,
  dominoW: 0.5,
  dominoT: 0.16,
  spacing: 0.5,
  metersPerDomino: 0.025,

  // 初期値
  startCoins: 0,
  startStock: 40,

  // 連鎖
  normalFallRate: 9, // 通常モードの転倒速度（個/秒）
  normalFallAccel: 0.03, // 連鎖数に応じた加速
  normalFallMax: 18,
  contStartRate: 1.5, // 連続運転の初速
  contAccel: 0.06, // 加速（一次）
  contAccel2: 0.0006, // 加速（二次）：長く続くほど急加速
  contMaxRate: 40,
  graceTime: 0.6, // 置いている最中のスロットを待つ猶予
  restAngle: 1.22, // 倒れて次に寄りかかった角度
  flatAngle: 1.53,

  // 報酬
  coinNormal: 1,
  coinCont: 1,
  comboNormal: 0.1, // 倍率 = 1 + k * sqrt(連鎖数)
  comboCont: 0.1,
  milestones: [25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000],

  // 小人
  walkSpeed: 3.6,
  placeTime: 0.55,
  pickTime: 0.3,
  repairTime: 0.6,
  tripChancePerSec: 0.012,
  accidentChance: 0.006, // 1回の設置でうっかり倒す確率
  fleeDistance: 1.6,
  maxPerRole: 30,

  // オーバードライブ
  energyMax: 100,
  overdriveTime: 10,
  overdriveMult: 3,

  // 機械
  machineBaseRate: 3,
  machineRatePerLevel: 2.5,
  machineHopper: 20,
  factoryRatePerLevel: 0.7,
  factoryCostPerDomino: 0.6,

  // ショップ
  buy10Cost: 10,

  // 連続運転の解放条件
  contUnlock: { builder: 3, carrier: 2, collector: 1 },
};
