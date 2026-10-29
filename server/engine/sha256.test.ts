// @vitest-environment node
import { createHash, createHmac } from 'node:crypto';
import { hmacSha256, safeEqual, secureRandomInt, sha256 } from './sha256';
describe('sha256 / hmac / secure random', () => {
  it('match the reference implementation', () => {
    for (const m of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'Penny Empire £ ✓']) { expect(sha256(m)).toBe(createHash('sha256').update(m).digest('hex')); expect(hmacSha256('secret', m)).toBe(createHmac('sha256', 'secret').update(m).digest('hex')); }
    expect(hmacSha256('k'.repeat(100), 'm')).toBe(createHmac('sha256', 'k'.repeat(100)).update('m').digest('hex'));
    expect(safeEqual('a', 'a')).toBe(true); expect(safeEqual('a', 'b')).toBe(false);
  });
  it('secureRandomInt stays in range and is roughly uniform', () => {
    const counts = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < 6000; i++) counts[secureRandomInt(6)]!++;
    expect(counts.every((c) => c > 800 && c < 1200)).toBe(true); expect(() => secureRandomInt(0)).toThrow();
  });
});
