import type { Sql } from '../db/sql';
import { gameDate, loadConfig } from '../engine/config';
import { BOARDS } from '../engine/standings';
import { rankings } from '../engine/insights';
import { PLAYER_ID } from '../seed/bristol';
import type { Article, Board, CompetitorProfile, Standings } from '../../src/shared/living';

const lastTick = (db: Sql) => db.get<{ t: number }>('SELECT last_tick t FROM engine_state WHERE id = 1')!.t;
type CoRow = { id: string; name: string; industry_id: string; owner_kind: 'player' | 'npc'; owner_id: string };

export function standings(db: Sql): Standings {
  const cfg = loadConfig(db), t = lastTick(db);
  const bt = db.get<{ t: number | null }>('SELECT MAX(tick) t FROM leaderboard')!.t;
  const boards: Board[] = [];
  if (bt !== null) {
    const keys = db.all<{ board: string; scope: string }>('SELECT DISTINCT board, scope FROM leaderboard WHERE tick = ? ORDER BY board, scope', bt);
    for (const k of keys) {
      const rows = db.all<{ rank: number; company_id: string; value: number }>('SELECT rank, company_id, value FROM leaderboard WHERE tick = ? AND board = ? AND scope = ? ORDER BY rank', bt, k.board, k.scope).map((r) => {
        const c = db.get<CoRow>('SELECT id, name, industry_id, owner_kind, owner_id FROM companies WHERE id = ?', r.company_id)!;
        return { rank: r.rank, companyId: c.id, name: c.name, industry: c.industry_id, ownerKind: c.owner_kind, value: r.value, mine: c.owner_kind === 'player' && c.owner_id === PLAYER_ID };
      });
      const scopeLabel = k.scope === 'city' ? '' : ` — ${db.get<{ label: string }>('SELECT label FROM industry_specs WHERE industry_id = ?', k.scope)?.label ?? k.scope}`;
      boards.push({ key: k.board, label: (BOARDS[k.board] ?? k.board) + scopeLabel, scope: k.scope, unit: k.board === 'share' || k.board === 'growth' || k.board === 'reputation' ? 'bps' : 'minor', rows });
    }
  }
  const titles = db.all<{ title_key: string; label: string; holder_company_id: string; since_tick: number; value: number }>('SELECT * FROM titles ORDER BY title_key').map((r) => {
    const c = db.get<CoRow>('SELECT id, name, industry_id, owner_kind, owner_id FROM companies WHERE id = ?', r.holder_company_id)!;
    return { key: r.title_key, label: r.label, holderId: c.id, holderName: c.name, ownerKind: c.owner_kind, sinceTick: r.since_tick, value: r.value };
  });
  const recentChanges = db.all<{ tick: number; label: string; old_company_id: string | null; new_company_id: string }>('SELECT * FROM title_changes ORDER BY id DESC LIMIT 12').map((r) => ({ tick: r.tick, gameDate: gameDate(cfg, r.tick), label: r.label, from: r.old_company_id ? db.get<{ name: string }>('SELECT name FROM companies WHERE id = ?', r.old_company_id)?.name ?? null : null, to: db.get<{ name: string }>('SELECT name FROM companies WHERE id = ?', r.new_company_id)?.name ?? '' }));
  return { tick: t, asOfBoardTick: bt, boards, titles, recentChanges };
}

export function news(db: Sql, limit = 30): Article[] {
  const cfg = loadConfig(db);
  return db.all<{ id: number; tick: number; kind: string; headline: string; body: string; importance: 1 | 2 | 3; subject_company_id: string | null; industry_id: string | null; commodity_id: string | null }>('SELECT * FROM news_articles ORDER BY tick DESC, importance DESC, id DESC LIMIT ?', Math.max(1, Math.min(100, limit)))
    .map((a) => ({ id: a.id, tick: a.tick, gameDate: gameDate(cfg, a.tick), kind: a.kind, headline: a.headline, body: a.body, importance: a.importance, companyId: a.subject_company_id, industry: a.industry_id, commodityId: a.commodity_id }));
}

