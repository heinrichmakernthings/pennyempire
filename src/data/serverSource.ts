import type { Command, CommandResult, Company, QuoteRequest } from '@/contracts/game-state';
import { assertWireIntegrity } from '@/domain/integrity';
import type { ClientScreenState, FinancialRow, GameDataSource, Loaded, MapMeta, QuoteResponse, ScreenKey } from './types';
import { createFixtureDataSource } from './fixtures';
import { mapMeta as fixtureMeta } from './fixtures/bristol';
import { MAP_BLOCKS, MAP_COLUMNS, MAP_ROWS, VACANT_LOTS } from '@/shared/bristolMap';

/** Screens the economic engine owns. The rest (stocks, prestige, test wallet) have no server model yet and stay labelled fixtures. */
const SERVER_SCREENS: ReadonlySet<ScreenKey> = new Set(['city', 'companies', 'commodities', 'portfolio']);

async function api<T>(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  let body: unknown; try { body = await res.json(); } catch { throw new Error(`Server returned a non-JSON response (${res.status})`); }
  return { status: res.status, body: body as T };
}

/** Decor is cosmetic client state; drop anything that would sit inside a real building footprint on the server's map. */
const decor = () => fixtureMeta.decor.filter((d) => ![...MAP_BLOCKS, ...VACANT_LOTS].some((b) => d.column >= b.column && d.column < b.column + b.width && d.row >= b.row && d.row < b.row + b.depth));

/**
 * Talks to the server-authoritative economic engine. Everything it returns for city/companies/commodities/portfolio is real simulated state
 * (`authority: 'server'`). Anything the engine does not model yet is delegated to the fixture source and keeps its illustrative label.
 */
export function createServerDataSource(base = ''): GameDataSource {
  const fixture = createFixtureDataSource('normal', { delayMs: 0 });
  return {
    authority: 'server',
    async load<K extends ScreenKey>(key: K, o?: { signal?: AbortSignal }): Promise<Loaded<ClientScreenState[K]>> {
      if (!SERVER_SCREENS.has(key)) return fixture.load(key, o);
      const { status, body } = await api<Loaded<ClientScreenState[K]> & { error?: { message: string } }>(`${base}/api/screens/${key}`, { signal: o?.signal });
      if (status !== 200 || !body.envelope) throw new Error(body.error?.message ?? `Server error ${status}`);
      assertWireIntegrity(body.envelope.data, key);
      return body;
    },
    async loadCompany(id, o): Promise<Loaded<Company>> {
      const { status, body } = await api<Loaded<Company> & { error?: { message: string } }>(`${base}/api/companies/${encodeURIComponent(id)}`, { signal: o?.signal });
      if (status !== 200 || !body.envelope) throw new Error(body.error?.message ?? `Server error ${status}`);
      assertWireIntegrity(body.envelope.data, 'company');
      return body;
    },
    async loadFinancials(id): Promise<FinancialRow[] | null> {
      const { status, body } = await api<{ rows: FinancialRow[] }>(`${base}/api/companies/${encodeURIComponent(id)}/financials?limit=30`);
      return status === 200 ? body.rows : null;
    },
    mapMeta(cityId): MapMeta { return { cityId, columns: MAP_COLUMNS, rows: MAP_ROWS, decor: decor() }; },
    async requestQuote(req: QuoteRequest): Promise<QuoteResponse> {
      if (req.kind !== 'commodity') return fixture.requestQuote(req);       // shares / prestige quotes stay illustrative
      const { body } = await api<QuoteResponse>(`${base}/api/quote`, { method: 'POST', body: JSON.stringify(req) });
      return body;
    },
    async submitCommand(cmd: Command): Promise<CommandResult> {
      const { body } = await api<CommandResult>(`${base}/api/command`, { method: 'POST', body: JSON.stringify(cmd) });
      return body;
    },
  };
}

/** Chooses the data source at startup. Never silently pretends: if the server is down the UI says so and labels everything illustrative. */
export async function chooseDataSource(search: string, probeMs = 2_500): Promise<{ source: GameDataSource; fallbackReason: string | null }> {
  const params = new URLSearchParams(search);
  if (params.get('source') === 'fixture') return { source: createFixtureDataSource(params.get('fixture') === 'slow' ? 'slow' : params.get('fixture') === 'error' ? 'error' : params.get('fixture') === 'empty' ? 'empty' : 'normal'), fallbackReason: null };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), probeMs);
  try {
    const res = await fetch('/api/health', { signal: ctl.signal });
    if (!res.ok) throw new Error(`Service unavailable (${res.status})`);
    const j = (await res.json()) as { ok?: boolean; authority?: string };
    if (res.ok && j.ok && j.authority === 'server') return { source: createServerDataSource(), fallbackReason: null };
    throw new Error('unexpected health response');
  } catch {
    return { source: createFixtureDataSource('normal'), fallbackReason: 'The game connection is unavailable. Showing illustrative fixture data only; purchases and management changes cannot be saved. Use Reconnect to game to try again.' };
  } finally { clearTimeout(t); }
}
