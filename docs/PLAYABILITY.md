# Playability pass (Prompt 12)

Alpha feedback: *"every time I play, the business goes insolvent — it needs to be more fun."* This pass finds out why and fixes the causes. It doesn't add new content.

## What was going wrong

Seeded probes created a company the way a new player does and ran the world forward (scripts are not part of the repo; the regression tests below cover each finding).

| Finding | Evidence |
|---|---|
| **The live world ran one in-game day per real minute** (`realMsPerTick` 60 000). That is about four game years every real day. A company left overnight lived through hundreds of unattended days, including recessions and supply shocks. A company becomes insolvent after 3 unpaid days, which was 3 real minutes, and is liquidated 10 days later. | `wrangler.jsonc` sets no pace, so the engine default applied, and the Durable Object alarm runs ticks continuously. |
| **Running out of cash was a trap the company could not leave.** With an empty till, auto-purchasing has no budget, so there are no ingredients, no production and no sales; wages keep the till empty. Meanwhile the owner's wallet held 15,000–17,500 EC. | Premium-quality pizza with standard prices: sales fell from 410 a week to 0 by day 30. The company was insolvent on day 13, or, with only wage cover, drained the wallet to 0 by day 120. |
| **Two settings were silent money pits.** Advertising does nothing for a farm, mill, dairy or timber yard (their buyers are businesses; awareness only affects households). Premium quality uses 25% more ingredients at the same price. | A farm with 50 EC/day of marketing was insolvent on day 28. |

With default settings, every industry survives the first 60 days and most survive a year (mills remain the weakest link; see `docs/ECONOMIC-AUDIT.md`).

## Changes

1. **World pace: one in-game day per 10 real minutes** (6 an hour, 144 a real day). This is the new default, and seed patch `pace-v1` moves an existing world that is still on the old one-minute pace. A pace an administrator chose is kept. `setPace()` re-anchors the clock, so no day is skipped or replayed. Administrators can change the pace with `POST /api/admin/param` (`{"key":"realMsPerTick","value":…,"reason":…}`, from 1 minute to 24 hours).
2. **Wallet cover**, on by default and switchable per company (*Cover shortfalls from my wallet*). When the company's till cannot pay for tomorrow's missing ingredients (at reference prices, with 20% headroom) or today's wages and bills, the owner's wallet pays the gap.
   - The payment is a `capital_injection` ledger transfer: no coins are created, and the deep audit stays clean.
   - The player gets one warning a week per company.
   - With cover off, or with an empty wallet, the old insolvency rules apply unchanged.
   - Migration `0010_owner_cover` adds the column.
3. **Guardrails.**
   - Advertising spend is refused for companies that sell only to businesses, with an explanation (paid campaigns already were).
   - Saving settings returns plain-language warnings when the price is at or below the ingredient cost of one unit, or leaves under about 30% for wages and rent; this is aware of premium quality.
   - The same warnings appear in the company's diagnosis, and the quality picker explains premium.
4. **While you were away.** On return, a card summarises what each business sold, earned or lost, and how much wallet cover it needed since the last visit. It also lists the city's economic events. Everything is read from day statements and the ledger. `GET /api/away`, `POST /api/away/seen`.

## Results (same probes, after)

| Player move | Before | After |
|---|---|---|
| Premium pizza, price unchanged | Insolvent on day 13 | Operating; the wallet pays about 370 EC in the first two weeks, then 55–90 EC/day profit |
| Premium pizza, wallet cover switched off | Insolvent on day 13 | Insolvent on day 13 (unchanged: the player chose it) |
| Farm with 50 EC/day of marketing | Insolvent on day 28 | Refused with an explanation |
| Defaults, every industry, 45 days | Operating | Operating (unchanged) |

The audit scenarios still deep-audit clean with wallet cover on (A and B, 365 days).

## Tests

- `server/engine/playability.test.ts` covers:
  - pace: new default, patch, admin bounds, re-anchoring;
  - wallet cover: default on, no arrears, weekly warning, switched off, never more than the wallet, buys ingredients;
  - guardrails.
- `server/api/away.test.ts` covers the summary: per player, matches day statements, and marking as seen.
- Eight existing tests deliberately starve a company of cash to test insolvency, liquidation, loan default, a missed contract payment and the E1 exploit; they now switch wallet cover off first, which is what an attacker would do too.

## Not done here (suggested next)

- **Goals and milestones.** There is still nothing to aim for after the first company is profitable; short goals with visible progress are the biggest remaining fun gap.
- **Faster early feedback.** The first sales arrive on the next day tick, now 10 minutes. An instant opening-day sale, or a shorter first day, would make the first session feel alive.
- **Mills** still fail most often over long runs.
