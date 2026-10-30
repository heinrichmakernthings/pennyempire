import type { Sql } from '../db/sql';
import { LedgerError, available, destroy, transfer, type TickCtx } from './ledger';
import { logEvent } from './stats';

/**
 * The Prestige economy. Items are bought with Empire Coins only (fictional); the price is BURNED as an explicit, labelled currency sink (luxury purchases are one of the defined
 * sinks), so no wealth is created by buying one. Every unit has an ownership record with a serial number; rare items have a hard supply cap enforced in the same transaction as
 * the purchase; a unit is owned by exactly one owner at a time, and a trade moves the ownership row and the coins in one atomic step. No item can be bought for, or converted
 * into, GBP_TEST or real money. Items without approved artwork are listed but cannot be bought.
 */
export type Category = 'vehicle' | 'property' | 'corporate' | 'luxury';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITY_POINTS: Record<Rarity, number> = { common: 10, uncommon: 25, rare: 60, epic: 140, legendary: 300 };
export const TRADE_FEE_BPS = 500;            // 5% of a collectible sale is burned (an explicit sink)
export const HOLD_TICKS_FOR_PRESTIGE = 7;    // an item earns prestige only after its owner has held it a week: moving it back and forth earns nothing
export const MAX_ASK_MULTIPLE = 50;          // an asking price may not exceed 50× the shop price (blocks absurd laundering of coins)

