import type { City, Company, Owner, Player, Plot, Recipe, Industry } from '@/contracts/game-state';
import type { DecorPlacement, MapMeta } from '../types';
import { computeConnectivity } from '@/city/connectivity';
import { ec, ecDays } from './util';

/* ───────────────────────── ILLUSTRATIVE DATA — not authoritative economic state ───────────────────────── */

export const CITY_ID = 'city-bristol';
export const PLAYER_OWNER: Owner = { id: 'player-demo', name: 'You (demo trader)', kind: 'player' };
const npc = (id: string, name: string): Owner => ({ id, name, kind: 'npc' });

export const player: Player = {
  id: PLAYER_OWNER.id, displayName: 'Demo Trader', cityId: CITY_ID,
  coins: ec(24_850), reservedCoins: ec(1_200), portfolioValue: ec(37_810), netWorth: ec(62_660),
  dailyProfit: ec(510), unreadNotifications: 2,
};

/** Grid + plot layout: 16×16, river on the east, roads on c/r = 4 and 9. */
const COLUMNS = 16, ROWS = 16;
type Block = { id: string; assetId: string; c: number; r: number; w: number; d: number; companyId: string | null; owner: Owner | null };
const blocks: Block[] = [
  { id: 'plot-farm', assetId: 'farm', c: 0, r: 1, w: 3, d: 2, companyId: 'co-severn-farm', owner: npc('npc-severn', 'Severn Valley Growers') },
  { id: 'plot-mill', assetId: 'mill', c: 5, r: 1, w: 3, d: 2, companyId: 'co-brunel-mill', owner: npc('npc-brunel', 'Brunel Milling Ltd') },
  { id: 'plot-dairy', assetId: 'dairy', c: 10, r: 1, w: 3, d: 2, companyId: 'co-clifton-dairy', owner: npc('npc-clifton', 'Clifton Creamery Co-op') },
  { id: 'plot-timber', assetId: 'timber', c: 0, r: 6, w: 3, d: 2, companyId: 'co-avon-timber', owner: npc('npc-avon', 'Avon Timber & Joinery') },
  { id: 'plot-warehouse', assetId: 'warehouse', c: 5, r: 6, w: 3, d: 2, companyId: null, owner: null },
  { id: 'plot-pizza', assetId: 'pizza', c: 10, r: 6, w: 2, d: 2, companyId: 'co-mad-slices', owner: PLAYER_OWNER },
  { id: 'plot-cafe', assetId: 'cafe', c: 0, r: 11, w: 2, d: 2, companyId: 'co-harbour-bean', owner: PLAYER_OWNER },
  { id: 'plot-utility', assetId: 'utility', c: 5, r: 11, w: 2, d: 2, companyId: null, owner: { id: 'state-bristol-energy', name: 'Bristol Energy (state)', kind: 'state' } },
  { id: 'plot-terraces', assetId: 'terraces', c: 7, r: 11, w: 2, d: 2, companyId: null, owner: null },
];

const isRoad = (c: number, r: number) => (c === 4 || c === 9 || r === 4 || r === 9) && c < 13 && r < 15;
const isWater = (c: number) => c >= 13;

function buildPlots(): Plot[] {
  const conn = computeConnectivity(COLUMNS, ROWS, (c, r) => (isWater(c) ? 'water' : isRoad(c, r) ? 'road' : 'paving'));
  const plots: Plot[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLUMNS; c++) {
    const kind = isWater(c) ? 'water' : isRoad(c, r) ? 'road' : 'paving';
    const k = conn.at(c, r);
    // Only tiles that carry information beyond default paving are emitted: roads, water, quay edges.
    if (kind === 'paving' && k.quayMask === 0) continue;
    plots.push({ id: `tile-${c}-${r}`, column: c, row: r, width: 1, depth: 1, terrain: kind, roadMask: k.roadMask, quayMask: k.quayMask, companyId: null, assetId: null, owner: null, purchasable: false, price: null });
  }
  for (const b of blocks) {
    plots.push({ id: b.id, column: b.c, row: b.r, width: b.w, depth: b.d, terrain: 'paving', roadMask: 0, quayMask: 0, companyId: b.companyId, assetId: b.assetId, owner: b.owner, purchasable: false, price: null });
  }
  // Two empty, purchasable-in-future plots on the quay side of the pizza block (no price: purchasing is not implemented).
  return plots;
}

