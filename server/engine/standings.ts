import type { Sql } from '../db/sql';
import type { EngineConfig } from './config';
import { HOUSEHOLDS, TREASURY } from '../seed/bristol';
import { logEvent } from './stats';
import type { TickCtx } from './ledger';

/** Standings are recomputed on this cadence (days); the Penny Post and stability stats run daily. */
export const BOARD_EVERY = 7;
const TOP = 10;
const SWAP_MARGIN_BPS = 500;      // a challenger must beat the holder by 5 % to take a title: no flip-flopping on ties

export const BOARDS: Record<string, string> = { profit: 'Most profitable (7-day net)', revenue: 'Highest revenue (7-day)', share: 'Market share', reputation: 'Reputation', growth: 'Fastest growing (revenue vs prior week)' };
const TITLE_DEFS: { key: string; label: string; board: string; industry?: boolean }[] = [
  { key: 'market_leader', label: 'Market Leader', board: 'share', industry: true },
  { key: 'most_profitable', label: 'Most Profitable Company in Bristol', board: 'profit' },
  { key: 'most_trusted', label: 'Most Trusted Brand', board: 'reputation' },
  { key: 'fastest_growing', label: 'Fastest Growing Company', board: 'growth' },
];

interface Co { id: string; name: string; industry_id: string; owner_kind: string; reputation_bps: number }
const live = (db: Sql) => db.all<Co>("SELECT id, name, industry_id, owner_kind, reputation_bps FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NULL AND status <> 'insolvent' ORDER BY id");
/** Units/value a company 'sold' to another company with the SAME owner (circular or wash trading): real trades, but they are not demand and never count towards standings. */
export const washSql = (col: 'qty' | 'qty * t.price_minor', seller = '?') => `COALESCE((SELECT SUM(${col}) FROM trades t JOIN companies b ON b.id = t.buyer_company_id JOIN companies s ON s.id = t.seller_company_id WHERE t.seller_company_id = ${seller} AND COALESCE(t.stat_tick, t.tick) > ? AND COALESCE(t.stat_tick, t.tick) <= ? AND b.owner_id = s.owner_id AND b.owner_kind = s.owner_kind),0)`;
const wash = (db: Sql, id: string, col: 'qty' | 'qty * t.price_minor', from: number, to: number) => db.get<{ v: number }>(`SELECT ${washSql(col)} v`, id, from, to)!.v;
const sum = (db: Sql, id: string, col: string, from: number, to: number) => db.get<{ v: number }>(`SELECT COALESCE(SUM(${col}),0) v FROM company_tick_stats WHERE company_id = ? AND tick > ? AND tick <= ?`, id, from, to)!.v - (col === 'units_sold' ? wash(db, id, 'qty', from, to) : col === 'revenue_minor' ? wash(db, id, 'qty * t.price_minor', from, to) : 0);

