import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { currentMods } from './economyState';
import { LedgerError, available, type TickCtx } from './ledger';
import { logEvent } from './stats';
import { chargeService } from './stateServices';

/**
 * Penny Ads. Campaigns are bought from the state advertising company, billed daily through the shared state-service interface and turned into REAL awareness
 * (the same `awareness_bps` that weights consumer choice). Nothing here is free reach:
 *   • every coin spent is a transfer to Penny Ads (its revenue), billed only on days the campaign is paid for;
 *   • effective spend = spend × the kind's efficiency × the day's reach modifier × (1 − competitive dilution);
 *   • awareness is a saturating function of effective spend (half the maximum at `awarenessHalfSpendMinor`), capped at `awarenessMaxBps`, and fades 5% a day.
 */
export type AdKind = 'local' | 'billboard' | 'digital' | 'industry' | 'contract';
export interface AdOffer { kind: AdKind; label: string; description: string; dailyMinor: number; efficiencyBps: number; minDays: number; maxDays: number; maxTier: number }
export const AD_MENU: AdOffer[] = [
  { kind: 'local', label: 'Local flyers & window posters', description: 'Cheap and close to home: modest reach, no commitment.', dailyMinor: 300, efficiencyBps: 10_000, minDays: 1, maxDays: 14, maxTier: 3 },
  { kind: 'billboard', label: 'Billboard', description: 'A physical billboard in your district: strong reach, shown on the city map while it runs.', dailyMinor: 900, efficiencyBps: 12_500, minDays: 3, maxDays: 30, maxTier: 3 },
  { kind: 'digital', label: 'Digital screens', description: 'Flexible and cheaper per day, but less effective per coin.', dailyMinor: 500, efficiencyBps: 9_000, minDays: 1, maxDays: 30, maxTier: 3 },
  { kind: 'industry', label: 'Industry-wide campaign', description: 'Promotes your whole industry: you get the full effect, every rival in the industry gets a quarter of it.', dailyMinor: 700, efficiencyBps: 10_000, minDays: 3, maxDays: 30, maxTier: 3 },
  { kind: 'contract', label: 'Contract campaign (14+ days)', description: 'A committed run of at least 14 days at a 15% discount.', dailyMinor: 600, efficiencyBps: 10_000, minDays: 14, maxDays: 60, maxTier: 3 },
];
export const MAX_ACTIVE_CAMPAIGNS = 3;
const CONTRACT_DISCOUNT_BPS = 8_500;
export const offerOf = (kind: string) => AD_MENU.find((o) => o.kind === kind);

/** Today's price of a campaign: menu price × tier × the advertising price modifier (events), discounted for contract campaigns. */
export function campaignDailyCost(db: Sql, kind: AdKind, tier: number): number {
  const o = offerOf(kind)!; const mods = currentMods(db);
  const base = Math.ceil((o.dailyMinor * tier * mods.adCostBps) / 10_000);
  return kind === 'contract' ? Math.ceil((base * CONTRACT_DISCOUNT_BPS) / 10_000) : base;
}

export interface AdCampaignRow { id: string; company_id: string; kind: AdKind; tier: number; target_industry: string | null; district_id: string | null; start_tick: number; end_tick: number; daily_cost_minor: number; total_paid_minor: number; reach_bps: number; status: 'active' | 'finished' | 'cancelled' }

