import type { Commodity, Holding, Listing, Order, Owner, PrestigeItem, TestWallet, Trade } from '@/contracts/game-state';
import { CITY_ID, PLAYER_OWNER } from './bristol';
import { ec, ecDays, gbp, FIXTURE_NOW } from './util';

/* ILLUSTRATIVE DATA — not authoritative economic state. */

const npc = (id: string, name: string): Owner => ({ id, name, kind: 'npc' });
const brunel = npc('npc-brunel', 'Brunel Milling Ltd');
const severn = npc('npc-severn', 'Severn Valley Growers');
const clifton = npc('npc-clifton', 'Clifton Creamery Co-op');
const avon = npc('npc-avon', 'Avon Timber & Joinery');

export const commodities: Commodity[] = [
  { id: 'wheat', name: 'Wheat', unitLabel: 'sack', iconAssetId: 'wheat', referencePrice: ec(1, 10), changeBps: -120, localSupplyUnits: 1_640, localDemandUnits: 1_380, history: ecDays([1.2, 1.18, 1.15, 1.16, 1.12, 1.11, 1.1]) },
  { id: 'flour', name: 'Flour', unitLabel: 'sack', iconAssetId: 'flour', referencePrice: ec(2, 40), changeBps: 410, localSupplyUnits: 410, localDemandUnits: 640, history: ecDays([2.05, 2.1, 2.18, 2.2, 2.3, 2.31, 2.4]) },
  { id: 'milk', name: 'Milk', unitLabel: 'crate', iconAssetId: 'milk', referencePrice: ec(1, 80), changeBps: 0, localSupplyUnits: 560, localDemandUnits: 540, history: ecDays([1.8, 1.8, 1.82, 1.8, 1.79, 1.8, 1.8]) },
  { id: 'cheese', name: 'Cheese', unitLabel: 'wheel', iconAssetId: 'cheese', referencePrice: ec(4), changeBps: 150, localSupplyUnits: 280, localDemandUnits: 300, history: ecDays([3.8, 3.85, 3.9, null, 3.92, 3.95, 4.0]) },
  { id: 'timber', name: 'Timber', unitLabel: 'stack', iconAssetId: 'timber-item', referencePrice: ec(3, 10), changeBps: -260, localSupplyUnits: 240, localDemandUnits: 220, history: ecDays([3.4, 3.35, 3.3, 3.28, 3.2, 3.15, 3.1]) },
  { id: 'pizza', name: 'Pizza', unitLabel: 'box', iconAssetId: 'pizza-item', referencePrice: ec(10), changeBps: 80, localSupplyUnits: 760, localDemandUnits: 1_100, history: ecDays([9.5, 9.6, 9.8, 9.9, 9.8, 9.95, 10]) },
  { id: 'energy', name: 'Energy', unitLabel: 'MWh', iconAssetId: 'energy', referencePrice: ec(0, 90), changeBps: 0, localSupplyUnits: 5_000, localDemandUnits: 3_100, history: ecDays([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]) },
];

const order = (id: string, commodityId: string, supplier: Owner, side: Order['side'], priceMinor: number, remaining: number, original = remaining, status: Order['status'] = 'open', companyId = 'co-brunel-mill'): Order => ({
  id, commodityId, cityId: CITY_ID, companyId, supplier, side, pricePerUnit: { currency: 'EC', minor: priceMinor }, originalUnits: original, remainingUnits: remaining, status, createdAt: FIXTURE_NOW,
});