/** Leaderboards and titles for tick `n`. Pure functions of recorded company statistics: NPCs and players are ranked by exactly the same numbers. */
export function recordLeaderboards(db: Sql, n: number) {
  const cos = live(db);
  const rows: Record<string, { c: Co; v: number }[]> = {}; const byInd: Record<string, Record<string, { c: Co; v: number }[]>> = {};
  const units = new Map<string, number>(); const indTotal = new Map<string, number>();
  for (const c of cos) { const u = sum(db, c.id, 'units_sold', n - BOARD_EVERY, n); units.set(c.id, u); indTotal.set(c.industry_id, (indTotal.get(c.industry_id) ?? 0) + u); }
  rows.profit = []; rows.revenue = []; rows.reputation = []; rows.growth = [];
  for (const c of cos) {
    const rev = sum(db, c.id, 'revenue_minor', n - BOARD_EVERY, n), prev = sum(db, c.id, 'revenue_minor', n - 2 * BOARD_EVERY, n - BOARD_EVERY);
    rows.profit.push({ c, v: sum(db, c.id, 'net_profit_minor', n - BOARD_EVERY, n) });
    rows.revenue.push({ c, v: rev });
    rows.reputation.push({ c, v: c.reputation_bps });
    if (prev > 0 && rev > 0) rows.growth.push({ c, v: Math.round(((rev - prev) * 10_000) / prev) });   // young firms with no prior week are not "fast growing"
    const tot = indTotal.get(c.industry_id) ?? 0, u = units.get(c.id) ?? 0;
    if (tot > 0) (byInd[c.industry_id] ??= { share: [] }).share!.push({ c, v: Math.floor((u * 10_000) / tot) });
  }
  const write = (board: string, scope: string, list: { c: Co; v: number }[]) => {
    list.sort((a, b) => b.v - a.v || a.c.id.localeCompare(b.c.id));
    list.slice(0, TOP).forEach((r, i) => db.run('INSERT OR REPLACE INTO leaderboard (tick, board, scope, rank, company_id, value) VALUES (?,?,?,?,?,?)', n, board, scope, i + 1, r.c.id, r.v));
  };
  for (const b of Object.keys(rows)) write(b, 'city', rows[b]!);
  for (const [ind, boards] of Object.entries(byInd)) write('share', ind, boards.share!);

  const changes: { key: string; label: string; to: Co; from: string | null }[] = [];
  for (const def of TITLE_DEFS) {
    const scopes = def.industry ? Object.keys(byInd) : ['city'];
    for (const scope of scopes) {
      const top = db.all<{ company_id: string; value: number }>('SELECT company_id, value FROM leaderboard WHERE tick = ? AND board = ? AND scope = ? ORDER BY rank LIMIT 1', n, def.board, scope)[0];
      if (!top || top.value <= 0) continue;
      const key = def.industry ? `${def.key}:${scope}` : def.key;
      const cur = db.get<{ holder_company_id: string; value: number }>('SELECT holder_company_id, value FROM titles WHERE title_key = ?', key);
      const co = cos.find((c) => c.id === top.company_id)!;
      const label = def.industry ? `${def.label}: ${db.get<{ label: string }>('SELECT label FROM industry_specs WHERE industry_id = ?', scope)?.label ?? scope}` : def.label;
      if (!cur) { db.run('INSERT INTO titles (title_key, label, holder_company_id, since_tick, value, industry_id, board) VALUES (?,?,?,?,?,?,?)', key, label, co.id, n, top.value, def.industry ? scope : null, def.board); db.run('INSERT INTO title_changes (tick, title_key, label, old_company_id, new_company_id, new_value, old_value) VALUES (?,?,?,?,?,?,?)', n, key, label, null, co.id, top.value, null); changes.push({ key, label, to: co, from: null }); continue; }
      if (cur.holder_company_id === co.id) { db.run('UPDATE titles SET value = ? WHERE title_key = ?', top.value, key); continue; }
      const holderStillLive = cos.some((c) => c.id === cur.holder_company_id);
      const holderNow = holderStillLive ? (db.get<{ value: number }>('SELECT value FROM leaderboard WHERE tick = ? AND board = ? AND scope = ? AND company_id = ?', n, def.board, scope, cur.holder_company_id)?.value ?? 0) : -Infinity;
      const beats = holderNow === -Infinity || top.value > holderNow + Math.abs(holderNow) * SWAP_MARGIN_BPS / 10_000;
      if (!beats) continue;
      db.run('UPDATE titles SET holder_company_id = ?, since_tick = ?, value = ? WHERE title_key = ?', co.id, n, top.value, key);
      db.run('INSERT INTO title_changes (tick, title_key, label, old_company_id, new_company_id, new_value, old_value) VALUES (?,?,?,?,?,?,?)', n, key, label, cur.holder_company_id, co.id, top.value, holderNow === -Infinity ? null : holderNow);
      changes.push({ key, label, to: co, from: cur.holder_company_id });
    }
  }
  for (const ch of changes) {
    const prevName = ch.from ? db.get<{ name: string }>('SELECT name FROM companies WHERE id = ?', ch.from)?.name : null;
    logEvent(db, n, 'title_changed', 'info', ch.to.id, `${ch.to.name} is now "${ch.label}"${prevName ? `, taking it from ${prevName}` : ''}`, { title: ch.key, from: ch.from });
  }
}