export function startCampaign(db: Sql, ctx: TickCtx, _cfg: EngineConfig, input: { companyId: string; kind: AdKind; tier: number; days: number; key: string }): { id: string; dailyMinor: number } {
  const o = offerOf(input.kind); if (!o) throw new LedgerError('INVALID_AMOUNT', 'Unknown campaign type.');
  const dup = db.get<{ id: string; daily_cost_minor: number }>('SELECT id, daily_cost_minor FROM ad_campaigns WHERE idempotency_key = ?', input.key); if (dup) return { id: dup.id, dailyMinor: dup.daily_cost_minor };
  if (!Number.isInteger(input.tier) || input.tier < 1 || input.tier > o.maxTier) throw new LedgerError('INVALID_AMOUNT', `Tier must be 1–${o.maxTier}.`);
  if (!Number.isInteger(input.days) || input.days < o.minDays || input.days > o.maxDays) throw new LedgerError('INVALID_AMOUNT', `${o.label} runs for ${o.minDays}–${o.maxDays} days.`);
  const c = db.get<{ id: string; name: string; status: string; owner_kind: string; industry_id: string; district_id: string | null; treasury_account_id: string; retail_commodity_id: string | null }>('SELECT id, name, status, owner_kind, industry_id, district_id, treasury_account_id, retail_commodity_id FROM companies WHERE id = ?', input.companyId);
  if (!c || c.status !== 'operating') throw new LedgerError('FORBIDDEN', 'Only an operating company can advertise.');
  if (!c.retail_commodity_id) throw new LedgerError('FORBIDDEN', 'Advertising reaches shoppers: this business does not sell to the public.');
  const active = db.get<{ n: number }>("SELECT COUNT(*) n FROM ad_campaigns WHERE company_id = ? AND status = 'active'", c.id)!.n;
  if (active >= MAX_ACTIVE_CAMPAIGNS) throw new LedgerError('FORBIDDEN', `A company can run at most ${MAX_ACTIVE_CAMPAIGNS} campaigns at once.`);
  const daily = campaignDailyCost(db, input.kind, input.tier);
  if (available(db, c.treasury_account_id) < daily) throw new LedgerError('INSUFFICIENT_FUNDS', `The first day costs ${daily / 100} EC; the company has ${available(db, c.treasury_account_id) / 100} EC.`);
  const id = `ad-${ctx.tick}-${db.get<{ n: number }>('SELECT COUNT(*) n FROM ad_campaigns')!.n + 1}`;
  db.run("INSERT INTO ad_campaigns (id, company_id, kind, tier, target_industry, district_id, start_tick, end_tick, daily_cost_minor, reach_bps, status, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?)",
    id, c.id, input.kind, input.tier, input.kind === 'industry' ? c.industry_id : null, c.district_id, ctx.tick, ctx.tick + input.days, daily, o.efficiencyBps, input.key);
  logEvent(db, ctx.tick, 'ad_campaign_started', 'info', c.id, `${c.name} started a ${o.label.toLowerCase()} (tier ${input.tier}) for ${input.days} days at ${(daily / 100).toFixed(2)} EC a day`, { campaignId: id });
  return { id, dailyMinor: daily };
}

export function cancelCampaign(db: Sql, ctx: TickCtx, companyId: string, campaignId: string) {
  const r = db.run("UPDATE ad_campaigns SET status = 'cancelled', end_tick = ? WHERE id = ? AND company_id = ? AND status = 'active'", ctx.tick, campaignId, companyId);
  if (r.changes !== 1) throw new LedgerError('FORBIDDEN', 'No active campaign with that id.');
}

/**
 * Daily billing and effect, run in the expenses phase after wages, energy and rent. A campaign is charged in full or skipped for the day (no partial reach); two skipped days
 * in a row cancel it. Returns each company's effective campaign spend and the industry pools for sponsored industry campaigns.
 */
export function runCampaigns(db: Sql, ctx: TickCtx, cfg: EngineConfig, rivalSpend: (industry: string, excludeCompany: string) => number): { effective: Map<string, number>; spent: Map<string, number>; industryPool: Map<string, number>; ownPool: Map<string, number> } {
  const effective = new Map<string, number>(), spent = new Map<string, number>(), industryPool = new Map<string, number>(), ownPool = new Map<string, number>();
  const mods = currentMods(db);
  for (const k of db.all<AdCampaignRow>("SELECT * FROM ad_campaigns WHERE status = 'active' ORDER BY id")) {
    if (ctx.tick >= k.end_tick) { db.run("UPDATE ad_campaigns SET status = 'finished' WHERE id = ?", k.id); continue; }
    const c = db.get<{ name: string; status: string; treasury_account_id: string; industry_id: string }>('SELECT name, status, treasury_account_id, industry_id FROM companies WHERE id = ?', k.company_id)!;
    if (c.status !== 'operating') { db.run("UPDATE ad_campaigns SET status = 'cancelled', end_tick = ? WHERE id = ?", ctx.tick, k.id); continue; }
    const cost = campaignDailyCost(db, k.kind, k.tier);
    if (available(db, c.treasury_account_id) < cost) {
      const missed = db.get<{ n: number }>('SELECT COUNT(*) n FROM ad_daily WHERE campaign_id = ? AND tick > ? AND spend_minor = 0', k.id, ctx.tick - 2)!.n;
      db.run('INSERT INTO ad_daily (tick, campaign_id, company_id, spend_minor, effective_spend_minor, dilution_bps) VALUES (?,?,?,0,0,0)', ctx.tick, k.id, k.company_id);
      if (missed >= 1) { db.run("UPDATE ad_campaigns SET status = 'cancelled', end_tick = ? WHERE id = ?", ctx.tick, k.id); logEvent(db, ctx.tick, 'ad_campaign_cancelled', 'warning', k.company_id, `${c.name}'s ${k.kind} campaign was cancelled after two unpaid days`); }
      continue;
    }
    const r = chargeService(db, ctx, { service: 'advertising', payerAccount: c.treasury_account_id, payerCompanyId: k.company_id, amount: cost, ref: `campaign:${k.id}`, key: `t${ctx.tick}:ad:${k.id}`, memo: `advertising campaign ${k.kind} for ${c.name}` });
    if (r.charged < cost) continue;
    db.run('UPDATE ad_campaigns SET total_paid_minor = total_paid_minor + ?, daily_cost_minor = ? WHERE id = ?', r.charged, cost, k.id);
    // Competitive dilution: the more rivals in the same industry spend, the less of your message is heard (never more than half).
    const rival = rivalSpend(c.industry_id, k.company_id);
    const dilution = Math.min(5_000, Math.floor((5_000 * rival) / (rival + r.charged + cfg.awarenessHalfSpendMinor)));
    const eff = Math.floor((((r.charged * k.reach_bps) / 10_000) * mods.adReachBps / 10_000) * (10_000 - dilution) / 10_000);
    effective.set(k.company_id, (effective.get(k.company_id) ?? 0) + eff); spent.set(k.company_id, (spent.get(k.company_id) ?? 0) + r.charged);
    if (k.kind === 'industry') { industryPool.set(c.industry_id, (industryPool.get(c.industry_id) ?? 0) + Math.floor(eff / 4)); ownPool.set(k.company_id, (ownPool.get(k.company_id) ?? 0) + Math.floor(eff / 4)); }
    db.run('INSERT OR REPLACE INTO ad_daily (tick, campaign_id, company_id, spend_minor, effective_spend_minor, dilution_bps) VALUES (?,?,?,?,?,?)', ctx.tick, k.id, k.company_id, r.charged, eff, dilution);
  }
  return { effective, spent, industryPool, ownPool };
}