/** Public competitor inspection. Deliberately omits cash, margins, orders, inventory and strategy. */
export function competitorProfile(db: Sql, id: string): CompetitorProfile | null {
  const cfg = loadConfig(db), t = lastTick(db);
  const c = db.get<CoRow & { district_id: string | null; status: string; bankrupt_tick: number | null; created_tick: number; quality: string; price_minor: number; reputation_bps: number; employees: number; max_employees: number }>('SELECT * FROM companies WHERE id = ?', id);
  if (!c || (c as { owner_kind: string }).owner_kind === 'state') return null;
  const spec = db.get<{ label: string }>('SELECT label FROM industry_specs WHERE industry_id = ?', c.industry_id);
  const rk = rankings(db).find((r) => r.industry === c.industry_id);
  const row = rk?.rows.find((r) => r.companyId === id);
  const band = c.max_employees <= 3 ? 'tiny' : c.max_employees <= 8 ? 'small' : c.max_employees <= 20 ? 'medium' : 'large';
  const u = row?.unitsPerDay ?? 0;
  const unitsBand = u === 0 ? 'none yet' : u < 20 ? 'under 20 / day' : u < 100 ? '20–100 / day' : u < 500 ? '100–500 / day' : '500+ / day';
  const recent = db.all<{ tick: number; message: string }>("SELECT tick, message FROM economic_events WHERE subject = ? AND kind IN ('company_opened','company_created','company_upgraded','company_closed','bankruptcy','title_changed') ORDER BY id DESC LIMIT 8", id).map((e) => ({ tick: e.tick, gameDate: gameDate(cfg, e.tick), text: e.message }));
  return {
    companyId: id, name: c.name, industry: c.industry_id, industryLabel: spec?.label ?? c.industry_id, ownerKind: c.owner_kind, district: db.get<{ name: string }>('SELECT name FROM districts WHERE id = ?', c.district_id ?? '')?.name ?? '',
    status: c.bankrupt_tick !== null ? 'closed' : c.status === 'paused' ? 'paused' : c.status === 'insolvent' ? 'closed' : 'operating',
    foundedTick: c.created_tick, ageDays: Math.max(0, t - c.created_tick), quality: c.quality, priceMinor: c.price_minor, reputationBps: c.reputation_bps, staffBand: band,
    market: { rank: row?.rank ?? 0, of: rk?.total ?? 0, shareBps: row?.shareBps ?? 0, unitsPerDayBand: unitsBand },
    titles: db.all<{ label: string }>('SELECT label FROM titles WHERE holder_company_id = ? ORDER BY title_key', id).map((r) => r.label), recent,
    future: { shareInvestable: false, acquirable: false, corporateGroupId: null },
    notice: 'Public information only. Cash, margins, stock and plans are private to each company.',
  };
}

import { displayItems } from '../engine/prestige';
import type { CompanyActivity, ActivityState } from '../../src/shared/living';
/**
 * What each building looks like today. Every flag is computed from recorded rows (the last completed day's sales, production and shipments):
 * customers/vans/workers are capped counts of those real numbers, never decoration invented for effect.
 */
export function cityActivity(db: Sql): { tick: number; items: CompanyActivity[] } {
  const t = lastTick(db);
  const items = db.all<{ id: string; status: string; bankrupt_tick: number | null; created_tick: number; employees: number; owner_kind: string; owner_id: string }>("SELECT id, status, bankrupt_tick, created_tick, employees, owner_kind, owner_id FROM companies WHERE owner_kind <> 'state' ORDER BY id").map((c): CompanyActivity => {
    const s = db.get<{ revenue_minor: number; units_sold: number; units_produced: number; inventory_value_minor: number }>('SELECT revenue_minor, units_sold, units_produced, inventory_value_minor FROM company_tick_stats WHERE company_id = ? AND tick = ?', c.id, t);
    const consumer = db.get<{ u: number }>('SELECT COALESCE(SUM(units),0) u FROM segment_sales WHERE company_id = ? AND tick = ?', c.id, t)!.u;
    const shipped = db.get<{ n: number }>('SELECT COUNT(*) n FROM trades WHERE seller_company_id = ? AND tick = ?', c.id, t)!.n;
    const limited = db.get<{ l: string }>('SELECT limited_by l FROM production_log WHERE company_id = ? AND tick = ?', c.id, t)?.l;
    let state: ActivityState = 'quiet';
    if (c.bankrupt_tick !== null || c.status === 'insolvent' || c.status === 'paused') state = 'closed';
    else if (t - c.created_tick < 3) state = 'construction';
    else if (limited === 'supply' || limited === 'inputs') state = 'missing-inputs';
    else if (s && s.units_produced > 0 && s.units_sold >= s.units_produced && s.inventory_value_minor === 0) state = 'high-demand';
    else if (shipped > 0) state = 'delivery';
    else if (consumer > 0) state = 'customers';
    else if (s && s.units_produced > 0) state = 'production';
    const open = state !== 'closed' && state !== 'construction';
    const ad = open ? (db.get<{ k: string }>("SELECT kind k FROM ad_campaigns WHERE company_id = ? AND status = 'active' ORDER BY CASE kind WHEN 'billboard' THEN 0 WHEN 'digital' THEN 1 WHEN 'industry' THEN 2 WHEN 'contract' THEN 3 ELSE 4 END LIMIT 1", c.id)?.k as CompanyActivity['ad'] | undefined) ?? null : null;
    const luxury = c.owner_kind === 'player' && c.id === db.get<{ id: string }>("SELECT id FROM companies WHERE owner_id = ? AND owner_kind = 'player' AND bankrupt_tick IS NULL ORDER BY created_tick, id LIMIT 1", c.owner_id)?.id ? displayItems(db, c.owner_id).map((d) => d.asset) : [];
    return { companyId: c.id, state, customers: open ? Math.min(4, Math.ceil(consumer / 25)) : 0, vans: open ? Math.min(2, Math.ceil(shipped / 3)) : 0, workers: open ? Math.min(3, Math.ceil(c.employees / 3)) : 0, ad, energy: limited === 'energy' || limited === 'disruption', luxury };
  });
  return { tick: t, items };
}
