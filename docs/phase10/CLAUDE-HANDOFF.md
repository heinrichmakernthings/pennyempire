# Claude integration handoff

## Branch relationship

Phase 10 is based on `deploy/cloudflare-test-link` at `5477ac74c831219550f42774a15b1dd9fdc8e018`, the actual deployed client. `main` is still the art foundation (`803e0be`). Use the PR diff against the deployment branch; merging straight into main would also import the entire application stack.

Open PRs rechecked on 29 October 2026:

| PR | Branch head | Base |
| --- | --- | --- |
| #23 | `feature/prestige-monetisation-wallet` · `4b7d9bd` | `feature/state-economy-events` |
| #19 | `feature/state-economy-events` · `b35e951` | `feature/stock-exchange` |
| #17 | `feature/stock-exchange` · `aa1d2cb` | `feature/npc-competition` |
| #16 | `feature/npc-competition` · `379342d` | `feature/commodities-exchange` |
| #13 | `feature/commodities-exchange` · `26a8a20` | `feature/company-management` |
| #11 | `feature/company-management` · `48494cb` | `feature/economic-engine` |
| #9 | `feature/economic-engine` · `e62eece` | `claude/keen-allen-axrbsr` |
| #7 | `claude/keen-allen-axrbsr` · `38879cb` | `design/phase1-production-pass` |
| #18 | `deploy/cloudflare-test-link` · `5477ac7` | `main` |

No newer published private-multiplayer branch was found. Unpublished Claude work cannot be inspected. No active Claude branch was rewritten, merged or pushed to.

## Conflict-sensitive files

`src/city/CityScreen.tsx` and `CityViewport.tsx` already differ between deployed art integration and the newer stack. Port only the `FirstBusiness` mount, authority-gated activity query, recentre/Home controls and tooltip bounds. Keep Claude's state/company data changes and the deployed sprite integration. Do not take whole-file replacements.

The other frontend changes are deliberately small: new `BusinessBrief`, `HelpTip`, `ConnectionNotice`, isolated `phase10.css`; additions to company panels/forms, opportunity ordering, supplier-sheet explanation, shares search/guide, `Icon` strip framing, `ScreenData`, tabs and optional query enablement. No server, shared wire types, database, ledger, App routing, wallet implementation, state-event implementation, global stylesheet or city draw loop changed.

The additive art integration manifest records reused assets and strip frame counts; it does not supersede existing atlas manifests. The new stylesheet is imported by the new components and the shares screen to avoid editing `main.tsx`.

## Required dependencies and acceptance criteria

1. **Production availability:** resolve the Cloudflare Durable Objects write quota through the existing deployment/account process. Preserve the database. Acceptance: `/api/health` returns authoritative JSON, first-time/company journeys work on preview, no fixture fallback, and ledger reconciliation passes. Do not infer recovery from a successful frontend build.
2. **Private alpha identity:** connect authenticated player identity to the existing player/company permissions and commands. FirstBusiness uses `directory[].owner.id === player.id`; verify this against multiplayer state and reject cross-player commands on the server. Acceptance: two users have isolated cash/companies and can trade through existing settlement.
3. **State economy #19:** integrate its service routes/entities/events. Map Penny Energy, Penny Ads, Penny Logistics, Central Property, National Bank and Penny Exchange to approved Phase 5 sprites using server IDs. Notify only from unique recorded event IDs/ticks; respect reduced motion. Do not infer a boom/recession from an arbitrary frontend threshold.
4. **Prestige/wallet #23:** preserve its ownership IDs, placement, transaction ledger and reward eligibility. Replace illustrative catalogue with authoritative results. A purchased item must persist after refresh and appear only at an allowed location/profile slot. Keep EC purchases separate from simulated GBP. Deposit/withdrawal/reward history must show transaction state, integer amount and reason; below-£5 simulated withdrawal must fail server-side. No real payment configuration.
5. **Staff depth:** current Management contains counts, wages, hiring limits and equipment, not individuals/XP. If individual staff is implemented, supply stable staff ID, role, approved portrait key, earned experience, productivity factors and recorded achievement IDs. Until then keep the explicit “individual experience is not tracked” explanation; don't invent characters or multipliers.
6. **News/presentation:** add a stronger Penny Post masthead in the active BristolScreen without replacing existing article/event mapping. Display event dates/source company; no generated economic stories without backing records.
7. **Performance:** profile cold start, atlas transfers, memory and frame time with the consolidated alpha on a low-end mobile device. The large entry chunk is a known follow-up; preserve sprite cache and test city ownership/activity after any lazy-loading split.

## Merge and QA order

Review this frontend PR against the deployed branch. Consolidate Claude's engine stack using its established merge order, then cherry-pick/merge the frontend changes and resolve city files intentionally. Run unit tests, build, art validation and company/commodity/share/living browser journeys on a fresh DB. Recheck wallet/state-specific journeys from Claude's branches, which this PR does not certify. Finally test the real Cloudflare preview after quota recovery. This PR does not authorize a database reset or automatically deploy its changes.
