import type { Sql } from '../db/sql';
import type { TickCtx } from './ledger';
import { logEvent } from './stats';
import { HOUSEHOLDS, PLAYER_ID, PLAYER_WALLET, TREASURY, companyAccount } from '../seed/bristol';

/** Fixed capitalisation of every company at founding. Whole shares only. */
export const FOUNDER_SHARES = 10_000;
/** Ownership thresholds (basis points of OUTSTANDING shares, i.e. issued minus the company's own treasury shares). Published rules, not hidden ones. */
export const THRESHOLDS = { significantBps: 1_000, substantialBps: 3_000, majorityBps: 5_000 } as const;
export type StakeClass = 'minority' | 'significant' | 'substantial' | 'majority';
export const classifyStake = (bps: number): StakeClass => (bps > THRESHOLDS.majorityBps ? 'majority' : bps >= THRESHOLDS.substantialBps ? 'substantial' : bps >= THRESHOLDS.significantBps ? 'significant' : 'minority');

export type InvestorKind = 'player' | 'npc' | 'household' | 'state' | 'company';
export interface Investor { id: string; kind: InvestorKind; name: string; account_id: string; company_id: string | null; strategy: string | null; decision_every: number; next_decision_tick: number }
export class ShareError extends Error {
  constructor(public readonly code: 'INVALID' | 'INSUFFICIENT_FUNDS' | 'INSUFFICIENT_SHARES' | 'NOT_FOUND' | 'FORBIDDEN' | 'NOT_TRADABLE' | 'CIRCULAR' | 'RULE', message: string) { super(message); this.name = 'ShareError'; }
}

export const companyInvestorId = (companyId: string) => `co:${companyId}`;

export function ensureInvestor(db: Sql, a: { id: string; kind: InvestorKind; name: string; account: string; companyId?: string | null; strategy?: string | null; every?: number; tick?: number }): Investor {
  db.run('INSERT OR IGNORE INTO investors (id, kind, name, account_id, company_id, strategy, decision_every, next_decision_tick, created_tick) VALUES (?,?,?,?,?,?,?,?,?)', a.id, a.kind, a.name, a.account, a.companyId ?? null, a.strategy ?? null, a.every ?? 3, (a.tick ?? 0) + 1, a.tick ?? 0);
  return db.get<Investor>('SELECT * FROM investors WHERE id = ?', a.id)!;
}
export const getInvestor = (db: Sql, id: string) => db.get<Investor>('SELECT * FROM investors WHERE id = ?', id);

/** The investor record for a company's own treasury: it holds treasury shares and can be a corporate shareholder. */
export function companyInvestor(db: Sql, companyId: string): Investor {
  const c = db.get<{ name: string }>('SELECT name FROM companies WHERE id = ?', companyId);
  if (!c) throw new ShareError('NOT_FOUND', `Unknown company ${companyId}`);
  return ensureInvestor(db, { id: companyInvestorId(companyId), kind: 'company', name: c.name, account: companyAccount(companyId), companyId });
}

/** Investor for an `owners` row (player, NPC shareholders, state). NPC owners all draw on the households' account; the player on the wallet. */
export function ownerInvestor(db: Sql, ownerId: string, kind: 'player' | 'npc' | 'state', name?: string, account?: string): Investor {
  const acct = account ?? (kind === 'player' ? PLAYER_WALLET : kind === 'state' ? TREASURY : HOUSEHOLDS);
  const nm = name ?? db.get<{ name: string }>('SELECT name FROM owners WHERE id = ?', ownerId)?.name ?? ownerId;
  return ensureInvestor(db, { id: ownerId, kind: kind === 'npc' ? 'household' : kind, name: nm, account: acct });
}

function makeTicker(db: Sql, name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
  const base = (words.length > 1 ? words.map((w) => w[0]).join('') + words[0]!.slice(1) : words[0] ?? 'COMP').toUpperCase().slice(0, 4).padEnd(3, 'X');
  for (let i = 0; ; i++) { const t = i === 0 ? base : `${base.slice(0, 3)}${i}`; if (!db.get('SELECT 1 FROM securities WHERE ticker = ?', t)) return t; }
}

export interface SecurityRow { company_id: string; ticker: string; status: 'unlisted' | 'open' | 'suspended' | 'delisted'; issued_shares: number; paid_in_minor: number; cancelled_shares: number; listed_tick: number | null; listing_price_minor: number | null; last_issue_tick: number | null; suspended_reason: string | null; suspended_tick: number | null; delisted_tick: number | null }
export const security = (db: Sql, companyId: string) => db.get<SecurityRow>('SELECT * FROM securities WHERE company_id = ?', companyId);

