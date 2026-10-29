// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASE_GATES, assertSimulatedProvider } from '../engine/releaseGates';
import { world } from '../test/shareHelpers';

describe('real-money release gates (Prompt 11 §13)', () => {
  it('every live-money gate is closed', () => { expect(Object.values(RELEASE_GATES).every((v) => v === false)).toBe(true); });
  it('only simulated providers are accepted', () => { expect(() => assertSimulatedProvider('stripe')).toThrow(/release gate/); expect(() => assertSimulatedProvider('mock-sandbox')).not.toThrow(); });
  it('no wallet, reward, membership or lottery module makes a network call', () => {
    const dir = join(__dirname, '../engine');
    for (const f of readdirSync(dir).filter((x) => /^(gbp|rewards|membership|lottery|commercial|treasuryAdmin|walletCommands)/.test(x) && !x.endsWith('.test.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\bfetch\(|XMLHttpRequest|node:https?|WebSocket/);
    }
  });
  it('the GBP ledger refuses any non-simulated transaction at the database level', () => {
    const db = world();
    expect(() => db.run("INSERT INTO gbp_transactions (idempotency_key, kind, status, memo, actor, tick, created_ms, simulated) VALUES ('x','deposit','posted','m','a',0,0,0)")).toThrow();
  });
});