interface Def { id: string; category: Category; name: string; description: string; rarity: Rarity; price: number; asset: string | null; supply: number | null; tradeable: boolean; unique: boolean; placement: 'forecourt' | 'roof' | 'profile' | 'landmark' | 'quay'; reason?: string }
const NO_ART = 'Artwork not yet produced. It will be sold once the approved sprite exists.';
export const CATALOGUE: Def[] = [
  { id: 'veh-executive', category: 'vehicle', name: 'Executive car', description: 'A dark saloon for the forecourt of your headquarters.', rarity: 'uncommon', price: 250_000, asset: 'executive-car-sw', supply: null, tradeable: false, unique: true, placement: 'forecourt' },
  { id: 'veh-suv', category: 'vehicle', name: 'Luxury SUV', description: 'Leather, chrome and a very large grille.', rarity: 'uncommon', price: 400_000, asset: 'luxury-suv-sw', supply: null, tradeable: false, unique: true, placement: 'forecourt' },
  { id: 'veh-sports', category: 'vehicle', name: 'Sports car', description: 'Two seats, no practical purpose.', rarity: 'rare', price: 900_000, asset: 'sports-car-sw', supply: 200, tradeable: true, unique: true, placement: 'forecourt' },
  { id: 'veh-supercar', category: 'vehicle', name: 'Supercar (limited)', description: 'A numbered showpiece. Only 25 will ever exist.', rarity: 'epic', price: 2_500_000, asset: 'supercar-sw', supply: 25, tradeable: true, unique: true, placement: 'forecourt' },
  { id: 'veh-collector', category: 'vehicle', name: 'Rare collector’s vehicle', description: 'A museum-grade classic.', rarity: 'legendary', price: 6_000_000, asset: null, supply: 5, tradeable: true, unique: true, placement: 'forecourt', reason: NO_ART },
  { id: 'prop-penthouse', category: 'property', name: 'Penthouse', description: 'The top floor of a harbourside block.', rarity: 'rare', price: 3_000_000, asset: 'penthouse', supply: 60, tradeable: false, unique: true, placement: 'landmark' },
  { id: 'prop-townhouse', category: 'property', name: 'Luxury townhouse', description: 'Georgian frontage, modern everything else.', rarity: 'uncommon', price: 1_800_000, asset: 'luxury-townhouse', supply: null, tradeable: false, unique: true, placement: 'landmark' },
  { id: 'prop-mansion', category: 'property', name: 'Mansion', description: 'Gravel drive, many chimneys.', rarity: 'epic', price: 6_000_000, asset: 'mansion', supply: 20, tradeable: false, unique: true, placement: 'landmark' },
  { id: 'prop-waterfront', category: 'property', name: 'Waterfront property', description: 'Your own quay.', rarity: 'epic', price: 5_000_000, asset: null, supply: 15, tradeable: false, unique: true, placement: 'quay', reason: NO_ART },
  { id: 'prop-estate', category: 'property', name: 'Private estate', description: 'Acres of Somerset.', rarity: 'legendary', price: 12_000_000, asset: null, supply: 5, tradeable: false, unique: true, placement: 'landmark', reason: NO_ART },
  { id: 'corp-hq', category: 'corporate', name: 'Company headquarters', description: 'Your name on a landmark building.', rarity: 'rare', price: 5_000_000, asset: 'corporate-hq', supply: 100, tradeable: false, unique: true, placement: 'landmark' },
  { id: 'corp-tower', category: 'corporate', name: 'Corporate tower', description: 'A skyscraper for the skyline.', rarity: 'legendary', price: 20_000_000, asset: null, supply: 3, tradeable: false, unique: true, placement: 'landmark', reason: 'Needs an approved tall-building canvas (Phase 5 outstanding art).' },
  { id: 'corp-signage', category: 'corporate', name: 'Custom roof signage', description: 'A lit roof sign carrying your company name.', rarity: 'common', price: 150_000, asset: 'roof-billboard', supply: null, tradeable: false, unique: true, placement: 'roof' },
  { id: 'corp-offices', category: 'corporate', name: 'Premium offices', description: 'Panelled boardrooms.', rarity: 'rare', price: 2_200_000, asset: null, supply: null, tradeable: false, unique: true, placement: 'landmark', reason: NO_ART },
  { id: 'corp-monument', category: 'corporate', name: 'Prestige monument', description: 'A bronze that says you have arrived.', rarity: 'epic', price: 8_000_000, asset: 'prestige-monument', supply: 10, tradeable: false, unique: true, placement: 'landmark' },
  { id: 'lux-yacht', category: 'luxury', name: 'Luxury launch', description: 'Moored on the quay below your office.', rarity: 'epic', price: 1_500_000, asset: 'luxury-boat-sw', supply: 15, tradeable: true, unique: true, placement: 'quay' },
  { id: 'lux-superyacht', category: 'luxury', name: 'Superyacht', description: 'It does not fit in the harbour.', rarity: 'legendary', price: 15_000_000, asset: null, supply: 3, tradeable: true, unique: true, placement: 'quay', reason: 'Needs an approved large-vessel canvas (Phase 5 outstanding art).' },
  { id: 'lux-sculpture', category: 'luxury', name: 'Exclusive sculpture', description: 'A numbered collectible from a Bristol studio.', rarity: 'rare', price: 700_000, asset: 'exclusive-sculpture', supply: 50, tradeable: true, unique: true, placement: 'profile' },
  { id: 'lux-display', category: 'luxury', name: 'Limited shopfront display', description: 'A limited-edition decoration for your window.', rarity: 'uncommon', price: 120_000, asset: 'shopfront-display', supply: 200, tradeable: true, unique: false, placement: 'profile' },
  { id: 'lux-trophy', category: 'luxury', name: 'Profile trophy', description: 'A gold-plated cabinet piece.', rarity: 'uncommon', price: 90_000, asset: 'trophy-display', supply: null, tradeable: true, unique: false, placement: 'profile' },
];
export const MAX_PER_NON_UNIQUE = 5;

export function ensurePrestigeCatalogue(db: Sql) {
  for (const d of CATALOGUE) db.run(`INSERT INTO prestige_items (id, category, name, description, rarity, price_minor, currency, asset, supply_cap, tradeable, unique_per_owner, prestige_points, placement, available, unavailable_reason)
    VALUES (?,?,?,?,?,?, 'EC', ?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, price_minor = excluded.price_minor, asset = excluded.asset, supply_cap = excluded.supply_cap, tradeable = excluded.tradeable, available = excluded.available, unavailable_reason = excluded.unavailable_reason`,
    d.id, d.category, d.name, d.description, d.rarity, d.price, d.asset, d.supply, d.tradeable ? 1 : 0, d.unique ? 1 : 0, RARITY_POINTS[d.rarity], d.placement, d.asset ? 1 : 0, d.asset ? null : (d.reason ?? NO_ART));
}

