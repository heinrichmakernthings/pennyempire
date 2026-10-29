/** Small pure-JS SHA-256 and HMAC-SHA-256 (hex), so the engine needs no Node-only crypto and runs unchanged on Cloudflare Workers. Used to sign mock-provider attestations and to commit to draw inputs. */
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const utf8 = (s: string) => new TextEncoder().encode(s);
function sha256Bytes(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length, padded = new Uint8Array((((len + 9 + 63) >> 6) << 6)); padded.set(data); padded[len] = 0x80;
  const dv = new DataView(padded.buffer); dv.setUint32(padded.length - 8, Math.floor((len * 8) / 0x100000000)); dv.setUint32(padded.length - 4, (len * 8) >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3), s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10); w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7)), ch = (e! & f!) ^ (~e! & g!), t1 = (hh! + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10)), mj = (a! & b!) ^ (a! & c!) ^ (b! & c!), t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a!) >>> 0; h[1] = (h[1]! + b!) >>> 0; h[2] = (h[2]! + c!) >>> 0; h[3] = (h[3]! + d!) >>> 0; h[4] = (h[4]! + e!) >>> 0; h[5] = (h[5]! + f!) >>> 0; h[6] = (h[6]! + g!) >>> 0; h[7] = (h[7]! + hh!) >>> 0;
  }
  const out = new Uint8Array(32); const o = new DataView(out.buffer); h.forEach((v, i) => o.setUint32(i * 4, v)); return out;
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const sha256 = (s: string) => hex(sha256Bytes(utf8(s)));
export function hmacSha256(key: string, msg: string): string {
  let k: Uint8Array = utf8(key); if (k.length > 64) k = sha256Bytes(k);
  const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c); k.forEach((b, i) => { ipad[i] = ipad[i]! ^ b; opad[i] = opad[i]! ^ b; });
  const inner = sha256Bytes(new Uint8Array([...ipad, ...utf8(msg)])); return hex(sha256Bytes(new Uint8Array([...opad, ...inner])));
}
/** Constant-time string comparison for signatures. */
export const safeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
/** Uniform random integer in [0, max) from the platform's cryptographically secure generator (rejection sampling: no modulo bias). */
export function secureRandomInt(max: number): number {
  if (!Number.isSafeInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('max must be 1..2^32');
  const limit = Math.floor(2 ** 32 / max) * max; const buf = new Uint32Array(1);
  for (;;) { globalThis.crypto.getRandomValues(buf); if (buf[0]! < limit) return buf[0]! % max; }
}
export const randomToken = (bytes = 16) => { const b = new Uint8Array(bytes); globalThis.crypto.getRandomValues(b); return hex(b); };
