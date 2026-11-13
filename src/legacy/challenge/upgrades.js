import { CFG } from './config.js';

// アップグレード定義。effect は現在レベルを受け取って説明文を返す。
export const UPGRADES = [
  {
    id: 'builder', icon: '👷', name: '建設小人を雇う',
    base: 12, growth: 1.38, max: CFG.maxPerRole,
    effect: (lv) => `最前線にドミノを並べる（いま ${lv} 人）`,
  },
  {
    id: 'carrier', icon: '📦', name: '運搬小人を雇う',
    base: 20, growth: 1.4, max: CFG.maxPerRole,
    effect: (lv) => `倉庫→前線資材置き場へ補給（いま ${lv} 人）`,
  },
  {
    id: 'collector', icon: '🧺', name: '回収小人を雇う',
    base: 15, growth: 1.38, max: CFG.maxPerRole,
    effect: (lv) => `倒れたドミノを倉庫へ戻す（いま ${lv} 人）`,
  },
  {
    id: 'speed', icon: '⏩', name: '小人の作業速度',
    base: 40, growth: 1.7, max: 10,
    effect: (lv) => `歩く・置く・拾うが速くなる（×${speedMult(lv).toFixed(2)}）`,
  },
  {
    id: 'basket', icon: '🧺', name: '運搬カゴ',
    base: 30, growth: 1.65, max: 10,
    effect: (lv) => `一度に運べる数 建設${cap('builder', lv)}・運搬${cap('carrier', lv)}・回収${cap('collector', lv)}`,
  },
  {
    id: 'machine', icon: '🚜', name: 'ドミノ自動設置機',
    base: 250, growth: 2.2, max: 8,
    effect: (lv) => lv === 0 ? '最前線を走りながら毎秒3個を自動設置' : `毎秒 ${machineRate(lv).toFixed(1)} 個を設置（資材置き場から補給）`,
  },
  {
    id: 'factory', icon: '🏭', name: 'ドミノ製造機',
    base: 120, growth: 1.9, max: 8,
    effect: (lv) => lv === 0 ? 'コインで新品ドミノを自動生産' : `毎秒 ${factoryRate(lv).toFixed(1)} 個生産（1個 ${CFG.factoryCostPerDomino} コイン）`,
  },
];

export function costOf(id, lv) {
  const u = UPGRADES.find((x) => x.id === id);
  return Math.round(u.base * Math.pow(u.growth, lv));
}

export function speedMult(lv) { return 1 + 0.25 * lv; }

export function cap(role, basketLv) {
  if (role === 'builder') return 3 + basketLv;
  if (role === 'carrier') return 6 + 3 * basketLv;
  return 5 + 2 * basketLv; // collector
}

export function machineRate(lv) {
  return lv <= 0 ? 0 : CFG.machineBaseRate + CFG.machineRatePerLevel * (lv - 1);
}

export function factoryRate(lv) { return CFG.factoryRatePerLevel * lv; }

export function crateCapacity(basketLv) { return 60 + 30 * basketLv; }