export const city: City = {
  id: CITY_ID, name: 'Bristol', plots: buildPlots(),
  demand: [
    { commodityId: 'flour', wantedUnits: 640, suppliedUnits: 410, referencePrice: ec(2, 40) },
    { commodityId: 'cheese', wantedUnits: 300, suppliedUnits: 280, referencePrice: ec(4) },
    { commodityId: 'timber', wantedUnits: 220, suppliedUnits: 240, referencePrice: ec(3, 10) },
    { commodityId: 'pizza', wantedUnits: 1_100, suppliedUnits: 760, referencePrice: ec(10) },
  ],
  events: [
    { id: 'ev-harbour-festival', title: 'Harbour Festival this weekend: café and pizza demand up', severity: 'info', startsAt: '2026-10-30T09:00:00.000Z', endsAt: '2026-11-01T22:00:00.000Z' },
    { id: 'ev-flour-shortage', title: 'Flour supply is 36% below demand in Bristol', severity: 'warning', startsAt: '2026-10-28T08:00:00.000Z', endsAt: null },
  ],
};


/** Cosmetic scenery that is NOT game state: lamps, trees, crane, boats, vans, people. Deterministic and static (walk cycles are outstanding art). */
const decor: DecorPlacement[] = [
  { assetId: 'crane', column: 11, row: 12 }, { assetId: 'crates', column: 12, row: 11 }, { assetId: 'crates', column: 12, row: 12 },
  { assetId: 'bollard', column: 12, row: 5 }, { assetId: 'bollard', column: 12, row: 8 }, { assetId: 'bollard', column: 12, row: 13 },
  { assetId: 'boat', column: 14, row: 3 }, { assetId: 'cargo-ship-sw', column: 15, row: 10 },
  { assetId: 'tree', column: 3, row: 0 }, { assetId: 'tree', column: 8, row: 0 }, { assetId: 'tree', column: 3, row: 5 }, { assetId: 'tree', column: 8, row: 5 },
  { assetId: 'tree', column: 3, row: 10 }, { assetId: 'tree', column: 12, row: 10 }, { assetId: 'tree', column: 3, row: 14 },
  { assetId: 'lamp', column: 3, row: 3 }, { assetId: 'lamp', column: 5, row: 5 }, { assetId: 'lamp', column: 8, row: 3 }, { assetId: 'lamp', column: 10, row: 5 }, { assetId: 'lamp', column: 12, row: 3 },
  { assetId: 'lamp', column: 3, row: 8 }, { assetId: 'lamp', column: 8, row: 8 }, { assetId: 'lamp', column: 12, row: 9 },
  { assetId: 'bench', column: 2, row: 10 }, { assetId: 'bench', column: 6, row: 10 }, { assetId: 'planter', column: 1, row: 10 }, { assetId: 'planter', column: 9, row: 11 },
  { assetId: 'parasol', column: 12, row: 7 }, { assetId: 'parasol', column: 0, row: 14 }, { assetId: 'planter', column: 12, row: 6 },
  { assetId: 'van-se', column: 4, row: 7 }, { assetId: 'van-sw', column: 9, row: 3 },
  { assetId: 'resident-sw', column: 4, row: 2 }, { assetId: 'worker-se', column: 9, row: 8 }, { assetId: 'courier-ne', column: 4, row: 12 },
  { assetId: 'resident-ne', column: 12, row: 4 }, { assetId: 'worker-sw', column: 9, row: 13 }, { assetId: 'resident-se', column: 7, row: 4 },
  { assetId: 'resident-nw', column: 2, row: 9 }, { assetId: 'courier-sw', column: 12, row: 9 },
];
export const mapMeta: MapMeta = { cityId: CITY_ID, columns: COLUMNS, rows: ROWS, decor };

/* ───────────────────────── Companies ───────────────────────── */
type Seed = {
  id: string; name: string; industry: Industry; owner: Owner; plotId: string; assetId: string; level: number;
  status?: Company['status']; priceEc: [number, number?]; min: number; max: number; employees: number; maxEmployees: number;
  quality: Company['quality']; revenue: number; expenses: number; customers: number; shareBps: number; valuation: number; cash: number;
  inventory: Company['inventory']; recipeId: string; repBps: number; capacity: number; planned: number; marketing: number; wage: number;
  profitDays: (number | null)[]; revenueDays: (number | null)[]; expenseDays: (number | null)[]; manage: boolean;
  upgrades?: Company['upgrades'];
};
function company(s: Seed): Company {
  const price = ec(s.priceEc[0], s.priceEc[1] ?? 0);
  return {
    id: s.id, name: s.name, cityId: CITY_ID, plotId: s.plotId, industry: s.industry, owner: s.owner, level: s.level, assetId: s.assetId,
    status: s.status ?? 'operating', revision: 7, valuation: ec(s.valuation), cash: ec(s.cash),
    dailyRevenue: ec(s.revenue), dailyExpenses: ec(s.expenses), dailyProfit: ec(s.revenue - s.expenses), customersToday: s.customers, marketShareBps: s.shareBps,
    price, minPrice: ec(s.min), maxPrice: ec(s.max), employees: s.employees, maxEmployees: s.maxEmployees, wagePerTick: ec(0, 40),
    quality: s.quality, reputationBps: s.repBps, capacityPerTick: s.capacity, plannedUnitsPerTick: s.planned, marketingPerTick: ec(0, s.marketing),
    inventory: s.inventory, recipeId: s.recipeId,
    ownership: [{ owner: s.owner, shares: 10_000, ownershipBps: 10_000 }],
    upgrades: s.upgrades ?? [{ id: `upg-${s.id}-2`, name: `Expand ${s.name}`, cost: ec(2_400), requirements: [`Company level ${s.level}`, 'Cash reserve of 500 EC'], available: s.manage && s.level < 3, resultingAssetId: s.assetId }],
    profitHistory: ecDays(s.profitDays), revenueHistory: ecDays(s.revenueDays), expenseHistory: ecDays(s.expenseDays),
    permissions: { manage: s.manage, buySupplies: s.manage, upgrade: s.manage },
  };
}

