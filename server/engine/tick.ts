import type { Sql } from '../db/sql';
import { loadConfig, gameDate } from './config';
import { allocateDemand, type Seller } from './demand';
import { InventoryError, addStock, freeStock, removeStock, stock } from './inventory';
import { LedgerError, available, balance, destroy, issue, supply, transfer, type LedgerKind, type TickCtx } from './ledger';
import { MarketError, cancelOrder, depth, placeOrder, type FillEvent } from './market';
import { logEvent, logFailure, takeSnapshot } from './stats';

interface Co {
  id: string; name: string; city_id: string; industry_id: string; owner_kind: 'player' | 'npc' | 'state'; owner_id: string; treasury_account_id: string; status: 'operating' | 'paused' | 'insolvent';
  retail_commodity_id: string | null; price_minor: number; quality: 'basic' | 'standard' | 'premium'; employees: number; max_employees: number; wage_minor: number; capacity_batches: number;
  storage_cap_units: number; property_minor: number; marketing_minor: number; reputation_bps: number; unpaid_minor: number; shortfall_ticks: number;
}
interface Line { company_id: string; recipe_id: string; planned_batches: number; ask_price_minor: number; output_commodity_id: string; output_units: number; energy_units: number; ref_price: number }
interface Stat { tax: number; revenue: number; cogs: number; labour: number; property: number; marketing: number; fees: number; energyPaid: number; inputPurchases: number; unitsProduced: number; unitsSold: number; energyDue: number; demanded: number; stockedOut: boolean }
const newStat = (): Stat => ({ tax: 0, revenue: 0, cogs: 0, labour: 0, property: 0, marketing: 0, fees: 0, energyPaid: 0, inputPurchases: 0, unitsProduced: 0, unitsSold: 0, energyDue: 0, demanded: 0, stockedOut: false });

export type TickResult = { status: 'complete'; tick: number; summary: TickSummary } | { status: 'skipped'; tick: number; reason: string };
export interface TickSummary { tick: number; issuedMinor: number; destroyedMinor: number; circulatingMinor: number; trades: number; tradeValueMinor: number; consumerSpendMinor: number; unmetUnits: number; unitsProduced: number; insolvencies: number; failures: number; supportMinor: number }

/** Errors that represent a refused economic action (not a bug): they are logged and the tick continues deterministically. */
const isEconomic = (e: unknown) => e instanceof LedgerError || e instanceof MarketError || e instanceof InventoryError;

/**
 * One economic tick = one in-game day. Pure function of (database state, config, tick number): no wall-clock, no randomness.
 * Atomic (a failure rolls back the whole day), idempotent (an already-processed tick is a no-op) and strictly ordered.
 */
