import type { Sql } from './db/sql';
import { configureCompany, placePlayerOrder, quoteOrder } from './engine/commands';
import { createCompany, startupQuote } from './engine/company';
import { proposeContract } from './engine/contracts';
import { commodityDetail } from './engine/exchange';
import { balance, issue, reconcile, supply } from './engine/ledger';
import { runTick } from './engine/tick';
import { lastTick, openWorld } from './engine/world';
import { PLAYER_WALLET, companyAccount } from './seed/bristol';

export interface BotResult { bot: string; strategy: string; companies: string[]; startWorth: number; endWorth: number; profit: number; trades: number; unitsBought: number; unitsSold: number; feesPaid: number; status: string }
export interface MarketSimReport {
  /** the finished world, for inspection by tests and tools */ world?: Sql;
  days: number; anomalies: string[]; reconciliation: boolean; supplyStart: number; supplyEnd: number; supplyChangeBps: number;
  bots: BotResult[];
  commodities: { id: string; vwapFirst: number | null; vwapLast: number | null; minVwap: number | null; maxVwap: number | null; reference: number; volatilityBps: number; volume: number; shortageDays: number; avgSpreadBps: number | null; hhiBps: number; topSupplier: string; topShareBps: number }[];
  exchange: { feesCollected: number; burned: number; swept: number; trades: number; value: number; contractDeliveries: number; contractMisses: number; failedSettlements: number };
  failures: { kind: string; reason: string; n: number }[]; contractOffers: string[];
  npc: { minStateStock: { commodity: string; units: number }[]; insolventNpc: string[]; bankruptcies: string[] };
}

const grant = (db: Sql, to: string, amount: number) => issue(db, { tick: 0, gameDate: 'x', actor: 'sim' }, `sim:grant:${to}`, to, amount, 'simulation test-player grant');
const worth = (db: Sql, ids: string[]) => ids.reduce((a, id) => a + balance(db, companyAccount(id)) + db.get<{ v: number }>('SELECT COALESCE(SUM(value_minor),0) v FROM inventory WHERE company_id = ?', id)!.v, 0);
let k = 0; const key = (p: string) => `${p}-${k++}`;

/**
 * Runs the exchange forward with four scripted test players competing with the NPCs and the state: a price-undercutting wholesaler (farm + mill), a would-be monopolist
 * who tries to corner wheat, a contract buyer (pizza restaurant), and an idle café. Everything goes through the real commands; the audit checks the accounting identities every tick.
 */