export const companies: Company[] = [
  company({ id: 'co-mad-slices', name: 'Mad Slices', industry: 'pizza', owner: PLAYER_OWNER, plotId: 'plot-pizza', assetId: 'pizza', level: 2, priceEc: [10], min: 6, max: 16, employees: 4, maxEmployees: 5, quality: 'standard', revenue: 1_280, expenses: 860, customers: 128, shareBps: 2_150, valuation: 21_400, cash: 6_320,
    inventory: [{ commodityId: 'flour', availableUnits: 24, reservedUnits: 6, capacityUnits: 60, estimatedHoursRemaining: 5 }, { commodityId: 'cheese', availableUnits: 18, reservedUnits: 0, capacityUnits: 40, estimatedHoursRemaining: 11 }, { commodityId: 'pizza', availableUnits: 52, reservedUnits: 0, capacityUnits: 120, estimatedHoursRemaining: null }],
    recipeId: 'recipe-pizza', repBps: 7_400, capacity: 20, planned: 16, marketing: 20, wage: 40,
    profitDays: [310, 355, 380, 345, 402, 395, 420], revenueDays: [1_040, 1_120, 1_190, 1_150, 1_260, 1_240, 1_280], expenseDays: [730, 765, 810, 805, 858, 845, 860], manage: true }),
  company({ id: 'co-harbour-bean', name: 'Harbour Bean', industry: 'cafe', owner: PLAYER_OWNER, plotId: 'plot-cafe', assetId: 'cafe', level: 1, priceEc: [3, 50], min: 2, max: 7, employees: 2, maxEmployees: 3, quality: 'basic', revenue: 540, expenses: 450, customers: 96, shareBps: 1_480, valuation: 6_800, cash: 1_940,
    inventory: [{ commodityId: 'milk', availableUnits: 9, reservedUnits: 0, capacityUnits: 30, estimatedHoursRemaining: 3 }, { commodityId: 'energy', availableUnits: 40, reservedUnits: 0, capacityUnits: 80, estimatedHoursRemaining: 20 }],
    recipeId: 'recipe-coffee', repBps: 5_900, capacity: 12, planned: 10, marketing: 0, wage: 40,
    profitDays: [70, 82, null, 95, 88, 91, 90], revenueDays: [510, 525, null, 560, 548, 551, 540], expenseDays: [440, 443, null, 465, 460, 460, 450], manage: true }),
  company({ id: 'co-brunel-mill', name: 'Brunel Milling', industry: 'mill', owner: npc('npc-brunel', 'Brunel Milling Ltd'), plotId: 'plot-mill', assetId: 'mill', level: 3, priceEc: [2, 40], min: 1, max: 5, employees: 9, maxEmployees: 10, quality: 'standard', revenue: 3_900, expenses: 3_120, customers: 41, shareBps: 5_200, valuation: 88_000, cash: 22_100,
    inventory: [{ commodityId: 'wheat', availableUnits: 210, reservedUnits: 40, capacityUnits: 400, estimatedHoursRemaining: 22 }, { commodityId: 'flour', availableUnits: 96, reservedUnits: 30, capacityUnits: 300, estimatedHoursRemaining: null }],
    recipeId: 'recipe-flour', repBps: 8_100, capacity: 60, planned: 55, marketing: 10, wage: 40,
    profitDays: [700, 720, 760, 740, 790, 775, 780], revenueDays: [3_700, 3_750, 3_800, 3_820, 3_900, 3_870, 3_900], expenseDays: [3_000, 3_030, 3_040, 3_080, 3_110, 3_095, 3_120], manage: false }),
  company({ id: 'co-severn-farm', name: 'Severn Valley Farm', industry: 'farm', owner: npc('npc-severn', 'Severn Valley Growers'), plotId: 'plot-farm', assetId: 'farm', level: 2, priceEc: [1, 10], min: 1, max: 3, employees: 6, maxEmployees: 8, quality: 'standard', revenue: 2_100, expenses: 1_700, customers: 12, shareBps: 6_100, valuation: 54_000, cash: 14_200,
    inventory: [{ commodityId: 'wheat', availableUnits: 640, reservedUnits: 120, capacityUnits: 900, estimatedHoursRemaining: null }, { commodityId: 'milk', availableUnits: 80, reservedUnits: 0, capacityUnits: 150, estimatedHoursRemaining: null }],
    recipeId: 'recipe-wheat', repBps: 7_000, capacity: 80, planned: 70, marketing: 0, wage: 40,
    profitDays: [380, 400, 410, 395, 405, 400, 400], revenueDays: [2_000, 2_050, 2_080, 2_060, 2_100, 2_090, 2_100], expenseDays: [1_620, 1_650, 1_670, 1_665, 1_695, 1_690, 1_700], manage: false }),
  company({ id: 'co-clifton-dairy', name: 'Clifton Creamery', industry: 'dairy', owner: npc('npc-clifton', 'Clifton Creamery Co-op'), plotId: 'plot-dairy', assetId: 'dairy', level: 2, priceEc: [4], min: 2, max: 8, employees: 5, maxEmployees: 7, quality: 'premium', revenue: 1_760, expenses: 1_390, customers: 33, shareBps: 4_600, valuation: 39_500, cash: 9_800,
    inventory: [{ commodityId: 'milk', availableUnits: 120, reservedUnits: 20, capacityUnits: 250, estimatedHoursRemaining: 14 }, { commodityId: 'cheese', availableUnits: 64, reservedUnits: 0, capacityUnits: 160, estimatedHoursRemaining: null }],
    recipeId: 'recipe-cheese', repBps: 8_600, capacity: 30, planned: 26, marketing: 15, wage: 40,
    profitDays: [330, 345, 360, 355, 372, 366, 370], revenueDays: [1_650, 1_690, 1_720, 1_715, 1_760, 1_740, 1_760], expenseDays: [1_320, 1_345, 1_360, 1_360, 1_388, 1_374, 1_390], manage: false }),
  company({ id: 'co-avon-timber', name: 'Avon Timber & Joinery', industry: 'timber', owner: npc('npc-avon', 'Avon Timber & Joinery'), plotId: 'plot-timber', assetId: 'timber', level: 1, status: 'paused', priceEc: [3, 10], min: 2, max: 6, employees: 0, maxEmployees: 4, quality: 'basic', revenue: 0, expenses: 120, customers: 0, shareBps: 1_800, valuation: 9_200, cash: 1_150,
    inventory: [{ commodityId: 'timber', availableUnits: 0, reservedUnits: 0, capacityUnits: 200, estimatedHoursRemaining: 0 }],
    recipeId: 'recipe-timber', repBps: 4_200, capacity: 25, planned: 0, marketing: 0, wage: 40,
    profitDays: [-20, -35, -90, -120, -120, -120, -120], revenueDays: [180, 90, 0, 0, 0, 0, 0], expenseDays: [200, 125, 90, 120, 120, 120, 120], manage: false }),
];

export const recipes: Recipe[] = [
  { id: 'recipe-wheat', output: { commodityId: 'wheat', units: 10 }, inputs: [], durationSeconds: 600, energyUnits: 1 },
  { id: 'recipe-flour', output: { commodityId: 'flour', units: 8 }, inputs: [{ commodityId: 'wheat', units: 10 }], durationSeconds: 600, energyUnits: 2 },
  { id: 'recipe-cheese', output: { commodityId: 'cheese', units: 2 }, inputs: [{ commodityId: 'milk', units: 10 }], durationSeconds: 900, energyUnits: 1 },
  { id: 'recipe-pizza', output: { commodityId: 'pizza', units: 4 }, inputs: [{ commodityId: 'flour', units: 2 }, { commodityId: 'cheese', units: 1 }], durationSeconds: 300, energyUnits: 1 },
  { id: 'recipe-coffee', output: { commodityId: 'cafe-drink', units: 6 }, inputs: [{ commodityId: 'milk', units: 3 }], durationSeconds: 180, energyUnits: 1 },
  { id: 'recipe-timber', output: { commodityId: 'timber', units: 5 }, inputs: [], durationSeconds: 1_200, energyUnits: 2 },
];
