import type { Sql } from '../db/sql';
import { checkShareIntegrity, companyInvestorId, outstanding } from '../engine/capital';
import { orderBook } from '../engine/shareMarket';

/** Developer view of the Penny Exchange. Read-only, from the share registers and journals. */
export interface MarketDashboard {
  integrity: { ok: boolean; problems: string[] };
  listed: { ticker: string; company: string; status: string; issued: number; outstanding: number; treasury: number; lastPrice: number | null; fair: number | null; marketCap: number | null; volume7d: number; value7d: number; spreadBps: number | null; depthBid: number; depthAsk: number; top1Bps: number; hhiBps: number; volatilityBps: number }[];
  totals: { listedCount: number; marketCapMinor: number; volume7d: number; value7d: number; feesCollected: number; dividendsDeclared: number; dividendsPaid: number; sharesIssued: number; sharesCancelled: number; ipos: number };
  index: { tick: number; valueBps: number; marketCapMinor: number }[];
  participation: { kind: string; buyShares: number; sellShares: number; buyValue: number; sellValue: number }[];
  suspicious: { kind: string; severity: 'info' | 'warning' | 'error'; detail: string }[];
  failedSettlements: { kind: string; n: number; lastReason: string | null }[];
  audit: { journal: { id: number; tick: number; kind: string; company: string; from: string | null; to: string | null; qty: number; price: number; ref: string | null }[]; dividends: { id: number; company: string; perShare: number; total: number; status: string; declaredBy: string }[]; control: { tick: number; company: string; to: string; stakeBps: number }[] };
  investors: { id: string; name: string; strategy: string | null; cashMinor: number; positions: number; lastDecisions: { tick: number; action: string; reason: string; applied: boolean }[] }[];
}

