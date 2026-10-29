/** Password hashing and secret generation on WebCrypto, which both Node 20+ and Cloudflare Workers provide natively (no Node-only modules). */
import { sha256 } from '../engine/sha256';

export const PBKDF2_ITERATIONS = 100_000;          // Workers caps PBKDF2 at 100k iterations
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** A URL-safe random secret (session tokens, invite and reset codes). */
export function randomSecret(bytes = 32): string { const b = new Uint8Array(bytes); crypto.getRandomValues(b); return hex(b); }
/** Secrets at rest are only ever stored as digests. */
export const digest = (secret: string) => sha256(`pennyempire:${secret}`);

export async function hashPassword(password: string, saltHex = randomSecret(16), iterations = PBKDF2_ITERATIONS): Promise<{ hash: string; salt: string; iterations: number }> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations }, key, 256);
  return { hash: hex(new Uint8Array(bits)), salt: saltHex, iterations };
}