/** Market book: sell orders (supply) the player can buy from, plus the player's own orders. */
export const orders: Order[] = [
  order('ord-f1', 'flour', brunel, 'sell', 235, 40), order('ord-f2', 'flour', brunel, 'sell', 240, 120), order('ord-f3', 'flour', brunel, 'sell', 252, 60),
  order('ord-w1', 'wheat', severn, 'sell', 108, 300, 300, 'open', 'co-severn-farm'), order('ord-w2', 'wheat', severn, 'sell', 112, 340, 340, 'open', 'co-severn-farm'),
  order('ord-c1', 'cheese', clifton, 'sell', 395, 30, 30, 'open', 'co-clifton-dairy'), order('ord-c2', 'cheese', clifton, 'sell', 405, 34, 34, 'open', 'co-clifton-dairy'),
  order('ord-m1', 'milk', severn, 'sell', 178, 80, 80, 'open', 'co-severn-farm'), order('ord-m2', 'milk', clifton, 'sell', 182, 40, 40, 'open', 'co-clifton-dairy'),
  order('ord-t1', 'timber', avon, 'sell', 305, 0, 60, 'filled', 'co-avon-timber'),
  order('ord-p1', 'pizza', PLAYER_OWNER, 'sell', 1000, 52, 52, 'open', 'co-mad-slices'),
];
export const ownOrders: Order[] = [
  order('own-1', 'flour', PLAYER_OWNER, 'buy', 238, 15, 40, 'partial', 'co-mad-slices'),
  order('own-2', 'cheese', PLAYER_OWNER, 'buy', 390, 12, 12, 'open', 'co-mad-slices'),
];
export const trades: Trade[] = [
  { id: 'trd-1', orderId: 'own-1', commodityId: 'flour', quantity: 25, pricePerUnit: ec(2, 38), fee: ec(1, 19), settledAt: '2026-10-28T14:05:00.000Z' },
  { id: 'trd-2', orderId: 'ord-c1', commodityId: 'cheese', quantity: 10, pricePerUnit: ec(3, 95), fee: ec(0, 79), settledAt: '2026-10-28T11:40:00.000Z' },
  { id: 'trd-3', orderId: 'ord-m1', commodityId: 'milk', quantity: 12, pricePerUnit: ec(1, 78), fee: ec(0, 43), settledAt: '2026-10-27T16:12:00.000Z' },
];
/** Illustrative trading-fee schedule (bps) used by the fixture quote engine only. */
export const FIXTURE_COMMODITY_FEE_BPS = 200;
export const FIXTURE_SHARE_FEE_BPS = 100;

/* Stocks: all companies are fictional. */
const listing = (id: string, companyId: string, companyName: string, ownerKind: Listing['ownerKind'], priceMinor: number, changeBps: number, shares: number, divMinor: number, revenue: number, profit: number, hist: (number | null)[]): Listing => ({
  id, companyId, companyName, ownerKind, price: { currency: 'EC', minor: priceMinor }, changeBps, outstandingShares: shares,
  marketCap: { currency: 'EC', minor: priceMinor * shares }, dividendPerShare: { currency: 'EC', minor: divMinor }, nextDividendAt: '2026-11-01T12:00:00.000Z',
  revenue: ec(revenue), profit: ec(profit), history: ecDays(hist), tradable: true,
});
export const listings: Listing[] = [
  listing('lst-mill', 'co-brunel-mill', 'Brunel Milling', 'npc', 880, 210, 100_000, 12, 3_900, 780, [8.2, 8.3, 8.4, 8.55, 8.6, 8.75, 8.8]),
  listing('lst-dairy', 'co-clifton-dairy', 'Clifton Creamery', 'npc', 395, 95, 100_000, 8, 1_760, 370, [3.7, 3.72, 3.8, 3.78, 3.85, 3.9, 3.95]),
  listing('lst-farm', 'co-severn-farm', 'Severn Valley Farm', 'npc', 540, -60, 100_000, 6, 2_100, 400, [5.5, 5.5, 5.45, 5.48, 5.42, 5.43, 5.4]),
  listing('lst-timber', 'co-avon-timber', 'Avon Timber & Joinery', 'npc', 92, -1_450, 100_000, 0, 0, -120, [1.4, 1.35, 1.2, 1.05, 1.0, 0.96, 0.92]),
  { ...listing('lst-energy', 'co-bristol-energy', 'Bristol Energy (state enterprise)', 'state', 1_200, 20, 500_000, 25, 9_800, 2_100, [11.9, 11.9, 11.95, 12, 12, 12, 12]), tradable: false },
];
export const holdings: Holding[] = [
  { listingId: 'lst-mill', shares: 1_200, reservedShares: 0, costBasis: ec(9_840), value: ec(10_560), unrealizedPnl: ec(720), dividendsReceived: ec(96) },
  { listingId: 'lst-dairy', shares: 3_000, reservedShares: 500, costBasis: ec(11_100), value: ec(11_850), unrealizedPnl: ec(750), dividendsReceived: ec(192) },
  { listingId: 'lst-farm', shares: 2_000, reservedShares: 0, costBasis: ec(10_900), value: ec(10_800), unrealizedPnl: ec(-100), dividendsReceived: ec(96) },
  { listingId: 'lst-timber', shares: 5_000, reservedShares: 0, costBasis: ec(5_200), value: ec(4_600), unrealizedPnl: ec(-600), dividendsReceived: ec(0) },
];