export function runMarketSim(days: number): MarketSimReport {
  const db: Sql = openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'new');
  grant(db, PLAYER_WALLET, 4_000_000);
  const found = (industry: string, plot: string, name: string, capital?: number) => {
    const q0 = startupQuote(db, { industry, plotId: plot, tier: 1, name });
    const q = capital ? startupQuote(db, { industry, plotId: plot, tier: 1, name, workingCapitalMinor: capital }) : q0;
    const r = createCompany(db, key('found'), { industry, plotId: plot, tier: 1, name, workingCapitalMinor: capital, expectedTotalMinor: q.totalMinor });
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return (r.data as { companyId: string }).companyId;
  };
  const aFarm = found('farm', 'lot-3', 'Wholesaler Farm'), aMill = found('mill', 'lot-7', 'Wholesaler Mill');
  const bMill = found('mill', 'lot-8', 'Corner Mills', 1_500_000);
  const cPizza = found('pizza', 'plot-pizza', 'Contract Pizza');
  const dCafe = found('cafe', 'plot-cafe', 'Idle Cafe');
  const start = new Map<string, number>([[aFarm, worth(db, [aFarm])], [aMill, worth(db, [aMill])], [bMill, worth(db, [bMill])], [cPizza, worth(db, [cPizza])], [dCafe, worth(db, [dCafe])]]);
  const supplyStart = supply(db).circulating;
  const anomalies: string[] = [];
  const contractOffers: string[] = [];
  let prev = supplyStart;
  const stateMin = new Map<string, number>();
  const commodities = (db.all<{ id: string }>("SELECT id FROM commodities WHERE id <> 'energy' ORDER BY id")).map((c) => c.id);
  const rev = (id: string) => db.get<{ r: number }>('SELECT revision r FROM companies WHERE id = ?', id)!.r;

  for (let day = 1; day <= days; day++) {
    // A — wholesaler: reprice to 1% under the cheapest rival, never below 85% of reference or above 140%
    if (day % 2 === 0) for (const [co, com] of [[aFarm, 'wheat'], [aMill, 'flour']] as const) {
      const rivals = commodityDetail(db, com)!.suppliers.filter((s) => s.companyId !== co).map((s) => s.askMinor);
      const ref = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', com)!.p;
      const target = Math.max(Math.floor(ref * 0.85), Math.min(Math.floor(ref * 1.4), rivals.length ? Math.floor(Math.min(...rivals) * 0.99) : ref));
      configureCompany(db, key('a'), co, rev(co), { askPriceMinor: target });
    }
    // B — would-be monopolist: sweeps wheat with protected market orders, then re-lists at a high price
    if (day >= 3) {
      const q = quoteOrder(db, { companyId: bMill, commodityId: 'wheat', side: 'buy', quantity: 400, limitPriceMinor: 0, kind: 'market', slippageBps: 2_000 });
      if (q.ok && q.quote.availableUnits > 0) placePlayerOrder(db, key('b'), { companyId: bMill, commodityId: 'wheat', side: 'buy', quantity: 400, limitPriceMinor: 0, quoteId: q.quote.id, kind: 'market', slippageBps: 2_000 });
      const held = db.get<{ q: number }>("SELECT COALESCE(qty - reserved,0) q FROM inventory WHERE company_id = ? AND commodity_id = 'wheat'", bMill)!.q;
      if (held > 150) {
        const ref = db.get<{ p: number }>("SELECT reference_price_minor p FROM commodities WHERE id = 'wheat'")!.p;
        const sq = quoteOrder(db, { companyId: bMill, commodityId: 'wheat', side: 'sell', quantity: held - 100, limitPriceMinor: Math.floor(ref * 1.8) });
        if (sq.ok) placePlayerOrder(db, key('bs'), { companyId: bMill, commodityId: 'wheat', side: 'sell', quantity: held - 100, limitPriceMinor: Math.floor(ref * 1.8), quoteId: sq.quote.id, expiresInTicks: 10 });
      }
    }
    // C — contract buyer: locks in flour and cheese from the cheapest NPC/state suppliers on day 2
    if (day === 2) for (const com of ['flour', 'cheese']) {
      const s = commodityDetail(db, com)!.suppliers.find((x) => x.ownerKind !== 'player');
      if (s) { const res = proposeContract(db, key('c'), { actorCompanyId: cPizza, counterpartyId: s.companyId, role: 'buyer', commodityId: com, qtyPerDelivery: 40, priceMinor: Math.ceil(s.askMinor * 1.05), everyTicks: 1, durationTicks: Math.min(days, 90) }); contractOffers.push(`${com} from ${s.name}: ${res.ok ? (res.data as { reason: string }).reason : res.error.message}`); }
    }
    const r = runTick(db, lastTick(db) + 1);
    if (r.status !== 'complete') { anomalies.push(`tick ${day} did not complete`); break; }
    const snap = db.get<{ circulating_minor: number; issued_tick_minor: number; destroyed_tick_minor: number }>('SELECT * FROM supply_snapshots WHERE tick = ?', r.tick)!;
    if (snap.circulating_minor - prev !== snap.issued_tick_minor - snap.destroyed_tick_minor) anomalies.push(`tick ${r.tick}: Δsupply ${snap.circulating_minor - prev} != issued ${snap.issued_tick_minor} − destroyed ${snap.destroyed_tick_minor}`);
    prev = snap.circulating_minor;
    for (const c of ['wheat', 'milk', 'flour', 'cheese', 'coffee', 'packaging']) { const q = db.get<{ q: number }>("SELECT COALESCE(qty,0) q FROM inventory WHERE company_id = 'co-bristol-provisions' AND commodity_id = ?", c)?.q ?? 0; stateMin.set(c, Math.min(stateMin.get(c) ?? Infinity, q)); }
  }

  const tick = lastTick(db);
  const rec = reconcile(db);
  const mine = [aFarm, aMill, bMill, cPizza, dCafe];
  const botOf = (name: string, strategy: string, ids: string[]): BotResult => {
    const inList = ids.map(() => '?').join(',');
    const t = db.get<{ n: number; bu: number; su: number; fee: number }>(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN buyer_company_id IN (${inList}) THEN qty ELSE 0 END),0) bu, COALESCE(SUM(CASE WHEN seller_company_id IN (${inList}) THEN qty ELSE 0 END),0) su, COALESCE(SUM(CASE WHEN seller_company_id IN (${inList}) THEN fee_minor ELSE 0 END),0) fee FROM trades WHERE buyer_company_id IN (${inList}) OR seller_company_id IN (${inList})`, ...ids, ...ids, ...ids, ...ids, ...ids)!;
    const s0 = ids.reduce((a, id) => a + (start.get(id) ?? 0), 0), s1 = worth(db, ids);
    const st = db.all<{ status: string; bankrupt_tick: number | null }>(`SELECT status, bankrupt_tick FROM companies WHERE id IN (${inList})`, ...ids);
    return { bot: name, strategy, companies: ids, startWorth: s0, endWorth: s1, profit: s1 - s0, trades: t.n, unitsBought: t.bu, unitsSold: t.su, feesPaid: t.fee, status: st.some((x) => x.bankrupt_tick !== null) ? 'bankrupt' : st.some((x) => x.status === 'insolvent') ? 'insolvent' : 'operating' };
  };
  const bots = [botOf('A wholesaler', 'undercuts the cheapest rival by 1% on wheat and flour', [aFarm, aMill]), botOf('B monopolist', 'sweeps wheat with protected market orders, re-lists at 180% of reference', [bMill]), botOf('C contract buyer', '40-unit daily flour and cheese contracts at 105% of the supplier’s ask', [cPizza]), botOf('D idle', 'does nothing', [dCafe])];
  const comm = commodities.map((id) => {
    const rows = db.all<{ vwap_minor: number | null; volume: number; best_bid_minor: number | null; best_ask_minor: number | null; listed_units: number; demand_units: number }>('SELECT vwap_minor, volume, best_bid_minor, best_ask_minor, listed_units, demand_units FROM market_stats WHERE commodity_id = ? AND tick > 0 ORDER BY tick', id);
    const v = rows.map((r) => r.vwap_minor).filter((x): x is number => x !== null);
    const ret = v.slice(1).map((x, i) => (x - v[i]!) / v[i]!); const mean = ret.reduce((a, b) => a + b, 0) / Math.max(1, ret.length);
    const vol = Math.sqrt(ret.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ret.length));
    const spreads = rows.filter((r) => r.best_bid_minor && r.best_ask_minor).map((r) => ((r.best_ask_minor! - r.best_bid_minor!) * 10_000) / r.best_ask_minor!);
    const sellers = db.all<{ s: string; q: number }>('SELECT seller_company_id s, SUM(qty) q FROM trades WHERE commodity_id = ? AND tick > ? GROUP BY seller_company_id ORDER BY q DESC', id, Math.max(0, tick - 30));
    const tot = sellers.reduce((a, x) => a + x.q, 0);
    const hhi = tot > 0 ? sellers.reduce((a, x) => a + ((x.q * 100) / tot) ** 2, 0) : 0;
    const ref = db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', id)!.p;
    return { id, vwapFirst: v[0] ?? null, vwapLast: v.at(-1) ?? null, minVwap: v.length ? Math.min(...v) : null, maxVwap: v.length ? Math.max(...v) : null, reference: ref, volatilityBps: Math.round(vol * 10_000), volume: rows.reduce((a, r) => a + r.volume, 0), shortageDays: rows.filter((r) => r.demand_units > 0 && r.listed_units * 10 < r.demand_units * 8).length, avgSpreadBps: spreads.length ? Math.round(spreads.reduce((a, b) => a + b, 0) / spreads.length) : null, hhiBps: Math.round(hhi), topSupplier: sellers[0]?.s ?? '—', topShareBps: tot > 0 ? Math.round((sellers[0]!.q * 10_000) / tot) : 0 };
  });
  const fee = db.get<{ f: number }>('SELECT COALESCE(SUM(fee_minor),0) f FROM trades')!.f + db.get<{ f: number }>('SELECT COALESCE(SUM(fee_minor),0) f FROM contract_deliveries')!.f;
  const sumTx = (like: string, acct: string) => db.get<{ a: number }>('SELECT COALESCE(SUM(p.amount_minor),0) a FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.tx_id WHERE t.memo LIKE ? AND p.amount_minor > 0 AND p.account_id = ?', like, acct)!.a;
  void mine;
  return {
    world: db, days, anomalies, reconciliation: rec.ok, supplyStart, supplyEnd: supply(db).circulating, supplyChangeBps: Math.round(((supply(db).circulating - supplyStart) * 10_000) / supplyStart), bots, commodities: comm,
    failures: db.all<{ kind: string; reason: string; n: number }>('SELECT kind, reason, COUNT(*) n FROM failed_transactions GROUP BY kind, reason ORDER BY n DESC LIMIT 8'), contractOffers,
    exchange: { feesCollected: fee, burned: sumTx('Penny Exchange fee burn%', 'acct:burn'), swept: sumTx('Penny Exchange fee income%', 'acct:state:bristol-treasury'), trades: db.get<{ n: number }>('SELECT COUNT(*) n FROM trades')!.n, value: db.get<{ v: number }>('SELECT COALESCE(SUM(qty*price_minor),0) v FROM trades')!.v, contractDeliveries: db.get<{ n: number }>("SELECT COUNT(*) n FROM contract_deliveries WHERE status = 'delivered'")!.n, contractMisses: db.get<{ n: number }>("SELECT COUNT(*) n FROM contract_deliveries WHERE status <> 'delivered'")!.n, failedSettlements: db.get<{ n: number }>('SELECT COUNT(*) n FROM failed_transactions')!.n },
  npc: { minStateStock: [...stateMin].map(([commodity, units]) => ({ commodity, units })), insolventNpc: db.all<{ id: string }>("SELECT id FROM companies WHERE owner_kind = 'npc' AND status = 'insolvent' AND bankrupt_tick IS NULL").map((x) => x.id), bankruptcies: db.all<{ id: string }>('SELECT id FROM companies WHERE bankrupt_tick IS NOT NULL').map((x) => x.id) },
  };
}

const ec = (m: number | null) => (m === null ? '—' : `${(m / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EC`);
export function formatMarketReport(r: MarketSimReport): string {
  const L: string[] = [];
  L.push(`Market simulation: ${r.days} in-game days, 4 scripted test players against the NPC and state participants`);
  L.push(`Circulating supply ${ec(r.supplyStart)} → ${ec(r.supplyEnd)} (${(r.supplyChangeBps / 100).toFixed(2)}%) · reconciles: ${r.reconciliation} · accounting anomalies: ${r.anomalies.length}`);
  L.push('', 'Test players (net worth = cash + stock at cost, all companies of the bot)');
  for (const b of r.bots) L.push(`  ${b.bot.padEnd(18)} ${b.status.padEnd(10)} worth ${ec(b.startWorth)} → ${ec(b.endWorth)} (${b.profit >= 0 ? '+' : ''}${ec(b.profit)})  trades ${b.trades}  bought ${b.unitsBought} sold ${b.unitsSold}  fees paid ${ec(b.feesPaid)}  — ${b.strategy}`);
  L.push('', 'Commodity markets');
  L.push('  commodity     first VWAP   last VWAP    min–max VWAP            ref      volat.  volume  shortage-days  spread  HHI    top seller (share)');
  for (const c of r.commodities) L.push(`  ${c.id.padEnd(12)} ${ec(c.vwapFirst).padStart(11)} ${ec(c.vwapLast).padStart(11)}  ${(ec(c.minVwap) + '–' + ec(c.maxVwap)).padEnd(22)} ${ec(c.reference).padStart(9)}  ${(c.volatilityBps / 100).toFixed(1).padStart(5)}%  ${String(c.volume).padStart(6)}  ${String(c.shortageDays).padStart(13)}  ${c.avgSpreadBps === null ? '   —' : (c.avgSpreadBps / 100).toFixed(1).padStart(4) + '%'}  ${String(c.hhiBps).padStart(5)}  ${c.topSupplier} (${(c.topShareBps / 100).toFixed(0)}%)`);
  L.push('', `Exchange: ${r.exchange.trades} trades worth ${ec(r.exchange.value)} · fees ${ec(r.exchange.feesCollected)} (burned ${ec(r.exchange.burned)}, swept to treasury ${ec(r.exchange.swept)}) · contract deliveries ${r.exchange.contractDeliveries} ok / ${r.exchange.contractMisses} missed · failed settlements ${r.exchange.failedSettlements}`);
  for (const c of r.contractOffers) L.push(`  contract offer — ${c}`);
  for (const f of r.failures) L.push(`  refused ×${f.n}: ${f.kind} — ${f.reason}`);
  L.push(`State provisioner lowest stock: ${r.npc.minStateStock.map((m) => `${m.commodity} ${m.units}`).join(', ')}`);
  L.push(`Insolvent NPC firms: ${r.npc.insolventNpc.join(', ') || 'none'} · bankruptcies: ${r.npc.bankruptcies.join(', ') || 'none'}`);
  if (r.anomalies.length) L.push('', 'ANOMALIES', ...r.anomalies.slice(0, 10).map((a) => `  ${a}`));
  return L.join('\n');
}