const journal = (db: Sql, ctx: TickCtx, company: string, kind: 'founder' | 'issue' | 'transfer' | 'cancel' | 'liquidation', from: string | null, to: string | null, qty: number, price: number, ref: string, ledgerTx: number | null = null, note: string | null = null) =>
  db.run('INSERT INTO share_journal (tick, company_id, kind, from_investor, to_investor, qty, price_minor, ref, ledger_tx_id, note) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.tick, company, kind, from, to, qty, price, ref, ledgerTx, note);

const addHolding = (db: Sql, company: string, investor: string, qty: number, cost: number) =>
  db.run('INSERT INTO share_holdings (company_id, investor_id, shares, reserved, cost_basis_minor) VALUES (?,?,?,0,?) ON CONFLICT(company_id, investor_id) DO UPDATE SET shares = shares + ?, cost_basis_minor = cost_basis_minor + ?', company, investor, qty, cost, qty, cost);

export const holding = (db: Sql, company: string, investor: string) => db.get<{ shares: number; reserved: number; cost_basis_minor: number }>('SELECT shares, reserved, cost_basis_minor FROM share_holdings WHERE company_id = ? AND investor_id = ?', company, investor) ?? { shares: 0, reserved: 0, cost_basis_minor: 0 };
export const freeShares = (db: Sql, company: string, investor: string) => { const h = holding(db, company, investor); return h.shares - h.reserved; };

/** Creates the cap table of a new company: a security record and the founder's shares. `paidIn` is what the founder really paid (recorded as issued share capital). */
export function registerCapital(db: Sql, ctx: TickCtx, companyId: string, founder: Investor, paidInMinor: number, note: string) {
  const c = db.get<{ name: string }>('SELECT name FROM companies WHERE id = ?', companyId)!;
  if (security(db, companyId)) throw new ShareError('RULE', `${companyId} already has share capital`);
  db.run("INSERT INTO securities (company_id, ticker, status, issued_shares, paid_in_minor) VALUES (?,?,'unlisted',?,?)", companyId, makeTicker(db, c.name), FOUNDER_SHARES, paidInMinor);
  addHolding(db, companyId, founder.id, FOUNDER_SHARES, paidInMinor);
  journal(db, ctx, companyId, 'founder', null, founder.id, FOUNDER_SHARES, 0, `founding:${companyId}`, null, note);
}

/** Moves whole, free shares between two holders and keeps the average-cost basis. Callers settle the coins; this only moves the shares and writes the journal. */
export function moveShares(db: Sql, ctx: TickCtx, company: string, from: string, to: string, qty: number, price: number, ref: string, opts: { fromReserved?: boolean; ledgerTx?: number | null } = {}): { costRemoved: number } {
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new ShareError('INVALID', 'Share quantity must be a positive integer');
  if (from === to) throw new ShareError('INVALID', 'Cannot transfer shares to the same holder');
  const h = holding(db, company, from);
  const free = opts.fromReserved ? h.reserved : h.shares - h.reserved;
  if (qty > free) throw new ShareError('INSUFFICIENT_SHARES', `${from} has ${free} ${opts.fromReserved ? 'reserved ' : 'free '}shares of ${company}, needs ${qty}`);
  const cost = qty === h.shares ? h.cost_basis_minor : Math.floor((h.cost_basis_minor * qty) / h.shares);
  db.run('UPDATE share_holdings SET shares = shares - ?, reserved = reserved - ?, cost_basis_minor = cost_basis_minor - ? WHERE company_id = ? AND investor_id = ?', qty, opts.fromReserved ? qty : 0, cost, company, from);
  db.run('DELETE FROM share_holdings WHERE company_id = ? AND investor_id = ? AND shares = 0', company, from);
  addHolding(db, company, to, qty, price * qty);
  journal(db, ctx, company, 'transfer', from, to, qty, price, ref, opts.ledgerTx ?? null);
  return { costRemoved: cost };
}

/** Creates new shares into `to`. The only way supply grows besides founding; the caller records where the money came from. */
export function issueShares(db: Sql, ctx: TickCtx, company: string, to: string, qty: number, price: number, ref: string, note: string) {
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new ShareError('INVALID', 'Issue quantity must be a positive integer');
  db.run('UPDATE securities SET issued_shares = issued_shares + ?, last_issue_tick = ? WHERE company_id = ?', qty, ctx.tick, company);
  addHolding(db, company, to, qty, 0);
  journal(db, ctx, company, 'issue', null, to, qty, price, ref, null, note);
}

/** Destroys shares held by `from` (cancelled treasury shares, or a liquidated company's equity). Recorded in the journal; issued shares fall accordingly. */
export function cancelShares(db: Sql, ctx: TickCtx, company: string, from: string, qty: number, ref: string, kind: 'cancel' | 'liquidation' = 'cancel', note: string | null = null) {
  const h = holding(db, company, from);
  if (qty > h.shares - h.reserved && !(kind === 'liquidation')) throw new ShareError('INSUFFICIENT_SHARES', `${from} has only ${h.shares - h.reserved} free shares to cancel`);
  const cost = qty === h.shares ? h.cost_basis_minor : Math.floor((h.cost_basis_minor * qty) / h.shares);
  db.run('UPDATE share_holdings SET shares = shares - ?, reserved = MAX(0, reserved - ?), cost_basis_minor = cost_basis_minor - ? WHERE company_id = ? AND investor_id = ?', qty, qty, cost, company, from);
  db.run('DELETE FROM share_holdings WHERE company_id = ? AND investor_id = ? AND shares = 0', company, from);
  db.run('UPDATE securities SET issued_shares = issued_shares - ?, cancelled_shares = cancelled_shares + ? WHERE company_id = ?', qty, qty, company);
  journal(db, ctx, company, kind, from, null, qty, 0, ref, null, note);
  return { cost };
}

export const treasuryShares = (db: Sql, company: string) => holding(db, company, companyInvestorId(company)).shares;
/** Shares in public hands: issued minus the company's own treasury shares. Percentages and dividends use this denominator. */
export const outstanding = (db: Sql, company: string) => (security(db, company)?.issued_shares ?? 0) - treasuryShares(db, company);
export const stakeBps = (db: Sql, company: string, investor: string) => { const o = outstanding(db, company); return o > 0 ? Math.floor((holding(db, company, investor).shares * 10_000) / o) : 0; };

export interface HolderRow { investorId: string; name: string; kind: InvestorKind; shares: number; reserved: number; stakeBps: number; stakeClass: StakeClass; mine: boolean }
export function capTable(db: Sql, company: string, viewer = PLAYER_ID): HolderRow[] {
  const o = outstanding(db, company);
  return db.all<{ investor_id: string; name: string; kind: InvestorKind; shares: number; reserved: number }>('SELECT h.investor_id, i.name, i.kind, h.shares, h.reserved FROM share_holdings h JOIN investors i ON i.id = h.investor_id WHERE h.company_id = ? AND h.shares > 0 ORDER BY h.shares DESC, h.investor_id', company)
    .filter((h) => h.investor_id !== companyInvestorId(company))
    .map((h) => { const bps = o > 0 ? Math.floor((h.shares * 10_000) / o) : 0; return { investorId: h.investor_id, name: h.name, kind: h.kind, shares: h.shares, reserved: h.reserved, stakeBps: bps, stakeClass: classifyStake(bps), mine: h.investor_id === viewer }; });
}

/** Whole-system check: shares held always equal shares issued, reservations never exceed holdings, no negatives. Returns problems (empty = consistent). */
export function checkShareIntegrity(db: Sql): string[] {
  const out: string[] = [];
  for (const r of db.all<{ company_id: string; issued: number; held: number }>('SELECT s.company_id, s.issued_shares issued, COALESCE((SELECT SUM(shares) FROM share_holdings h WHERE h.company_id = s.company_id),0) held FROM securities s')) if (r.issued !== r.held) out.push(`${r.company_id}: ${r.issued} shares issued but ${r.held} held`);
  for (const r of db.all<{ company_id: string; investor_id: string }>('SELECT company_id, investor_id FROM share_holdings WHERE reserved > shares OR shares < 0 OR reserved < 0')) out.push(`${r.company_id}/${r.investor_id}: invalid holding`);
  for (const r of db.all<{ company_id: string; created: number; cancelled: number; issued: number }>("SELECT s.company_id, COALESCE((SELECT SUM(qty) FROM share_journal j WHERE j.company_id = s.company_id AND j.kind IN ('founder','issue')),0) created, COALESCE((SELECT SUM(qty) FROM share_journal j WHERE j.company_id = s.company_id AND j.kind IN ('cancel','liquidation')),0) cancelled, s.issued_shares issued FROM securities s")) if (r.created - r.cancelled !== r.issued) out.push(`${r.company_id}: journal says ${r.created - r.cancelled} shares exist, register says ${r.issued}`);
  const reservedByOrders = db.all<{ company_id: string; investor_id: string; q: number }>("SELECT company_id, investor_id, SUM(qty_remaining) q FROM share_orders WHERE status = 'open' AND side = 'sell' GROUP BY company_id, investor_id");
  for (const r of reservedByOrders) { const h = holding(db, r.company_id, r.investor_id); if (h.reserved !== r.q) out.push(`${r.company_id}/${r.investor_id}: ${h.reserved} reserved but ${r.q} offered`); }
  const resv = db.get<{ s: number }>('SELECT COALESCE(SUM(reserved),0) s FROM share_holdings')!.s, offered = reservedByOrders.reduce((a, r) => a + r.q, 0);
  if (resv !== offered) out.push(`reserved shares ${resv} ≠ shares offered ${offered}`);
  return out;
}

// ───────── Control ─────────
/** Who ultimately owns an investor: a company holder is owned by whoever owns that company (walked up, bounded). Used to stop wash trading between "different" holders of one owner. */
export function ultimateOwnerKey(db: Sql, investorId: string, depth = 0): string {
  const inv = getInvestor(db, investorId); if (!inv || depth > 8) return investorId;
  if (inv.kind !== 'company' || !inv.company_id) return inv.id;
  const c = db.get<{ owner_kind: string; owner_id: string }>('SELECT owner_kind, owner_id FROM companies WHERE id = ?', inv.company_id);
  if (!c) return inv.id;
  return getInvestor(db, c.owner_id) ? ultimateOwnerKey(db, c.owner_id, depth + 1) : c.owner_id;
}

/** True if giving `holderCompany` shares in `target` would create a loop (target already, directly or indirectly, owns holderCompany). */
export function wouldCreateCycle(db: Sql, holderCompany: string, target: string): boolean {
  if (holderCompany === target) return true;
  const seen = new Set<string>([target]); const queue = [target];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const r of db.all<{ company_id: string }>('SELECT company_id FROM share_holdings WHERE investor_id = ? AND shares > 0 AND company_id <> ?', companyInvestorId(cur), cur)) {
      if (r.company_id === holderCompany) return true;
      if (!seen.has(r.company_id)) { seen.add(r.company_id); queue.push(r.company_id); }
    }
  }
  return false;
}

