import type { Command, CommandResult, Company, Envelope, Holding, Listing, Player, Quote, QuoteRequest, ScreenState, ApiError } from '@/contracts/game-state';

/**
 * Where a payload's numbers came from. The UI must never present `illustrative-fixture` values as authoritative.
 * When the Worker API lands, a second source returns `server` and the UI badges disappear for it automatically.
 */
export type DataAuthority = 'illustrative-fixture' | 'server';

export interface Loaded<T> {
  authority: DataAuthority;
  envelope: Envelope<T>;
}

/** The contract has no Portfolio root; the Portfolio screen is composed from holdings + listings. */
export interface PortfolioState {
  player: Player;
  holdings: Holding[];
  listings: Listing[];
}

/**
 * CONTRACT PROPOSAL: ScreenState.city only carries the single selectedCompany, but the map needs a name/owner/industry for every
 * company plot (tooltips, accessible list, labels). The server should return this lightweight directory with the city payload.
 */
export type CompanySummary = Pick<Company, 'id' | 'name' | 'plotId' | 'industry' | 'owner' | 'level' | 'status'>;
export type CityScreenState = ScreenState['city'] & { directory: CompanySummary[] };

export interface ClientScreenState extends Omit<ScreenState, 'city'> {
  city: CityScreenState;
  portfolio: PortfolioState;
}
export type ScreenKey = keyof ClientScreenState;

/** Static, client-side map metadata that the contract does not carry yet (grid bounds + purely cosmetic scenery). */
export interface DecorPlacement { assetId: string; column: number; row: number; offsetX?: number; offsetY?: number }
export interface MapMeta { cityId: string; columns: number; rows: number; decor: DecorPlacement[] }

/** One row of a company's daily operating statement (EC minor units). Server data only. */
export interface FinancialRow { tick: number; gameDate: string; revenue: number; cogs: number; labour: number; property: number; marketing: number; fees: number; tax: number; energyPaid: number; inputPurchases: number; grossProfit: number; netProfit: number; cash: number; inventoryValue: number; unitsProduced: number; unitsSold: number; unpaid: number; status: string }

export type QuoteResponse = { ok: true; quote: Quote } | { ok: false; error: ApiError };

export interface GameDataSource {
  readonly authority: DataAuthority;
  load<K extends ScreenKey>(key: K, opts?: { signal?: AbortSignal }): Promise<Loaded<ClientScreenState[K]>>;
  /** Full detail for one company (what the server returns as `selectedCompany`). */
  loadCompany(id: string, opts?: { signal?: AbortSignal }): Promise<Loaded<Company>>;
  /** Optional: per-day operating statement. Null/absent when the source has no such history (fixtures). */
  loadFinancials?(id: string): Promise<FinancialRow[] | null>;
  mapMeta(cityId: string): MapMeta;
  requestQuote(req: QuoteRequest): Promise<QuoteResponse>;
  submitCommand(cmd: Command): Promise<CommandResult>;
}
