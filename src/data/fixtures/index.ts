import type { ApiError, Command, CommandResult, Company, QuoteRequest } from '@/contracts/game-state';
import { assertWireIntegrity } from '@/domain/integrity';
import { buildQuote } from '@/domain/quote';
import type { ClientScreenState, GameDataSource, Loaded, MapMeta, QuoteResponse, ScreenKey } from '../types';
import { city, companies, mapMeta, player, recipes } from './bristol';
import { FIXTURE_COMMODITY_FEE_BPS, FIXTURE_SHARE_FEE_BPS, commodities, holdings, listings, orders, ownOrders, prestigeItems, testWallet, trades } from './markets';
import { FIXTURE_NEXT_TICK, FIXTURE_NOW } from './util';

export type FixtureMode = 'normal' | 'slow' | 'error' | 'empty';
export const FIXTURE_NOTICE = 'Illustrative data — no game server is connected. Nothing here is real economic state.';

const page = <T,>(items: T[]) => ({ items, nextCursor: null });
const selected = () => companies.find((c) => c.id === 'co-mad-slices') ?? null;

function build(mode: FixtureMode): ClientScreenState {
  const empty = mode === 'empty';
  const state: ClientScreenState = {
    city: { player, city, selectedCompany: null, directory: companies.map(({ id, name, plotId, industry, owner, level, status }) => ({ id, name, plotId, industry, owner, level, status })) },
    companies: { player, companies: page(empty ? [] : companies.filter((c) => c.owner.id === player.id)), recipes },
    commodities: {
      player, cityId: city.id, commodities, orders: page(empty ? [] : orders), ownOrders: page(empty ? [] : ownOrders), history: page(empty ? [] : trades),
      selectedCompany: selected(), quote: null,
    },
    stocks: { player, listings: page(listings), holdings: empty ? [] : holdings, quote: null, news: city.events },
    prestige: { player, items: page(prestigeItems), eligiblePlots: city.plots.filter((p) => p.companyId && p.owner?.id === player.id) },
    wallet: { player, wallet: empty ? { ...testWallet, transactions: [], rewards: [] } : testWallet, transactions: page(empty ? [] : testWallet.transactions), portfolio: empty ? [] : holdings },
    portfolio: { player, holdings: empty ? [] : holdings, listings },
  };
  return state;
}

/** Fixture-only: ?fixture=slow|error|empty exercises loading, error and empty states during development and in tests. */
export function fixtureModeFromSearch(search: string): FixtureMode {
  const v = new URLSearchParams(search).get('fixture');
  return v === 'slow' || v === 'error' || v === 'empty' ? v : 'normal';
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

export function createFixtureDataSource(mode: FixtureMode = 'normal', opts: { delayMs?: number } = {}): GameDataSource {
  let quoteSeq = 0;
  return {
    authority: 'illustrative-fixture',
    async load<K extends ScreenKey>(key: K, o?: { signal?: AbortSignal }): Promise<Loaded<ClientScreenState[K]>> {
      await sleep(mode === 'slow' ? 2_500 : (opts.delayMs ?? 120), o?.signal);
      if (mode === 'error') throw new Error('Fixture error mode: the simulated request failed.');
      const data = build(mode)[key];
      assertWireIntegrity(data, key);
      return { authority: 'illustrative-fixture', envelope: { schemaVersion: 1, revision: 1, asOf: FIXTURE_NOW, nextTickAt: FIXTURE_NEXT_TICK, data } };
    },
    async loadCompany(id: string, o?: { signal?: AbortSignal }): Promise<Loaded<Company>> {
      await sleep(mode === 'slow' ? 1_200 : 60, o?.signal);
      if (mode === 'error') throw new Error('Fixture error mode: the simulated request failed.');
      const data = companies.find((c) => c.id === id);
      if (!data) throw new Error(`Unknown company ${id}`);
      assertWireIntegrity(data, 'company');
      return { authority: 'illustrative-fixture', envelope: { schemaVersion: 1, revision: data.revision, asOf: FIXTURE_NOW, nextTickAt: FIXTURE_NEXT_TICK, data } };
    },
    mapMeta(): MapMeta { return mapMeta; },
    async requestQuote(req: QuoteRequest): Promise<QuoteResponse> {
      const c = commodities.find((x) => x.id === req.entityId);
      const l = listings.find((x) => x.id === req.entityId);
      const item = prestigeItems.find((x) => x.id === req.entityId);
      const unit = req.kind === 'commodity' ? c?.referencePrice : req.kind === 'prestige' ? item?.price : l?.price;
      if (!unit) return { ok: false, error: { code: 'VALIDATION', message: 'Unknown instrument.' } satisfies ApiError };
      const available = req.kind === 'commodity' ? (c?.localSupplyUnits ?? 0) : req.kind === 'prestige' ? (item?.purchasable ? (item.stockRemaining ?? 1) : 0) : (l?.outstandingShares ?? 0);
      const r = buildQuote({ request: req, unitPriceMinor: unit.minor, currency: unit.currency, feeBps: req.kind === 'commodity' ? FIXTURE_COMMODITY_FEE_BPS : req.kind === 'prestige' ? 0 : FIXTURE_SHARE_FEE_BPS, availableUnits: available, revision: 1, now: new Date(), id: `fixture-quote-${++quoteSeq}` });
      return r.ok ? { ok: true, quote: r.quote } : { ok: false, error: { code: 'VALIDATION', message: r.message, fieldErrors: { [r.field]: r.message } } };
    },
    async submitCommand(_cmd: Command): Promise<CommandResult> {
      return { ok: false, error: { code: 'UNAVAILABLE', message: 'No game server is connected in this build. Nothing was sent and nothing changed.' } };
    },
  };
}