interface ItemRow { id: string; category: Category; name: string; description: string; rarity: Rarity; price_minor: number; asset: string | null; supply_cap: number | null; minted: number; tradeable: number; unique_per_owner: number; prestige_points: number; placement: string; available: number; unavailable_reason: string | null }
export interface ItemView { id: string; category: Category; name: string; description: string; rarity: Rarity; priceMinor: number; currency: 'EC'; asset: string | null; supplyCap: number | null; minted: number; remaining: number | null; tradeable: boolean; unique: boolean; prestigePoints: number; placement: string; purchasable: boolean; unavailableReason: string | null; ownedCount: number }

const walletOf = (db: Sql, ownerId: string): string => { const r = db.get<{ w: string }>('SELECT wallet_account_id w FROM players WHERE id = ?', ownerId); if (!r) throw new LedgerError('FORBIDDEN', 'Unknown player'); return r.w; };
const nameOf = (db: Sql, ownerId: string) => db.get<{ n: string }>('SELECT display_name n FROM players WHERE id = ?', ownerId)?.n ?? ownerId;
const ownedCount = (db: Sql, owner: string, item: string) => db.get<{ n: number }>('SELECT COUNT(*) n FROM prestige_owned WHERE owner_id = ? AND item_id = ?', owner, item)!.n;

export function catalogue(db: Sql, ownerId: string): ItemView[] {
  return db.all<ItemRow>("SELECT * FROM prestige_items ORDER BY CASE category WHEN 'vehicle' THEN 0 WHEN 'property' THEN 1 WHEN 'corporate' THEN 2 ELSE 3 END, price_minor").map((i) => {
    const owned = ownedCount(db, ownerId, i.id); const remaining = i.supply_cap === null ? null : i.supply_cap - i.minted;
    const reason = !i.available ? i.unavailable_reason : remaining !== null && remaining <= 0 ? 'Sold out: the supply cap has been reached.' : i.unique_per_owner && owned > 0 ? 'You already own this.' : !i.unique_per_owner && owned >= MAX_PER_NON_UNIQUE ? `You can own at most ${MAX_PER_NON_UNIQUE}.` : null;
    return { id: i.id, category: i.category, name: i.name, description: i.description, rarity: i.rarity, priceMinor: i.price_minor, currency: 'EC', asset: i.asset, supplyCap: i.supply_cap, minted: i.minted, remaining, tradeable: i.tradeable === 1, unique: i.unique_per_owner === 1, prestigePoints: i.prestige_points, placement: i.placement, purchasable: reason === null, unavailableReason: reason, ownedCount: owned };
  });
}

