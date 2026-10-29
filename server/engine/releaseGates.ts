/**
 * Release gates for anything that could touch real money. They are compile-time constants, not configuration: opening one requires a code
 * change, review, specialist legal advice, licensing and approved payment/safeguarding infrastructure (see AGENTS.md). Every money-moving
 * path in the GBP_TEST wallet asserts against them, so a future "real" provider cannot be wired in by configuration alone.
 */
export const RELEASE_GATES = { livePayments: false, livePayouts: false, realMoneyWagering: false, cashConvertiblePrizes: false } as const;
export const SIMULATED_PROVIDERS = new Set(['mock-sandbox', 'mock-video', 'mock-subscription']);

export function assertSimulatedProvider(provider: string): void {
  if (!SIMULATED_PROVIDERS.has(provider)) throw new Error(`Provider "${provider}" is not a simulated provider: real payment providers are behind a closed release gate`);
  if (RELEASE_GATES.livePayments || RELEASE_GATES.livePayouts) throw new Error('Live payment gates must stay closed in this release');
}