export function marketDashboard(db: Sql, tick: number): MarketDashboard {
  const since = Math.max(0, tick - 7);
  const problems = checkShareIntegrity(db);
  const listed = db.all<{ company_id: string; ticker: string; status: string; issued_shares: number }>("SELECT company_id, ticker, status, issued_shares FROM securities WHERE status IN ('open','suspended') ORDER BY ticker").map((s) => {
    const name = db.get<{ name: string }>('SELECT name FROM companies WHERE id = ?', s.company_id)!.name;
    const out = outstanding(db, s.company_id);
    const px = db.get<{ p: number }>('SELECT close_minor p FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL ORDER BY tick DESC LIMIT 1', s.company_id)?.p ?? null;
    const fair = db.get<{ v: number }>('SELECT fair_value_minor v FROM security_valuations WHERE company_id = ? ORDER BY tick DESC LIMIT 1', s.company_id)?.v ?? null;
    const w = db.get<{ v: number; q: number }>('SELECT COALESCE(SUM(price_minor * qty),0) v, COALESCE(SUM(qty),0) q FROM share_trades WHERE company_id = ? AND tick > ?', s.company_id, since)!;
    const ob = orderBook(db, s.company_id, tick);
    const holders = db.all<{ shares: number }>('SELECT shares FROM share_holdings WHERE company_id = ? AND shares > 0 AND investor_id <> ?', s.company_id, companyInvestorId(s.company_id)).map((h) => h.shares);
    const shares = out > 0 ? holders.map((h) => Math.floor((h * 10_000) / out)) : [];
    const closes = db.all<{ c: number }>('SELECT close_minor c FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL AND tick > ? ORDER BY tick', s.company_id, tick - 15).map((r) => r.c);
    const rets = closes.slice(1).map((c, i) => (c - closes[i]!) / closes[i]!); const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
    const vol = rets.length > 1 ? Math.round(Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1)) * 10_000) : 0;
    return { ticker: s.ticker, company: name, status: s.status, issued: s.issued_shares, outstanding: out, treasury: s.issued_shares - out, lastPrice: px, fair, marketCap: px ? px * out : null, volume7d: w.q, value7d: w.v, spreadBps: ob.bids[0] && ob.asks[0] ? Math.round(((ob.asks[0].priceMinor - ob.bids[0].priceMinor) * 10_000) / ob.asks[0].priceMinor) : null, depthBid: ob.bids.reduce((a, l) => a + l.shares, 0), depthAsk: ob.asks.reduce((a, l) => a + l.shares, 0), top1Bps: shares.length ? Math.max(...shares) : 0, hhiBps: shares.reduce((a, s2) => a + Math.floor((s2 * s2) / 10_000), 0), volatilityBps: vol };
  });
  const one = (sql: string, ...p: (string | number)[]) => db.get<{ v: number }>(sql, ...p)!.v;
  const totals = {
    listedCount: listed.length, marketCapMinor: listed.reduce((a, l) => a + (l.marketCap ?? 0), 0), volume7d: listed.reduce((a, l) => a + l.volume7d, 0), value7d: listed.reduce((a, l) => a + l.value7d, 0),
    feesCollected: one('SELECT COALESCE(SUM(fee_minor),0) v FROM share_trades') + one('SELECT COALESCE(SUM(listing_fee_minor),0) v FROM share_offerings'),
    dividendsDeclared: one("SELECT COALESCE(SUM(total_minor),0) v FROM dividends WHERE status <> 'cancelled'"), dividendsPaid: one("SELECT COALESCE(SUM(paid_minor),0) v FROM dividends WHERE status = 'paid'"),
    sharesIssued: one("SELECT COALESCE(SUM(qty),0) v FROM share_journal WHERE kind = 'issue'"), sharesCancelled: one("SELECT COALESCE(SUM(qty),0) v FROM share_journal WHERE kind IN ('cancel','liquidation')"), ipos: one("SELECT COUNT(*) v FROM share_offerings WHERE kind = 'ipo'"),
  };
  const participation = db.all<{ kind: string; bs: number; ss: number; bv: number; sv: number }>(`SELECT i.kind, COALESCE(SUM(CASE WHEN t.buyer_id = i.id THEN t.qty END),0) bs, COALESCE(SUM(CASE WHEN t.seller_id = i.id THEN t.qty END),0) ss, COALESCE(SUM(CASE WHEN t.buyer_id = i.id THEN t.qty*t.price_minor END),0) bv, COALESCE(SUM(CASE WHEN t.seller_id = i.id THEN t.qty*t.price_minor END),0) sv FROM investors i JOIN share_trades t ON t.buyer_id = i.id OR t.seller_id = i.id WHERE t.tick > ? GROUP BY i.kind ORDER BY i.kind`, since).map((r) => ({ kind: r.kind, buyShares: r.bs, sellShares: r.ss, buyValue: r.bv, sellValue: r.sv }));
  const suspicious: MarketDashboard['suspicious'] = [];
  for (const p of problems.slice(0, 5)) suspicious.push({ kind: 'integrity', severity: 'error', detail: p });
  for (const r of db.all<{ a: string; b: string; c: string; n: number }>('SELECT buyer_id a, seller_id b, company_id c, COUNT(*) n FROM share_trades WHERE tick > ? GROUP BY buyer_id, seller_id, company_id HAVING n >= 8 ORDER BY n DESC LIMIT 5', tick - 10)) suspicious.push({ kind: 'repeated_pair', severity: 'warning', detail: `${r.a} bought from ${r.b} ${r.n} times in 10 days (${r.c}).` });
  for (const l of listed) { if (l.fair && l.lastPrice && (l.lastPrice > l.fair * 3 || l.lastPrice * 3 < l.fair)) suspicious.push({ kind: 'price_far_from_fundamentals', severity: 'warning', detail: `${l.ticker} last traded at ${(l.lastPrice / 100).toFixed(2)} EC against a ${(l.fair / 100).toFixed(2)} EC estimate.` }); if (l.status === 'suspended') suspicious.push({ kind: 'suspended', severity: 'info', detail: `${l.ticker} is suspended.` }); if (l.top1Bps > 9_000 && l.volume7d > 0) suspicious.push({ kind: 'concentration', severity: 'info', detail: `${l.ticker}: one holder owns ${(l.top1Bps / 100).toFixed(0)}% of its shares.` }); }
  const selfTrades = one('SELECT COUNT(*) v FROM share_trades WHERE buyer_id = seller_id'); if (selfTrades) suspicious.push({ kind: 'self_trade', severity: 'error', detail: `${selfTrades} trade(s) with identical buyer and seller.` });
  const failed = db.all<{ kind: string; n: number }>("SELECT kind, COUNT(*) n FROM failed_transactions WHERE kind LIKE 'share.%' OR kind LIKE 'dividend.%' GROUP BY kind ORDER BY n DESC").map((f) => ({ ...f, lastReason: db.get<{ r: string }>('SELECT reason r FROM failed_transactions WHERE kind = ? ORDER BY id DESC LIMIT 1', f.kind)?.r ?? null }));
  return {
    integrity: { ok: problems.length === 0, problems }, listed, totals,
    index: db.all<{ tick: number; value_bps: number; market_cap_minor: number }>('SELECT * FROM (SELECT * FROM market_index ORDER BY tick DESC LIMIT 90) ORDER BY tick').map((r) => ({ tick: r.tick, valueBps: r.value_bps, marketCapMinor: r.market_cap_minor })),
    participation, suspicious, failedSettlements: failed,
    audit: {
      journal: db.all<{ id: number; tick: number; kind: string; company_id: string; from_investor: string | null; to_investor: string | null; qty: number; price_minor: number; ref: string | null }>("SELECT * FROM share_journal WHERE kind <> 'transfer' OR id > (SELECT COALESCE(MAX(id),0) - 30 FROM share_journal) ORDER BY id DESC LIMIT 40").map((j) => ({ id: j.id, tick: j.tick, kind: j.kind, company: j.company_id, from: j.from_investor, to: j.to_investor, qty: j.qty, price: j.price_minor, ref: j.ref })),
      dividends: db.all<{ id: number; company_id: string; per_share_minor: number; total_minor: number; status: string; declared_by: string }>('SELECT * FROM dividends ORDER BY id DESC LIMIT 15').map((d) => ({ id: d.id, company: d.company_id, perShare: d.per_share_minor, total: d.total_minor, status: d.status, declaredBy: d.declared_by })),
      control: db.all<{ tick: number; company_id: string; to_owner_id: string; stake_bps: number }>('SELECT tick, company_id, to_owner_id, stake_bps FROM control_log ORDER BY id DESC LIMIT 10').map((c) => ({ tick: c.tick, company: c.company_id, to: c.to_owner_id, stakeBps: c.stake_bps })),
    },
    investors: db.all<{ id: string; name: string; strategy: string | null; cash: number }>("SELECT i.id, i.name, i.strategy, a.balance_minor cash FROM investors i JOIN accounts a ON a.id = i.account_id WHERE i.kind = 'npc' ORDER BY i.id").map((i) => ({ id: i.id, name: i.name, strategy: i.strategy, cashMinor: i.cash, positions: one("SELECT COUNT(*) v FROM share_holdings WHERE investor_id = ? AND shares > 0", i.id) as number, lastDecisions: db.all<{ tick: number; action: string; reason: string; applied: number }>('SELECT tick, action, reason, applied FROM investor_decisions WHERE investor_id = ? ORDER BY id DESC LIMIT 4', i.id).map((d) => ({ tick: d.tick, action: d.action, reason: d.reason, applied: d.applied === 1 })) })),
  };
}