/** Buys one unit. Atomic: the burn, the supply increment and the ownership row succeed or fail together; the key makes a retry a no-op. */
export function buyPrestige(db: Sql, ctx: TickCtx, a: { ownerId: string; itemId: string; key: string }): { ownedId: string; serial: number; duplicate: boolean } {
  return db.transaction(() => {
    const prior = db.get<{ owned_id: string }>("SELECT owned_id FROM prestige_history WHERE kind = 'purchase' AND ledger_tx_id IN (SELECT id FROM ledger_transactions WHERE idempotency_key = ?)", `prestige:${a.key}`);
    if (prior) return { ownedId: prior.owned_id, serial: Number(prior.owned_id.split('#')[1]), duplicate: true };
    const item = db.get<ItemRow>('SELECT * FROM prestige_items WHERE id = ?', a.itemId); if (!item) throw new LedgerError('FORBIDDEN', 'Unknown item');
    if (!item.available || !item.asset) throw new LedgerError('FORBIDDEN', item.unavailable_reason ?? 'This item is not for sale.');
    if (item.supply_cap !== null && item.minted >= item.supply_cap) throw new LedgerError('FORBIDDEN', 'Sold out: the supply cap has been reached.');
    const have = ownedCount(db, a.ownerId, item.id);
    if (item.unique_per_owner && have > 0) throw new LedgerError('FORBIDDEN', 'You already own this item.');
    if (!item.unique_per_owner && have >= MAX_PER_NON_UNIQUE) throw new LedgerError('FORBIDDEN', `You can own at most ${MAX_PER_NON_UNIQUE} of these.`);
    const wallet = walletOf(db, a.ownerId);
    if (available(db, wallet) < item.price_minor) throw new LedgerError('INSUFFICIENT_FUNDS', `This costs ${(item.price_minor / 100).toLocaleString('en-GB')} EC; you have ${(available(db, wallet) / 100).toLocaleString('en-GB')} EC.`);
    const tx = destroy(db, ctx, `prestige:${a.key}`, wallet, item.price_minor, `luxury purchase: ${item.name} (explicit sink)`);
    const serial = item.minted + 1; const id = `${item.id}#${serial}`;
    const r = db.run('UPDATE prestige_items SET minted = minted + 1 WHERE id = ? AND (supply_cap IS NULL OR minted < supply_cap)', item.id); if (r.changes !== 1) throw new LedgerError('FORBIDDEN', 'Sold out');
    db.run("INSERT INTO prestige_owned (id, item_id, owner_id, serial, acquired_tick, acquired_how, price_paid_minor) VALUES (?,?,?,?,?,'purchase',?)", id, item.id, a.ownerId, serial, ctx.tick, item.price_minor);
    db.run("INSERT INTO prestige_history (tick, owned_id, item_id, kind, from_owner, to_owner, price_minor, ledger_tx_id) VALUES (?,?,?,'purchase',NULL,?,?,?)", ctx.tick, id, item.id, a.ownerId, item.price_minor, tx.txId);
    logEvent(db, ctx.tick, 'prestige_purchase', 'info', null, `${nameOf(db, a.ownerId)} bought ${item.name} #${serial}${item.supply_cap ? ` of ${item.supply_cap}` : ''}`, { itemId: item.id, serial });
    return { ownedId: id, serial, duplicate: false };
  });
}

