// @vitest-environment node
import { heavyTrading, population } from './alphaStress';

describe('private-alpha load (the 100-player and shock runs are in `npm run alpha-stress`)', () => {
  it('ten players join and play through the session layer with every invariant holding', async () => {
    const r = await population(10); expect(r.problems).toEqual([]); expect(r.facts.companiesFounded).toBeGreaterThanOrEqual(9);
  }, 120_000);
  it('300 simultaneous orders from ten companies leave the books, inventory and reservations consistent', async () => {
    const r = await heavyTrading(); expect(r.problems).toEqual([]); expect(r.facts.accepted).toBe(300);
  }, 120_000);
});
