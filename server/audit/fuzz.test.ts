// @vitest-environment node
import { runFuzz } from './fuzz';

describe('seeded adversarial fuzzing (a short run in CI; long runs via `tsx server/cli.ts fuzz <seed> <players> <ticks> <actions>`)', () => {
  it('six players, 40 days, 30 mixed honest/careless/hostile commands a day: no invariant breaks, no foreign-asset success, replays are exact', () => {
    const r = runFuzz({ seed: 11, players: 6, ticks: 40, actionsPerTick: 30, auditEvery: 10 });
    expect(r.violations).toEqual([]);
    expect(r.findings.filter((f) => f.severity !== 'P2')).toEqual([]);
    expect(r.accepted).toBeGreaterThan(100); expect(r.rejected).toBeGreaterThan(100);
  }, 300_000);
  it('is reproducible: the same seed gives the same economy', () => {
    const a = runFuzz({ seed: 5, players: 3, ticks: 12, actionsPerTick: 20, auditEvery: 6 }), b = runFuzz({ seed: 5, players: 3, ticks: 12, actionsPerTick: 20, auditEvery: 6 });
    expect([a.accepted, a.rejected, a.supply.end]).toEqual([b.accepted, b.rejected, b.supply.end]);
  }, 300_000);
});
