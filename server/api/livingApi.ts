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