/* Prestige. Items whose art does not exist yet are unavailable with a reason, never faux-purchasable. */
export const prestigeItems: PrestigeItem[] = [
  { id: 'pre-lamp', name: 'Heritage gas lamp', description: 'A cast-iron lamp for your company frontage. Cosmetic only.', assetId: 'lamp', price: ec(250), owned: false, stockRemaining: null, placement: 'plot', effect: null, purchasable: true, unavailableReason: null },
  { id: 'pre-planter', name: 'Harbourside planter', description: 'Seasonal planting for your plot. Cosmetic only.', assetId: 'planter', price: ec(180), owned: true, stockRemaining: null, placement: 'plot', effect: null, purchasable: false, unavailableReason: 'Already owned.' },
  { id: 'pre-parasol', name: 'Striped parasol', description: 'Boosts customer footfall slightly during summer events.', assetId: 'parasol', price: ec(900), owned: false, stockRemaining: 40, placement: 'plot', effect: { description: '+2% customers at this company', modifierBps: 200, durationSeconds: 604_800 }, purchasable: true, unavailableReason: null },
  { id: 'pre-supercar', name: 'Supercar (limited)', description: 'A showpiece for your profile and HQ forecourt.', assetId: null, price: ec(250_000), owned: false, stockRemaining: 5, placement: 'plot', effect: null, purchasable: false, unavailableReason: 'Artwork not yet produced.' },
  { id: 'pre-hq', name: 'Branded headquarters', description: 'Your company name on a landmark building.', assetId: null, price: ec(1_200_000), owned: false, stockRemaining: null, placement: 'plot', effect: null, purchasable: false, unavailableReason: 'Artwork not yet produced.' },
  { id: 'pre-yacht', name: 'Harbour yacht', description: 'Moored on the quay beside your company.', assetId: null, price: ec(800_000), owned: false, stockRemaining: 3, placement: 'plot', effect: null, purchasable: false, unavailableReason: 'Artwork not yet produced.' },
];

export const testWallet: TestWallet = {
  id: 'wallet-test-demo', mode: 'SIMULATED', currency: 'GBP_TEST', balanceMinor: 1_250, reservedMinor: 0, minimumWithdrawalMinor: 500, canTestDeposit: true, canTestWithdraw: true,
  transactions: [
    { id: 'wtx-1', reference: 'SIM-0001', kind: 'test_deposit', amount: gbp(500), direction: 'credit', status: 'settled', createdAt: '2026-10-25T10:00:00.000Z', settledAt: '2026-10-25T10:00:02.000Z' },
    { id: 'wtx-2', reference: 'SIM-0002', kind: 'reward', amount: gbp(250), direction: 'credit', status: 'settled', createdAt: '2026-10-26T09:30:00.000Z', settledAt: '2026-10-26T09:30:00.000Z' },
    { id: 'wtx-3', reference: 'SIM-0003', kind: 'test_deposit', amount: gbp(500), direction: 'credit', status: 'settled', createdAt: '2026-10-27T18:10:00.000Z', settledAt: '2026-10-27T18:10:01.000Z' },
    { id: 'wtx-4', reference: 'SIM-0004', kind: 'test_withdrawal', amount: gbp(500), direction: 'debit', status: 'failed', createdAt: '2026-10-27T18:20:00.000Z', settledAt: null },
  ],
  rewards: [{ id: 'rw-1', description: 'Welcome reward (simulated)', amount: gbp(250), awardedAt: '2026-10-26T09:30:00.000Z' }],
};