/** The Penny Post: every article is generated from a recorded economic event (`event_id` is unique, so re-running a tick never duplicates a story) and states only what the event says. */
export function recordNews(db: Sql, n: number) {
  const events = db.all<{ id: number; kind: string; subject: string | null; message: string; data_json: string | null }>("SELECT id, kind, subject, message, data_json FROM economic_events WHERE tick = ? AND kind IN ('company_opened','company_created','company_closed','bankruptcy','title_changed','company_upgraded','ipo','follow_on','dividend_declared','dividend_paid','trading_suspended','trading_resumed','delisted','control_change','large_holder','record_profit','major_loss','market_crash','eco_event_start','eco_event_end','rate_decision','loan_default','loan_loss','stimulus_paid','eco_scandal') ORDER BY id", n);
  const put = (e: { id: number }, kind: string, headline: string, body: string, importance: number, subject: string | null, industry: string | null, data: unknown) =>
    db.run('INSERT OR IGNORE INTO news_articles (tick, kind, headline, body, importance, subject_company_id, industry_id, event_id, data_json) VALUES (?,?,?,?,?,?,?,?,?)', n, kind, headline, body, importance, subject, industry, e.id, JSON.stringify(data));
  for (const e of events) {
    const co = e.subject ? db.get<{ name: string; industry_id: string; owner_kind: string }>('SELECT name, industry_id, owner_kind FROM companies WHERE id = ?', e.subject) : undefined;
    const ind = co ? (db.get<{ label: string }>('SELECT label FROM industry_specs WHERE industry_id = ?', co.industry_id)?.label ?? co.industry_id).toLowerCase() : '';
    const data = e.data_json ? JSON.parse(e.data_json) : {};
    // Macro stories: each one restates a recorded event (event engine, central bank, bank) and nothing else.
    if (e.kind === 'eco_event_start') { const sev = Number(data.severity ?? 1); put(e, 'economy', String(e.message.split('. ')[0]), `${e.message}.`, sev >= 3 ? 3 : 2, null, null, data); continue; }
    if (e.kind === 'eco_event_end') { put(e, 'economy', 'Conditions ease', `${e.message}.`, 1, null, null, data); continue; }
    if (e.kind === 'rate_decision') { put(e, 'policy', 'Penny Central Bank changes the base rate', `${e.message}`, 3, null, null, data); continue; }
    if (e.kind === 'stimulus_paid') { put(e, 'policy', 'Treasury pays out stimulus', `${e.message}.`, 2, null, null, data); continue; }
    if (e.kind === 'loan_default' || e.kind === 'loan_loss') { put(e, 'credit', e.kind === 'loan_default' ? 'A borrower defaults on its bank loan' : 'National Bank books a loan loss', `${e.message}.`, 2, e.subject, null, data); continue; }
    if (e.kind === 'eco_scandal') { put(e, 'scandal', e.message.split(':')[0]!, `${e.message}.`, 2, e.subject, null, data); continue; }
    if (e.kind === 'market_crash') { put(e, 'market', 'Penny Exchange index tumbles', `${e.message}.`, 3, null, null, data); continue; }
    if (!co) continue;
    const MARKET: Record<string, [string, string, number]> = { ipo: ['ipo', `${co.name} lists on the Penny Exchange`, 2], follow_on: ['ipo', `${co.name} offers more shares`, 1], dividend_declared: ['dividend', `${co.name} declares a dividend`, 1], dividend_paid: ['dividend', `${co.name} pays its dividend`, 1], trading_suspended: ['suspension', `Trading in ${co.name} suspended`, 3], trading_resumed: ['suspension', `Trading in ${co.name} resumes`, 2], delisted: ['delisting', `${co.name} delisted`, 3], control_change: ['control', `${co.name} changes hands`, 3], large_holder: ['holder', `New large shareholder in ${co.name}`, 1], record_profit: ['earnings', `${co.name} reports record profit`, 2], major_loss: ['earnings', `${co.name} reports a major loss`, 2] };
    if (MARKET[e.kind]) { const [kind, headline, imp] = MARKET[e.kind]!; put(e, kind, headline, `${e.message}.`, imp, e.subject, co.industry_id, data); continue; }
    if (e.kind === 'company_opened') put(e, 'opening', `${co.name} opens its doors`, `A new ${ind} has opened in Bristol. ${e.message}.`, 2, e.subject, co.industry_id, data);
    else if (e.kind === 'company_created' && co.owner_kind === 'player') put(e, 'opening', `${co.name} opens its doors`, `A new ${ind} has opened in Bristol.`, 2, e.subject, co.industry_id, data);
    else if (e.kind === 'company_closed') put(e, 'closure', `${co.name} closes`, `${co.name}, a Bristol ${ind}, has closed after a run of losses.`, 2, e.subject, co.industry_id, data);
    else if (e.kind === 'bankruptcy') put(e, 'bankruptcy', `${co.name} goes bankrupt`, `${e.message}.`, 3, e.subject, co.industry_id, data);
    else if (e.kind === 'title_changed') put(e, 'title', e.message.replace(/^(.*?) is now "(.*?)".*$/, '$1 named $2'), `${e.message}.`, 1, e.subject, co.industry_id, data);
    else if (e.kind === 'company_upgraded' && data.kind === 'tier') put(e, 'expansion', `${co.name} expands`, `${co.name} has moved into larger premises.`, 1, e.subject, co.industry_id, data);
  }
  // Market-wide shortage notice: only when the recorded market data for today actually shows unmet consumer demand, at most one per commodity per week.
  for (const r of db.all<{ commodity_id: string; d: number; c: number; name: string }>("SELECT m.commodity_id, m.demand_units d, m.consumer_units c, k.name FROM market_stats m JOIN commodities k ON k.id = m.commodity_id WHERE m.tick = ? AND m.demand_units > 0 AND m.consumer_units * 10 < m.demand_units * 5 ORDER BY m.commodity_id", n)) {
    const recent = db.get<{ n: number }>("SELECT COUNT(*) n FROM news_articles WHERE kind = 'shortage' AND commodity_id = ? AND tick > ?", r.commodity_id, n - 7)!.n;
    if (recent) continue;
    db.run("INSERT INTO news_articles (tick, kind, headline, body, importance, commodity_id, data_json) VALUES (?,?,?,?,?,?,?)", n, 'shortage', `${r.name} runs short`, `Only ${r.c.toLocaleString('en-GB')} of ${r.d.toLocaleString('en-GB')} units wanted were bought today.`, 2, r.commodity_id, JSON.stringify({ demand: r.d, bought: r.c }));
  }
}