/** Maps a controlling investor to the owner record the rest of the engine uses. */
function ownerOf(db: Sql, inv: Investor): { kind: 'player' | 'npc' | 'state'; id: string } | null {
  if (inv.kind === 'player') return { kind: 'player', id: inv.id };
  if (inv.kind === 'state') return { kind: 'state', id: inv.id };
  if (inv.kind === 'household' || inv.kind === 'npc') return { kind: 'npc', id: inv.id };
  if (inv.kind === 'company' && inv.company_id) { const c = db.get<{ owner_kind: 'player' | 'npc' | 'state'; owner_id: string }>('SELECT owner_kind, owner_id FROM companies WHERE id = ?', inv.company_id); return c ? { kind: c.owner_kind, id: c.owner_id } : null; }
  return null;
}

/**
 * Control follows a majority: the holder of MORE than half the outstanding shares owns the company (published rule). Below a majority nothing changes,
 * so control only moves when someone actually crosses 50%. Control changes management rights only; assets stay in the company's own treasury.
 */
export function refreshControl(db: Sql, ctx: TickCtx, companyId: string): boolean {
  const c = db.get<{ owner_kind: string; owner_id: string; name: string }>('SELECT owner_kind, owner_id, name FROM companies WHERE id = ?', companyId);
  const sec = security(db, companyId);
  if (!c || !sec || sec.status === 'delisted') return false;
  const o = outstanding(db, companyId); if (o <= 0) return false;
  const top = db.get<{ investor_id: string; shares: number }>('SELECT investor_id, shares FROM share_holdings WHERE company_id = ? AND investor_id <> ? ORDER BY shares DESC, investor_id LIMIT 1', companyId, companyInvestorId(companyId));
  if (!top || top.shares * 10_000 <= THRESHOLDS.majorityBps * o) return false;
  const inv = getInvestor(db, top.investor_id)!; const next = ownerOf(db, inv);
  if (!next || (next.kind === c.owner_kind && next.id === c.owner_id)) return false;
  db.run('UPDATE companies SET owner_kind = ?, owner_id = ?, revision = revision + 1 WHERE id = ?', next.kind, next.id, companyId);
  const bps = Math.floor((top.shares * 10_000) / o);
  db.run('INSERT INTO control_log (tick, company_id, from_owner_kind, from_owner_id, to_owner_kind, to_owner_id, investor_id, shares, outstanding, stake_bps) VALUES (?,?,?,?,?,?,?,?,?,?)', ctx.tick, companyId, c.owner_kind, c.owner_id, next.kind, next.id, inv.id, top.shares, o, bps);
  const toName = db.get<{ name: string }>('SELECT name FROM owners WHERE id = ?', next.id)?.name ?? inv.name;
  logEvent(db, ctx.tick, 'control_change', 'info', companyId, `${toName} took control of ${c.name} with ${(bps / 100).toFixed(1)}% of its shares`, { investor: inv.id, stakeBps: bps, from: c.owner_id, to: next.id });
  return true;
}
