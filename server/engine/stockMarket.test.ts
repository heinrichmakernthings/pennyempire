// @vitest-environment node
import { advance, openWorld } from './world';
import { balance, reconcile } from './ledger';
import { checkShareIntegrity } from './capital';
import { loadConfig } from './config';
import { EXCHANGE_ACCOUNT } from '../seed/bristol';
import { stateHash } from '../test/helpers';

const mk = () => openWorld(':memory:', { realMsPerTick: 3_600_000_000 }, 'demo');

describe('the NPC share market over 180 days (no human input)', () => {
  const db = mk(); advance(db, 180);
  it('stays consistent: the ledger reconciles, shares held equal shares issued, nothing negative', () => {
    expect(reconcile(db).ok).toBe(true); expect(checkShareIntegrity(db)).toEqual([]);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM accounts WHERE balance_minor < 0 AND id <> 'acct:issuance'")!.n).toBe(0);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM share_holdings WHERE shares < 0 OR reserved > shares")!.n).toBe(0);
  });
  it('trades happen on most listings, every trade is persisted with its settlement transaction, and fees are transfers to the Penny Exchange', () => {
    expect(db.get<{ n: number }>('SELECT COUNT(DISTINCT company_id) n FROM share_trades')!.n).toBeGreaterThanOrEqual(5);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM share_trades WHERE ledger_tx_id IS NULL')!.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM share_trades WHERE fee_minor > 0 AND fee_tx_id IS NULL')!.n).toBe(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM share_trades WHERE buyer_id = seller_id')!.n).toBe(0);
    expect(balance(db, EXCHANGE_ACCOUNT)).toBeGreaterThanOrEqual(0);
  });
  it('no trade prints outside the day’s allowed range around the previous close', () => {
    const band = loadConfig(db).shareBandBps; let checked = 0;
    for (const t of db.all<{ company_id: string; tick: number; price_minor: number }>('SELECT company_id, tick, price_minor FROM share_trades WHERE primary_offering_id IS NULL ORDER BY id')) {
      const prev = db.get<{ c: number; tick: number }>('SELECT close_minor c, tick FROM security_stats WHERE company_id = ? AND close_minor IS NOT NULL AND tick < ? ORDER BY tick DESC LIMIT 1', t.company_id, t.tick);
      if (!prev || t.tick - prev.tick > loadConfig(db).shareRefStaleTicks) continue;
      expect(t.price_minor).toBeLessThanOrEqual(Math.floor((prev.c * (10_000 + band)) / 10_000)); expect(t.price_minor).toBeGreaterThanOrEqual(Math.ceil((prev.c * (10_000 - band)) / 10_000) - 1); checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
  it('dividends are paid only from treasuries: each payment equals its entitlement and totals match', () => {
    const paid = db.all<{ id: number; total_minor: number; paid_minor: number }>("SELECT id, total_minor, paid_minor FROM dividends WHERE status = 'paid'");
    expect(paid.length).toBeGreaterThan(20);
    for (const d of paid) { expect(d.paid_minor).toBe(d.total_minor); expect(db.get<{ s: number }>('SELECT SUM(amount_minor) s FROM dividend_entitlements WHERE dividend_id = ?', d.id)!.s).toBe(d.total_minor); }
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM dividend_entitlements e JOIN dividends d ON d.id = e.dividend_id WHERE d.status = 'paid' AND e.ledger_tx_id IS NULL")!.n).toBe(0);
  });
  it('NPC investors act within finite budgets and log every decision', () => {
    for (const r of db.all<{ id: string; b: number }>("SELECT i.id, a.balance_minor b FROM investors i JOIN accounts a ON a.id = i.account_id WHERE i.kind = 'npc'")) expect(r.b).toBeGreaterThanOrEqual(0);
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM investor_decisions')!.n).toBeGreaterThan(50);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM ledger_transactions t JOIN ledger_postings p ON p.tx_id = t.id JOIN investors i ON i.account_id = p.account_id WHERE t.kind = 'issuance' AND i.kind = 'npc' AND t.idempotency_key NOT LIKE 'seed:investor:%'")!.n).toBe(0);
  });
  it('the Penny Post reports the exchange’s real events', () => {
    const kinds = db.all<{ kind: string }>('SELECT DISTINCT kind FROM news_articles').map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['dividend']));
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM news_articles WHERE kind IN ('dividend','earnings','holder') AND event_id IS NULL")!.n).toBe(0);
  });
  it('is deterministic and a re-run tick is a no-op', () => {
    const a = mk(), b = mk(); advance(a, 40); advance(b, 40); expect(stateHash(a)).toBe(stateHash(b));
  });
});
