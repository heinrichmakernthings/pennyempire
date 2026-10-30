import { create } from 'zustand';

export interface AuthUser { username: string; displayName: string; role: 'player' | 'admin'; playerId: string; settings: { reducedMotion?: boolean; notifications?: boolean; compactNumbers?: boolean; hideOnboarding?: boolean } }
export interface ApiResult<T = Record<string, unknown>> { status: number; body: T & { ok?: boolean; error?: { code: string; message: string } } }

/** JSON request to the game server; cookies carry the session (HttpOnly, never readable from script). */
export async function request<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const res = await fetch(path, { method: init.method ?? 'GET', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  let body: unknown = {}; try { body = await res.json(); } catch { body = { ok: false, error: { code: 'UNAVAILABLE', message: `Server returned ${res.status}` } }; }
  return { status: res.status, body: body as ApiResult<T>['body'] };
}
export const errorText = (r: ApiResult<unknown>) => r.body.error?.message ?? `Request failed (${r.status})`;

interface AuthState {
  status: 'unknown' | 'signed-out' | 'signed-in' | 'open';
  user: AuthUser | null;
  check(): Promise<void>;
  setUser(u: AuthUser | null): void;
  signOut(all?: boolean): Promise<void>;
}
/** `open` = local single-player dev server (no accounts required). */
export const useAuth = create<AuthState>((set) => ({
  status: 'unknown', user: null,
  async check() {
    try {
      const r = await request<{ authenticated: boolean; requireAuth: boolean; user: AuthUser | null }>('/api/auth/me');
      if (r.status !== 200) { set({ status: 'open', user: null }); return; }
      set({ status: r.body.authenticated ? 'signed-in' : r.body.requireAuth ? 'signed-out' : 'open', user: r.body.user });
    } catch { set({ status: 'open', user: null }); }
  },
  setUser: (u) => set({ user: u, status: u ? 'signed-in' : 'signed-out' }),
  async signOut(all = false) { await request(all ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST' }); set({ user: null, status: 'signed-out' }); },
}));