/** Awareness target for a given effective daily spend: saturating, hard ceiling, identical to the base formula so advertising can never exceed the cap. */
export const awarenessTarget = (cfg: EngineConfig, effectiveSpend: number) => effectiveSpend <= 0 ? 0 : Math.floor((cfg.awarenessMaxBps * effectiveSpend) / (effectiveSpend + cfg.awarenessHalfSpendMinor));

export interface AdReport { companyId: string; awarenessBps: number; maxAwarenessBps: number; baselineSpendMinor: number; campaigns: (AdCampaignRow & { spent7Minor: number; effective7Minor: number; avgDilutionBps: number })[]; spend7Minor: number; spend30Minor: number; effective7Minor: number; awarenessWithoutCampaignsBps: number; upliftBps: number; menu: (AdOffer & { priceByTier: number[] })[]; history: { tick: number; spend: number; effective: number }[] }
export function adReport(db: Sql, cfg: EngineConfig, companyId: string, tick: number): AdReport | null {
  const c = db.get<{ awareness_bps: number; marketing_minor: number }>('SELECT awareness_bps, marketing_minor FROM companies WHERE id = ?', companyId); if (!c) return null;
  const campaigns = db.all<AdCampaignRow>('SELECT * FROM ad_campaigns WHERE company_id = ? ORDER BY start_tick DESC, id DESC LIMIT 20', companyId).map((k) => {
    const d = db.get<{ s: number; e: number; d: number }>('SELECT COALESCE(SUM(spend_minor),0) s, COALESCE(SUM(effective_spend_minor),0) e, COALESCE(AVG(dilution_bps),0) d FROM ad_daily WHERE campaign_id = ? AND tick > ?', k.id, tick - 7)!;
    return { ...k, spent7Minor: d.s, effective7Minor: d.e, avgDilutionBps: Math.round(d.d) };
  });
  const sum = (from: number) => db.get<{ s: number; e: number }>('SELECT COALESCE(SUM(spend_minor),0) s, COALESCE(SUM(effective_spend_minor),0) e FROM ad_daily WHERE company_id = ? AND tick > ?', companyId, from)!;
  const w7 = sum(tick - 7), w30 = sum(tick - 30);
  const without = awarenessTarget(cfg, c.marketing_minor);
  return {
    companyId, awarenessBps: c.awareness_bps, maxAwarenessBps: cfg.awarenessMaxBps, baselineSpendMinor: c.marketing_minor, campaigns, spend7Minor: w7.s, spend30Minor: w30.s, effective7Minor: w7.e,
    awarenessWithoutCampaignsBps: Math.min(c.awareness_bps, without), upliftBps: Math.max(0, c.awareness_bps - Math.min(c.awareness_bps, without)),
    menu: AD_MENU.map((o) => ({ ...o, priceByTier: [1, 2, 3].filter((t) => t <= o.maxTier).map((t) => campaignDailyCost(db, o.kind, t)) })),
    history: db.all<{ tick: number; s: number; e: number }>('SELECT tick, SUM(spend_minor) s, SUM(effective_spend_minor) e FROM ad_daily WHERE company_id = ? AND tick > ? GROUP BY tick ORDER BY tick', companyId, tick - 30).map((r) => ({ tick: r.tick, spend: r.s, effective: r.e })),
  };
}