/* ───────── collectibles market ───────── */
export function listItem(db: Sql, ctx: TickCtx, a: { ownerId: string; ownedId: string; askMinor: number; key: string }): { listingId: string; duplicate: boolean } {
  return db.transaction(() => {
    const dup = db.get<{ id: string }>('SELECT id FROM prestige_listings WHERE idempotency_key = ?', a.key); if (dup) return { listingId: dup.id, duplicate: true };
    const o = db.get<{ owner_id: string; listed: number; item_id: string }>('SELECT owner_id, listed, item_id FROM prestige_owned WHERE id = ?', a.ownedId);
    if (!o || o.owner_id !== a.ownerId) throw new LedgerError('FORBIDDEN', 'You do not own that item.');
    const item = db.get<ItemRow>('SELECT * FROM prestige_items WHERE id = ?', o.item_id)!;
    if (!item.tradeable) throw new LedgerError('FORBIDDEN', `${item.name} cannot be traded: only eligible collectibles can be listed.`);
    if (o.listed) throw new LedgerError('FORBIDDEN', 'That item is already listed.');
    if (!Number.isSafeInteger(a.askMinor) || a.askMinor <= 0 || a.askMinor > item.price_minor * MAX_ASK_MULTIPLE) throw new LedgerError('INVALID_AMOUNT', `The asking price must be a positive whole number of at most ${MAX_ASK_MULTIPLE}× the shop price.`);
    const id = `lst-${db.get<{ n: number }>('SELECT COUNT(*) n FROM prestige_listings')!.n + 1}`;
    db.run("INSERT INTO prestige_listings (id, owned_id, seller_id, ask_minor, status, created_tick, idempotency_key) VALUES (?,?,?,?,'open',?,?)", id, a.ownedId, a.ownerId, a.askMinor, ctx.tick, a.key);
    db.run('UPDATE prestige_owned SET listed = 1 WHERE id = ?', a.ownedId);
    db.run("INSERT INTO prestige_history (tick, owned_id, item_id, kind, from_owner, price_minor) VALUES (?,?,?,'list',?,?)", ctx.tick, a.ownedId, o.item_id, a.ownerId, a.askMinor);
    return { listingId: id, duplicate: false };
  });
}
export function cancelListing(db: Sql, ctx: TickCtx, ownerId: string, listingId: string) {
  return db.transaction(() => {
    const l = db.get<{ owned_id: string; seller_id: string; status: string }>('SELECT owned_id, seller_id, status FROM prestige_listings WHERE id = ?', listingId);
    if (!l || l.seller_id !== ownerId) throw new LedgerError('FORBIDDEN', 'That is not your listing.');
    if (l.status === 'cancelled') return { duplicate: true };
    if (l.status !== 'open') throw new LedgerError('FORBIDDEN', `A ${l.status} listing cannot be cancelled.`);
    db.run("UPDATE prestige_listings SET status = 'cancelled', closed_tick = ? WHERE id = ?", ctx.tick, listingId); db.run('UPDATE prestige_owned SET listed = 0 WHERE id = ?', l.owned_id);
    db.run("INSERT INTO prestige_history (tick, owned_id, item_id, kind, from_owner) SELECT ?, id, item_id, 'unlist', owner_id FROM prestige_owned WHERE id = ?", ctx.tick, l.owned_id);
    return { duplicate: false };
  });
}
/** Atomic settlement: the coins (price − fee to the seller, the fee burned), the ownership row and the listing close together, or not at all. */
export function buyListing(db: Sql, ctx: TickCtx, a: { buyerId: string; listingId: string; key: string }): { ownedId: string; priceMinor: number; feeMinor: number; duplicate: boolean } {
  return db.transaction(() => {
    const l = db.get<{ owned_id: string; seller_id: string; ask_minor: number; status: string; buyer_id: string | null }>('SELECT owned_id, seller_id, ask_minor, status, buyer_id FROM prestige_listings WHERE id = ?', a.listingId);
    if (!l) throw new LedgerError('FORBIDDEN', 'No such listing.');
    if (l.status === 'sold' && l.buyer_id === a.buyerId && db.get('SELECT 1 FROM ledger_transactions WHERE idempotency_key = ?', `prestige:trade:${a.key}:pay`)) return { ownedId: l.owned_id, priceMinor: l.ask_minor, feeMinor: Math.floor((l.ask_minor * TRADE_FEE_BPS) / 10_000), duplicate: true };
    if (l.status !== 'open') throw new LedgerError('FORBIDDEN', 'That listing is no longer available.');
    if (l.seller_id === a.buyerId) throw new LedgerError('FORBIDDEN', 'You cannot buy your own listing.');
    const o = db.get<{ item_id: string; owner_id: string }>('SELECT item_id, owner_id FROM prestige_owned WHERE id = ?', l.owned_id)!;
    if (o.owner_id !== l.seller_id) throw new LedgerError('FORBIDDEN', 'The seller no longer owns that item.');   // can never happen while listed, but is checked: a unit must have exactly one owner
    const item = db.get<ItemRow>('SELECT * FROM prestige_items WHERE id = ?', o.item_id)!;
    const have = ownedCount(db, a.buyerId, item.id);
    if (item.unique_per_owner && have > 0) throw new LedgerError('FORBIDDEN', 'You already own this item.');
    if (!item.unique_per_owner && have >= MAX_PER_NON_UNIQUE) throw new LedgerError('FORBIDDEN', `You can own at most ${MAX_PER_NON_UNIQUE} of these.`);
    const buyer = walletOf(db, a.buyerId), seller = walletOf(db, l.seller_id);
    if (available(db, buyer) < l.ask_minor) throw new LedgerError('INSUFFICIENT_FUNDS', `This costs ${(l.ask_minor / 100).toLocaleString('en-GB')} EC.`);
    const fee = Math.floor((l.ask_minor * TRADE_FEE_BPS) / 10_000);
    const pay = transfer(db, ctx, `prestige:trade:${a.key}:pay`, buyer, seller, l.ask_minor - fee, 'transfer', `collectible sale ${l.owned_id}`);
    if (fee > 0) destroy(db, ctx, `prestige:trade:${a.key}:fee`, buyer, fee, `collectible trading fee ${l.owned_id} (explicit sink)`, 'sink_fee');
    const moved = db.run("UPDATE prestige_owned SET owner_id = ?, acquired_tick = ?, acquired_how = 'trade', listed = 0, price_paid_minor = ? WHERE id = ? AND owner_id = ? AND listed = 1", a.buyerId, ctx.tick, l.ask_minor, l.owned_id, l.seller_id);
    if (moved.changes !== 1) throw new LedgerError('FORBIDDEN', 'The item could not be transferred (already sold).');
    db.run("UPDATE prestige_listings SET status = 'sold', buyer_id = ?, closed_tick = ? WHERE id = ? AND status = 'open'", a.buyerId, ctx.tick, a.listingId);
    db.run("INSERT INTO prestige_history (tick, owned_id, item_id, kind, from_owner, to_owner, price_minor, fee_minor, ledger_tx_id) VALUES (?,?,?,'trade',?,?,?,?,?)", ctx.tick, l.owned_id, o.item_id, l.seller_id, a.buyerId, l.ask_minor, fee, pay.txId);
    return { ownedId: l.owned_id, priceMinor: l.ask_minor, feeMinor: fee, duplicate: false };
  });
}
export function openListings(db: Sql, viewerId: string) {
  return db.all<{ id: string; owned_id: string; seller_id: string; ask_minor: number; created_tick: number; item_id: string; name: string; rarity: string; asset: string | null; serial: number; price_minor: number }>("SELECT l.id, l.owned_id, l.seller_id, l.ask_minor, l.created_tick, o.item_id, i.name, i.rarity, i.asset, o.serial, i.price_minor FROM prestige_listings l JOIN prestige_owned o ON o.id = l.owned_id JOIN prestige_items i ON i.id = o.item_id WHERE l.status = 'open' ORDER BY l.ask_minor")
    .map((l) => ({ id: l.id, ownedId: l.owned_id, itemId: l.item_id, name: l.name, rarity: l.rarity, asset: l.asset, serial: l.serial, askMinor: l.ask_minor, shopPriceMinor: l.price_minor, sellerId: l.seller_id, sellerName: nameOf(db, l.seller_id), mine: l.seller_id === viewerId, createdTick: l.created_tick, feeBps: TRADE_FEE_BPS }));
}
export function tradeHistory(db: Sql, limit = 30) {
  return db.all<{ tick: number; owned_id: string; kind: string; from_owner: string | null; to_owner: string | null; price_minor: number; fee_minor: number; name: string }>("SELECT h.tick, h.owned_id, h.kind, h.from_owner, h.to_owner, h.price_minor, h.fee_minor, i.name FROM prestige_history h JOIN prestige_items i ON i.id = h.item_id WHERE h.kind IN ('trade','purchase') ORDER BY h.id DESC LIMIT ?", limit)
    .map((h) => ({ tick: h.tick, ownedId: h.owned_id, kind: h.kind, name: h.name, from: h.from_owner ? nameOf(db, h.from_owner) : 'Shop', to: h.to_owner ? nameOf(db, h.to_owner) : '', priceMinor: h.price_minor, feeMinor: h.fee_minor }));
}
export function inventory(db: Sql, ownerId: string, tick: number) {
  return db.all<{ id: string; item_id: string; serial: number; acquired_tick: number; acquired_how: string; listed: number; name: string; category: string; rarity: string; asset: string | null; placement: string; points: number; supply_cap: number | null; tradeable: number }>('SELECT o.id, o.item_id, o.serial, o.acquired_tick, o.acquired_how, o.listed, i.name, i.category, i.rarity, i.asset, i.placement, i.prestige_points points, i.supply_cap, i.tradeable FROM prestige_owned o JOIN prestige_items i ON i.id = o.item_id WHERE o.owner_id = ? ORDER BY i.price_minor DESC, o.serial', ownerId)
    .map((o) => ({ id: o.id, itemId: o.item_id, serial: o.serial, name: o.name, category: o.category, rarity: o.rarity, asset: o.asset, placement: o.placement, acquiredTick: o.acquired_tick, acquiredHow: o.acquired_how, listed: o.listed === 1, supplyCap: o.supply_cap, tradeable: o.tradeable === 1, earningPrestige: tick - o.acquired_tick >= HOLD_TICKS_FOR_PRESTIGE, prestigePoints: o.points }));
}