/** Daily stability figures. Observation only: nothing here ever changes the economy ("no automatic rescues"). */
export function recordStability(db: Sql, n: number) {
  const bal = (where: string, ...a: (string | number)[]) => db.get<{ v: number }>(`SELECT COALESCE(SUM(a.balance_minor),0) v FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE ${where}`, ...a)!.v;
  const circ = db.get<{ c: number }>('SELECT circulating_minor c FROM supply_snapshots WHERE tick = ?', n)?.c ?? 0;
  const hh = db.get<{ v: number }>('SELECT balance_minor v FROM accounts WHERE id = ?', HOUSEHOLDS)?.v ?? 0, state = db.get<{ v: number }>('SELECT balance_minor v FROM accounts WHERE id = ?', TREASURY)?.v ?? 0;
  const npc = bal("c.owner_kind = 'npc'"), player = bal("c.owner_kind = 'player'");
  const spend = db.get<{ s: number }>('SELECT COALESCE(SUM(revenue_minor),0) s FROM company_tick_stats t JOIN companies c ON c.id = t.company_id WHERE t.tick = ? AND c.owner_kind <> ?', n, 'state')!.s;
  const npcSpend = db.get<{ s: number }>('SELECT COALESCE(SUM(revenue_minor),0) s FROM company_tick_stats t JOIN companies c ON c.id = t.company_id WHERE t.tick = ? AND c.owner_kind = ?', n, 'npc')!.s;
  const produced = db.get<{ u: number }>('SELECT COALESCE(SUM(units_produced),0) u FROM company_tick_stats WHERE tick = ?', n)!.u;
  const cash = db.all<{ v: number }>("SELECT a.balance_minor v FROM companies c JOIN accounts a ON a.id = c.treasury_account_id WHERE c.owner_kind <> 'state' AND c.bankrupt_tick IS NULL ORDER BY v").map((r) => r.v);
  // Gini over company cash, in basis points (integer arithmetic).
  let gini = 0; const tot = cash.reduce((a, b) => a + b, 0);
  if (cash.length > 1 && tot > 0) { let w = 0; cash.forEach((v, i) => { w += (i + 1) * v; }); gini = Math.max(0, Math.round(((2 * w) / (cash.length * tot) - (cash.length + 1) / cash.length) * 10_000)); }
  const count = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NULL AND status <> 'insolvent'")!.n;
  const fails = db.get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE owner_kind <> 'state' AND bankrupt_tick IS NOT NULL")!.n;
  db.run('INSERT OR REPLACE INTO stability_stats (tick, circulating_minor, households_minor, npc_cash_minor, player_cash_minor, state_minor, consumer_spend_minor, npc_spend_minor, units_produced, gini_bps, company_count, failures_cum) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', n, circ, hh, npc, player, state, spend, npcSpend, produced, gini, count, fails);
}

export function runStandings(db: Sql, ctx: TickCtx, _cfg: EngineConfig) {
  const n = ctx.tick;
  if (n > 0 && n % BOARD_EVERY === 0) recordLeaderboards(db, n);
  recordNews(db, n);
  recordStability(db, n);
}
