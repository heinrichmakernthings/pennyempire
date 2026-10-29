/** Wire types for the living-city screens: standings, the Penny Post and public competitor profiles. */
export interface BoardRow { rank: number; companyId: string; name: string; industry: string; ownerKind: 'player' | 'npc'; value: number; mine: boolean }
export interface Board { key: string; label: string; scope: string; unit: 'minor' | 'bps'; rows: BoardRow[] }
export interface TitleRow { key: string; label: string; holderId: string; holderName: string; ownerKind: 'player' | 'npc'; sinceTick: number; value: number }
export interface TitleChange { tick: number; gameDate: string; label: string; from: string | null; to: string }
export interface Standings { tick: number; asOfBoardTick: number | null; boards: Board[]; titles: TitleRow[]; recentChanges: TitleChange[] }

export interface Article { id: number; tick: number; gameDate: string; kind: string; headline: string; body: string; importance: 1 | 2 | 3; companyId: string | null; industry: string | null; commodityId: string | null }

/** Only information any other company could observe in the street: no cash, no margins, no strategy internals. */
export interface CompetitorProfile {
  companyId: string; name: string; industry: string; industryLabel: string; ownerKind: 'player' | 'npc'; district: string; status: 'operating' | 'paused' | 'closed';
  foundedTick: number; ageDays: number; quality: string; priceMinor: number; reputationBps: number; staffBand: 'tiny' | 'small' | 'medium' | 'large';
  market: { rank: number; of: number; shareBps: number; unitsPerDayBand: string };
  titles: string[]; recent: { tick: number; gameDate: string; text: string }[];
  /** Reserved for future share investment, acquisitions and corporate groups; nothing here is tradeable yet. */
  future: { shareInvestable: false; acquirable: false; corporateGroupId: string | null };
  notice: string;
}

/** One building's observable state today, derived only from recorded sales, production and company records. */
export type ActivityState = 'closed' | 'construction' | 'missing-inputs' | 'high-demand' | 'delivery' | 'customers' | 'production' | 'quiet';
export interface CompanyActivity { companyId: string; state: ActivityState; customers: number; vans: number; workers: number; productionActive?: boolean }