/* ───────── prestige score (distinct from net worth) ───────── */
export interface PrestigeBreakdown { items: number; collections: number; businesses: number; titles: number; total: number }
export function prestigeOf(db: Sql, ownerId: string, tick: number): PrestigeBreakdown {
  const items = db.get<{ s: number }>('SELECT COALESCE(SUM(i.prestige_points),0) s FROM prestige_owned o JOIN prestige_items i ON i.id = o.item_id WHERE o.owner_id = ? AND ? - o.acquired_tick >= ?', ownerId, tick, HOLD_TICKS_FOR_PRESTIGE)!.s;
  const cats = db.get<{ n: number }>('SELECT COUNT(DISTINCT i.category) n FROM prestige_owned o JOIN prestige_items i ON i.id = o.item_id WHERE o.owner_id = ? AND ? - o.acquired_tick >= ?', ownerId, tick, HOLD_TICKS_FOR_PRESTIGE)!.n;
  const companies = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_id = ? AND status = 'operating' AND created_tick <= ?", ownerId, tick - HOLD_TICKS_FOR_PRESTIGE)!.n;
  const titles = db.get<{ n: number }>('SELECT COUNT(*) n FROM titles t JOIN companies c ON c.id = t.holder_company_id WHERE c.owner_id = ?', ownerId)!.n;
  const b = { items, collections: cats >= 4 ? 250 : cats === 3 ? 100 : 0, businesses: Math.min(5, companies) * 40, titles: Math.min(10, titles) * 25 };
  return { ...b, total: b.items + b.collections + b.businesses + b.titles };
}
export function recordPrestige(db: Sql, tick: number) {
  for (const o of db.all<{ id: string }>("SELECT DISTINCT owner_id id FROM companies WHERE owner_kind IN ('player','npc') UNION SELECT DISTINCT owner_id FROM prestige_owned")) {
    const b = prestigeOf(db, o.id, tick); db.run('INSERT OR REPLACE INTO prestige_scores (tick, owner_id, score, breakdown_json) VALUES (?,?,?,?)', tick, o.id, b.total, JSON.stringify(b));
  }
}
export function leaderboard(db: Sql, viewerId: string, scope: 'city' | 'global') {
  const t = db.get<{ t: number }>('SELECT MAX(tick) t FROM prestige_scores')?.t; if (t === null || t === undefined) return { tick: 0, scope, rows: [] };
  const rows = db.all<{ owner_id: string; score: number; breakdown_json: string }>(`SELECT owner_id, score, breakdown_json FROM prestige_scores WHERE tick = ? AND score > 0 ${scope === 'city' ? "AND owner_id IN (SELECT owner_id FROM companies WHERE city_id = 'city-bristol')" : ''} ORDER BY score DESC, owner_id LIMIT 25`, t);
  return { tick: t, scope, rows: rows.map((r, i) => ({ rank: i + 1, ownerId: r.owner_id, name: nameOf(db, r.owner_id) === r.owner_id ? (db.get<{ n: string }>('SELECT name n FROM owners WHERE id = ?', r.owner_id)?.n ?? r.owner_id) : nameOf(db, r.owner_id), score: r.score, breakdown: JSON.parse(r.breakdown_json) as PrestigeBreakdown, mine: r.owner_id === viewerId })) };
}
/** What the city map draws for an owner's companies: only items earning their place (owned, placed on a forecourt, quay or roof). */
export function displayItems(db: Sql, ownerId: string) {
  return db.all<{ asset: string; placement: string; id: string }>("SELECT i.asset, i.placement, o.id FROM prestige_owned o JOIN prestige_items i ON i.id = o.item_id WHERE o.owner_id = ? AND i.asset IS NOT NULL AND i.placement IN ('forecourt','quay','roof','landmark') ORDER BY i.price_minor DESC LIMIT 6", ownerId);
}