export function runTick(db: Sql, n: number, hooks: { phase?: (name: string) => void } = {}): TickResult {
  return db.transaction(() => {
    const last = db.get<{ last_tick: number }>('SELECT last_tick FROM engine_state WHERE id = 1')!.last_tick;
    if (n <= last) return { status: 'skipped', tick: n, reason: 'already_processed' } as const;
    if (n !== last + 1) throw new Error(`Tick ${n} is out of order; last completed tick is ${last}`);
    const t0 = Date.now();
    const cfg = loadConfig(db);
    const ctx: TickCtx = { tick: n, gameDate: gameDate(cfg, n), actor: 'engine' };
    db.run("INSERT INTO ticks (tick, status, game_date, started_at) VALUES (?, 'running', ?, ?)", n, ctx.gameDate, ctx.gameDate);
    const phase = (p: string) => hooks.phase?.(p);
    let seq = 0; const key = (p: string) => `t${n}:${p}:${seq++}`;
    const stats = new Map<string, Stat>(); const st = (id: string) => { let s = stats.get(id); if (!s) { s = newStat(); stats.set(id, s); } return s; };
    const failures = { n: 0 };
    let trades = 0, tradeValue = 0, consumerSpend = 0, unmet = 0, support = 0, insolvencies = 0;
    const safe = (kind: string, subject: string, fn: () => void) => {
      try { db.transaction(fn); } catch (e) {
        if (!isEconomic(e)) throw e;
        failures.n++; logFailure(db, n, kind, (e as Error).message, null, { subject });
        logEvent(db, n, 'failed_transaction', 'warning', subject, `${kind}: ${(e as Error).message}`);
      }
    };
    const pay = (kind: Exclude<LedgerKind, 'issuance' | 'sink' | 'sink_fee'>, from: string, to: string, amount: number, memo: string) => { if (amount > 0) transfer(db, ctx, key(kind), from, to, amount, kind, memo); };

    const all = db.all<Co>('SELECT * FROM companies ORDER BY id');
    const rot = n % Math.max(1, all.length);
    const order = [...all.slice(rot), ...all.slice(0, rot)];            // fair rotation: nobody always shops first
    const byId = new Map(all.map((c) => [c.id, c]));
    const linesOf = (id: string) => db.all<Line>('SELECT l.company_id, l.recipe_id, l.planned_batches, l.ask_price_minor, r.output_commodity_id, r.output_units, r.energy_units, cm.reference_price_minor ref_price FROM production_lines l JOIN recipes r ON r.id = l.recipe_id JOIN commodities cm ON cm.id = r.output_commodity_id WHERE l.company_id = ? ORDER BY l.recipe_id', id);
    const inputsOf = (recipe: string) => db.all<{ commodity_id: string; units: number }>('SELECT commodity_id, units FROM recipe_inputs WHERE recipe_id = ? ORDER BY commodity_id', recipe);
    const refPrice = (c: string) => db.get<{ p: number }>('SELECT reference_price_minor p FROM commodities WHERE id = ?', c)!.p;
    const stateCo = (industry: string) => all.find((c) => c.owner_kind === 'state' && c.industry_id === industry);
    const energyCo = stateCo('utility'), estatesCo = stateCo('property'), mediaCo = stateCo('media'), provisions = stateCo('wholesale');
    const energyPrice = refPrice(cfg.energyCommodityId);
    const effCapacity = (c: Co) => (c.max_employees === 0 ? 0 : Math.floor((c.capacity_batches * c.employees) / c.max_employees));
    const city = db.get<{ id: string; population: number; households_account_id: string; treasury_account_id: string }>('SELECT id, population, households_account_id, treasury_account_id FROM cities ORDER BY id LIMIT 1')!;
    const onFill = (f: FillEvent) => { trades++; tradeValue += f.price * f.qty; st(f.seller).revenue += f.price * f.qty; st(f.seller).cogs += f.cost; st(f.seller).fees += f.fee; st(f.seller).unitsSold += f.qty; st(f.buyer).inputPurchases += f.price * f.qty; };

    /* A. Income: the only coins entering the economy during a tick are the citizens' income grant (issuance); everything else moves. */
    phase('income');
    // Transparent inflation controller: the grant shrinks as circulating supply exceeds its target and grows (to at most 2×) when below it.
    const baseStipend = Math.floor(city.population / 1_000) * cfg.stipendPerThousandMinor;
    const factorBps = cfg.supplyTargetMinor > 0 ? Math.max(0, Math.min(20_000, 10_000 + Math.floor(((cfg.supplyTargetMinor - supply(db).circulating) * cfg.stipendGainBps) / cfg.supplyTargetMinor))) : 10_000;
    const stipend = Math.floor((baseStipend * factorBps) / 10_000);
    if (stipend > 0) issue(db, ctx, key('stipend'), city.households_account_id, stipend, 'NPC citizen income grant');
    pay('state_payment', city.treasury_account_id, city.households_account_id, Math.floor((available(db, city.treasury_account_id) * cfg.civilPayrollBps) / 10_000), 'civil service payroll');

    /* B. State provisioner: bounded fallback stock, created from nothing but sold for coins that go to the treasury. */
    phase('state_supply');
    if (provisions) for (const c of ['wheat', 'milk', 'flour', 'cheese']) {
      const add = Math.min(cfg.stateSupplyPerTick, cfg.stateSupplyCap - stock(db, provisions.id, c).qty);
      if (add > 0) addStock(db, ctx, provisions.id, c, add, 0, 'state_supply', 'fallback supply');
    }

    /* C. Transparent NPC rules (players are never touched):
     *   pricing    — full-cost-plus: target = (unit cost basis + this line's fixed costs ÷ expected units) × 105%, expected units =
     *                max(units sold last tick, half of staffed capacity). The price moves one step toward target and only falls while stock > 40% of storage;
     *   production — plan enough batches to replace last tick's sales plus top stock up to two ticks of cover; moves at most ±2 batches per tick;
     *   staffing   — employees follow planned output (hire/fire to demand): ceil(planned batches × max staff ÷ full-staff capacity), at least 1. */
    phase('npc_rules');
    for (const c of order) {
      if (c.owner_kind !== 'npc' || c.status !== 'operating') continue;
      const lines = linesOf(c.id); if (lines.length === 0) continue;
      const fixedLine = Math.ceil((c.employees * c.wage_minor + c.property_minor + c.marketing_minor) / lines.length);
      let capLeft = c.capacity_batches; let plannedTotal = 0;
      for (const l of lines) {
        const inv = stock(db, c.id, l.output_commodity_id);
        const soldLast = db.get<{ u: number }>("SELECT COALESCE(-SUM(delta),0) u FROM inventory_movements WHERE tick = ? AND company_id = ? AND commodity_id = ? AND reason IN ('trade_out','consumer_purchase','public_works')", n - 1, c.id, l.output_commodity_id)!.u;
        const expected = Math.max(1, soldLast, Math.floor((c.capacity_batches * l.output_units) / lines.length / 4));
        const unitCost = inv.qty > 0 ? Math.floor(inv.value_minor / inv.qty) : Math.floor(l.ref_price / 2);
        const target = Math.ceil(((unitCost + Math.ceil(fixedLine / expected)) * 105) / 100);
        const stockPct = Math.floor((inv.qty * 100) / c.storage_cap_units);
        const current = c.retail_commodity_id ? c.price_minor : l.ask_price_minor;
        let next = current;
        if (current < target) next = Math.min(target, Math.ceil((current * (10_000 + cfg.npcPriceStepBps)) / 10_000));
        else if (current > target && stockPct > 40) next = Math.max(target, Math.floor((current * (10_000 - cfg.npcPriceStepBps)) / 10_000));
        if (c.retail_commodity_id) {
          const lim = db.get<{ a: number; b: number }>('SELECT min_price_minor a, max_price_minor b FROM companies WHERE id = ?', c.id)!;
          next = Math.max(lim.a, Math.min(lim.b, next)); if (next !== c.price_minor) { db.run('UPDATE companies SET price_minor = ? WHERE id = ?', next, c.id); c.price_minor = next; }
        } else {
          next = Math.min(l.ref_price * 2, Math.max(Math.floor(l.ref_price / 2), next)); if (next !== l.ask_price_minor) db.run('UPDATE production_lines SET ask_price_minor = ? WHERE company_id = ? AND recipe_id = ?', next, c.id, l.recipe_id);
        }
        const desired = Math.ceil((soldLast + Math.max(0, 2 * soldLast - inv.qty)) / l.output_units);
        const planned = Math.max(1, Math.min(Math.max(1, capLeft), Math.max(l.planned_batches - 2, Math.min(l.planned_batches + 2, desired))));
        capLeft = Math.max(0, capLeft - planned); plannedTotal += planned;
        if (planned !== l.planned_batches) db.run('UPDATE production_lines SET planned_batches = ? WHERE company_id = ? AND recipe_id = ?', planned, c.id, l.recipe_id);
      }
      const staff = Math.max(1, Math.min(c.max_employees, Math.ceil((plannedTotal * c.max_employees) / Math.max(1, c.capacity_batches))));
      if (staff !== c.employees) { db.run('UPDATE companies SET employees = ? WHERE id = ?', staff, c.id); c.employees = staff; }
    }

    /* D. Refresh system sell orders (player-placed resting orders have idempotency keys and are left alone). */
    phase('listings');
    for (const o of db.all<{ id: number }>("SELECT id FROM orders WHERE status = 'open' AND idempotency_key LIKE 'sys:%'")) cancelOrder(db, o.id);
    for (const c of order) {
      if (c.status !== 'operating') continue;
      safe('listing', c.id, () => {
        if (c.id === provisions?.id) {
          for (const com of ['wheat', 'milk', 'flour', 'cheese']) { const q = freeStock(db, c.id, com); if (q > 0) placeOrder(db, ctx, cfg.exchangeFeeBps, { company: c.id, commodity: com, side: 'sell', price: Math.floor((refPrice(com) * cfg.stateSupplyMarkupBps) / 10_000), qty: q, key: `sys:${n}:${c.id}:${com}` }, onFill); }
        } else if (!c.retail_commodity_id) {
          for (const l of linesOf(c.id)) { const q = freeStock(db, c.id, l.output_commodity_id); if (q > 0) placeOrder(db, ctx, cfg.exchangeFeeBps, { company: c.id, commodity: l.output_commodity_id, side: 'sell', price: l.ask_price_minor, qty: q, key: `sys:${n}:${c.id}:${l.output_commodity_id}` }, onFill); }
        }
      });
    }

    /* E. Procurement: buy missing inputs (immediate-or-cancel limit orders) for as many planned batches as cash and the book allow. */
    phase('procurement');
    const plan = (c: Co) => {
      let capLeft = effCapacity(c); const out: { line: Line; batches: number }[] = [];
      for (const l of linesOf(c.id)) {
        const room = Math.floor((c.storage_cap_units - stock(db, c.id, l.output_commodity_id).qty) / l.output_units);
        const b = Math.max(0, Math.min(l.planned_batches, capLeft, room)); capLeft -= b; out.push({ line: l, batches: b });
      }
      return out;
    };
    for (const c of order) {
      if (c.status !== 'operating') continue;
      safe('procurement', c.id, () => {
        let budget = Math.max(0, available(db, c.treasury_account_id) - c.employees * c.wage_minor - c.property_minor - c.marketing_minor);
        for (const { line, batches } of plan(c)) {
          const inputs = inputsOf(line.recipe_id); if (inputs.length === 0 || batches === 0) continue;
          const energyCost = line.energy_units * energyPrice;
          for (let b = batches; b > 0; b--) {
            let cost = b * energyCost, ok = true; const buys: { com: string; qty: number }[] = [];
            for (const i of inputs) {
              const deficit = Math.max(0, b * i.units - freeStock(db, c.id, i.commodity_id)); if (deficit === 0) continue;
              const limit = Math.floor((refPrice(i.commodity_id) * cfg.procurementLimitBps) / 10_000);
              const d = depth(db, i.commodity_id, limit, c.id, deficit);
              if (d.qty < deficit) { ok = false; break; }
              cost += d.cost; buys.push({ com: i.commodity_id, qty: deficit });
            }
            if (!ok || cost > budget) continue;
            for (const bu of buys) placeOrder(db, ctx, cfg.exchangeFeeBps, { company: c.id, commodity: bu.com, side: 'buy', price: Math.floor((refPrice(bu.com) * cfg.procurementLimitBps) / 10_000), qty: bu.qty, ioc: true }, onFill);
            budget -= cost; break;
          }
        }
      });
    }

    /* F. Production: batches limited by staffing, storage, inputs. Output cost basis = inputs consumed + energy (capitalised). */
    phase('production');
    for (const c of order) {
      if (c.status !== 'operating') continue;
      safe('production', c.id, () => {
        for (const { line, batches } of plan(c)) {
          const inputs = inputsOf(line.recipe_id);
          const b = Math.min(batches, ...inputs.map((i) => Math.floor(freeStock(db, c.id, i.commodity_id) / i.units)));
          if (b <= 0) continue;
          let basis = 0;
          for (const i of inputs) basis += removeStock(db, ctx, c.id, i.commodity_id, b * i.units, 'production_input', line.recipe_id);
          const energy = b * line.energy_units * energyPrice; st(c.id).energyDue += energy;
          addStock(db, ctx, c.id, line.output_commodity_id, b * line.output_units, basis + energy, 'production_output', line.recipe_id);
          st(c.id).unitsProduced += b * line.output_units;
        }
      });
    }

    /* G. Consumer demand: every budget comes from a named funder account and is capped by that account's balance. */
    phase('consumers');
    const rules = db.all<{ id: string; label: string; commodity_id: string; funder_account_id: string; mode: 'pool_share' | 'fixed'; amount: number; payment_kind: 'consumer_sale' | 'state_payment'; goods_reason: 'consumer_purchase' | 'public_works'; price_sensitivity: number }>('SELECT * FROM demand_rules WHERE city_id = ? ORDER BY id', city.id);
    const startBal = new Map<string, number>(); for (const r of rules) if (!startBal.has(r.funder_account_id)) startBal.set(r.funder_account_id, available(db, r.funder_account_id));
    const committed = new Map<string, number>();
    for (const r of rules) {
      const base = startBal.get(r.funder_account_id)!;
      const want = r.mode === 'pool_share' ? Math.floor((base * r.amount) / 10_000) : r.amount;
      const budget = Math.max(0, Math.min(want, base - (committed.get(r.funder_account_id) ?? 0), available(db, r.funder_account_id)));
      committed.set(r.funder_account_id, (committed.get(r.funder_account_id) ?? 0) + budget);
      const ref = refPrice(r.commodity_id);
      const sellers = order.filter((c) => c.status === 'operating' && c.retail_commodity_id === r.commodity_id);
      for (const c of sellers) if (freeStock(db, c.id, r.commodity_id) === 0) st(c.id).stockedOut = true;
      const live = sellers.filter((c) => freeStock(db, c.id, r.commodity_id) > 0);
      const res = allocateDemand(budget, ref, r.price_sensitivity, live.map((c): Seller => ({ id: c.id, price: c.price_minor, stock: freeStock(db, c.id, r.commodity_id), quality: c.quality, reputationBps: c.reputation_bps, marketingMinor: c.marketing_minor })));
      let spent = 0, sold = 0;
      for (const a of res.allocations) {
        const c = byId.get(a.id)!; st(c.id).demanded += Math.floor((res.unitsWanted * a.share) / 10_000);
        if (a.units <= 0) continue;
        safe('consumer_sale', c.id, () => {
          pay(r.payment_kind, r.funder_account_id, c.treasury_account_id, a.spend, `${a.units} ${r.commodity_id} to ${r.id}`);
          const cost = removeStock(db, ctx, c.id, r.commodity_id, a.units, r.goods_reason, r.id);
          const s = st(c.id); s.revenue += a.spend; s.cogs += cost; s.unitsSold += a.units; spent += a.spend; sold += a.units;
        });
      }
      consumerSpend += spent; unmet += Math.max(0, res.unitsWanted - sold);
      db.run('INSERT INTO demand_tick_stats (tick, rule_id, budget_minor, spent_minor, units_wanted, units_sold, unmet_units) VALUES (?,?,?,?,?,?,?)', n, r.id, budget, spent, res.unitsWanted, sold, Math.max(0, res.unitsWanted - sold));
      if (res.unitsWanted > 0 && sold * 10 < res.unitsWanted * 7) logEvent(db, n, 'shortage', 'warning', r.commodity_id, `${r.label}: only ${sold} of ${res.unitsWanted} units could be served`, { rule: r.id });
    }

    /* H. Operating expenses (accrual): wages → households; energy, rent, advertising → state enterprises. Unpaid amounts become arrears. */
    phase('expenses');
    for (const c of order) {
      if (c.status !== 'operating') continue;
      const s = st(c.id);
      s.labour = c.employees * c.wage_minor; s.property = c.property_minor; s.marketing = c.marketing_minor;
      const due: { to: string; amount: number; bucket: 'labour' | 'energy' | 'property' | 'marketing'; payee: Co | null }[] = [
        { to: city.households_account_id, amount: s.labour, bucket: 'labour', payee: null },
        { to: energyCo?.treasury_account_id ?? city.treasury_account_id, amount: s.energyDue, bucket: 'energy', payee: energyCo ?? null },
        { to: estatesCo?.treasury_account_id ?? city.treasury_account_id, amount: s.property, bucket: 'property', payee: estatesCo ?? null },
        { to: mediaCo?.treasury_account_id ?? city.treasury_account_id, amount: s.marketing, bucket: 'marketing', payee: mediaCo ?? null },
      ];
      const total = due.reduce((a, d) => a + d.amount, 0);
      let cash = available(db, c.treasury_account_id);
      safe('liquidity_support', c.id, () => {
        if (((cfg.npcSupportMinor > 0 && c.owner_kind === 'npc') || c.owner_kind === 'state') && cash < total) {
          const cap = c.owner_kind === 'state' ? total - cash : cfg.npcSupportMinor;
          const help = Math.min(cap, total - cash, available(db, city.treasury_account_id));
          if (help > 0) { pay('capital_injection', city.treasury_account_id, c.treasury_account_id, help, `state liquidity support for ${c.name}`); cash += help; support += help; logEvent(db, n, 'state_support', 'warning', c.id, `State gave ${c.name} ${help / 100} EC liquidity support`); }
        }
      });
      let unpaid = 0;
      for (const d of due) {
        const p = Math.min(d.amount, cash);
        if (p > 0) {
          safe('operating_cost', c.id, () => { pay('operating_cost', c.treasury_account_id, d.to, p, `${d.bucket} for ${c.name}`); });
          cash -= p; if (d.bucket === 'energy') s.energyPaid += p; if (d.payee) st(d.payee.id).revenue += p;
        }
        unpaid += d.amount - p;
      }
      db.run('UPDATE companies SET unpaid_minor = unpaid_minor + ?, shortfall_ticks = ? WHERE id = ?', unpaid, unpaid > 0 ? c.shortfall_ticks + 1 : 0, c.id);
      if (unpaid > 0) logEvent(db, n, 'unpaid_expenses', 'warning', c.id, `${c.name} could not pay ${unpaid / 100} EC of operating costs`);
    }
    // Corporation tax on positive net profit and an idle-cash levy above the operating reserve: both are transfers to the treasury (which the state
    // pays back out as civil payroll). They recycle money that would otherwise pool in company accounts and starve consumer demand.
    for (const c of order) {
      if (c.owner_kind === 'state' || c.status !== 'operating') continue;
      const s = st(c.id);
      const profit = s.revenue - s.cogs - s.labour - s.property - s.marketing - s.fees;
      const tax = profit > 0 ? Math.floor((profit * cfg.corporationTaxBps) / 10_000) : 0;
      const reserve = 20 * (c.employees * c.wage_minor + c.property_minor + c.marketing_minor) + 200_000;
      const levy = Math.floor((Math.max(0, available(db, c.treasury_account_id) - reserve) * cfg.idleCashLevyBps) / 10_000);
      const due = Math.min(tax + levy, available(db, c.treasury_account_id));
      if (due > 0) safe('tax', c.id, () => pay('state_payment', c.treasury_account_id, city.treasury_account_id, due, `corporation tax and idle-cash levy: ${c.name}`));
      s.tax = Math.min(tax, due);
    }
    // NPC shareholders are citizens: cash above a reserve of N ticks of fixed costs is paid out to households (a transfer, never minted).
    for (const c of order) {
      if (c.owner_kind !== 'npc' || c.status !== 'operating' || cfg.npcPayoutBps === 0) continue;
      const reserve = cfg.npcReserveTicks * (c.employees * c.wage_minor + c.property_minor + c.marketing_minor) + 200_000;
      const excess = available(db, c.treasury_account_id) - reserve;
      const dividend = Math.floor((Math.max(0, excess) * cfg.npcPayoutBps) / 10_000);
      if (dividend > 0) safe('dividend', c.id, () => pay('transfer', c.treasury_account_id, city.households_account_id, dividend, `${c.name} dividend to NPC shareholders`));
    }
    // State enterprises hold a working reserve; surplus returns to the treasury as a transfer (NOT destroyed).
    for (const c of order) {
      if (c.owner_kind !== 'state' || c.status !== 'operating') continue;
      const surplus = available(db, c.treasury_account_id) - cfg.enterpriseReserveMinor;
      if (surplus > 0) safe('sweep', c.id, () => pay('transfer', c.treasury_account_id, city.treasury_account_id, surplus, `${c.name} surplus to treasury`));
    }
    phase('state_sink');
    const burn = Math.floor((Math.max(0, available(db, city.treasury_account_id) - cfg.stateReserveMinor) * cfg.stateBurnBps) / 10_000);
    if (burn > 0) destroy(db, ctx, key('upkeep'), city.treasury_account_id, burn, 'infrastructure upkeep (explicit burn)');

    /* J. Reputation and insolvency boundaries. */
    phase('reputation_insolvency');
    for (const c of order) {
      if (c.status !== 'operating') continue;
      const s = st(c.id);
      if (c.retail_commodity_id) {
        let rep = c.reputation_bps;
        if (s.stockedOut) rep -= 50; else if (s.demanded > 0 && s.unitsSold * 100 >= s.demanded * 95) rep += 20; else if (s.demanded > 0 && s.unitsSold * 100 < s.demanded * 70) rep -= 30;
        db.run('UPDATE companies SET reputation_bps = ? WHERE id = ?', Math.max(1_000, Math.min(9_500, rep)), c.id);
      }
      const shortfall = db.get<{ shortfall_ticks: number }>('SELECT shortfall_ticks FROM companies WHERE id = ?', c.id)!.shortfall_ticks;
      if (shortfall >= cfg.insolvencyAfterTicks) {
        db.run("UPDATE companies SET status = 'insolvent', revision = revision + 1 WHERE id = ?", c.id); insolvencies++;
        logEvent(db, n, 'insolvency', 'error', c.id, `${c.name} is insolvent after ${shortfall} consecutive ticks of unpaid operating costs`);
      }
    }

    /* K. History + snapshot. */
    phase('history');
    let produced = 0;
    for (const c of all) {
      const s = stats.get(c.id) ?? newStat(); produced += s.unitsProduced;
      const row = db.get<{ status: string; unpaid_minor: number }>('SELECT status, unpaid_minor FROM companies WHERE id = ?', c.id)!;
      const invValue = db.get<{ v: number }>('SELECT COALESCE(SUM(value_minor),0) v FROM inventory WHERE company_id = ?', c.id)!.v;
      const gross = s.revenue - s.cogs, net = gross - s.labour - s.property - s.marketing - s.fees - s.tax;
      db.run('INSERT INTO company_tick_stats (tick, company_id, revenue_minor, cogs_minor, labour_minor, property_minor, marketing_minor, fees_minor, tax_minor, energy_paid_minor, input_purchases_minor, gross_profit_minor, net_profit_minor, cash_end_minor, inventory_value_minor, units_produced, units_sold, unpaid_end_minor, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        n, c.id, s.revenue, s.cogs, s.labour, s.property, s.marketing, s.fees, s.tax, s.energyPaid, s.inputPurchases, gross, net, balance(db, c.treasury_account_id), invValue, s.unitsProduced, s.unitsSold, row.unpaid_minor, row.status);
    }
    takeSnapshot(db, n);
    const snap = db.get<{ issued_tick_minor: number; destroyed_tick_minor: number; circulating_minor: number }>('SELECT * FROM supply_snapshots WHERE tick = ?', n)!;
    const summary: TickSummary = { tick: n, issuedMinor: snap.issued_tick_minor, destroyedMinor: snap.destroyed_tick_minor, circulatingMinor: snap.circulating_minor, trades, tradeValueMinor: tradeValue, consumerSpendMinor: consumerSpend, unmetUnits: unmet, unitsProduced: produced, insolvencies, failures: failures.n, supportMinor: support };
    db.run("UPDATE ticks SET status = 'complete', finished_at = ?, duration_ms = ?, summary_json = ? WHERE tick = ?", ctx.gameDate, Date.now() - t0, JSON.stringify(summary), n);
    db.run('UPDATE engine_state SET last_tick = ? WHERE id = 1', n);
    return { status: 'complete', tick: n, summary } as const;
  });
}
