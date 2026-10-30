# Phase 6 screen and component specification

Status: implemented interactive art reference, awaiting visual approval. Run `/tools/living-world/` from a repository-root HTTP server. All economic records are illustrative; no API writes exist. Preserve current game navigation when integrating these components rather than adding six more permanent game tabs.

## Layout and visual authority

Inherit Phase 1 tokens and Phase 4 controls. Background #141C20, surface #1D282D, raised #26343B, divider #38464C, text #F0E8D7, muted #A9B5B9, amber #FFC45E, mint #62DBAF, coral #F08076. Color accompanies words/icons. Body 16/24, secondary 14/20, main heading 24/32, section 20/28. Use tabular money figures, 44px minimum action targets, 4px control and 8px panel radii. Never put values or headlines into raster art.

Desktop ≥1200: 184px navigation, 64px HUD, 32px content gutters, fluid main column plus 336px inspector, 24px column gap. Tablet 768–1199: 72px navigation rail, 24px gutters, inspector after main content. Mobile <768: 88px HUD, 16px gutters, single column; reference-only six-item bottom navigation is 64px plus safe area. Reserve 100px content bottom padding. Dialogs become scrollable bottom sheets. Wide reports retain column associations in named keyboard-focusable horizontal regions; cost reviews fit without horizontal scrolling.

## Screen inventory

| Surface / route | Desktop | Mobile | Data and primary action |
|---|---|---|---|
| World / `#world` | Schematic map, city rows, selected-city inspector | Map overview then accessible destination list, detail below | Destination ID, status, country, opportunity, cost, eligibility; Explore city |
| Country | Selected-country destination diagram; UK groups Bristol and London | Same hierarchy with large external city buttons | Country ID filters city rows; no invented distance |
| City / Neighbourhood | Native sprite modules, district controls, expansion inspector | Horizontally scroll native sprites; district buttons wrap | City and neighbourhood IDs; Review expansion |
| Expansion | Focused two-step dialog | Bottom sheet; itemised costs and acknowledgement remain in normal scroll | Select district/name → review quote → explicit confirmation |
| Empire / `#empire` | Regional report, opportunity list, supply-contract terms | Report scrolls horizontally; regional decisions stack | Ownership, period revenue/profit, share basis points, freight, currency, report availability |
| Freight / `#freight` | Filtered shipment rows and route-cost inspector | Shipment cards with full-width View action; detail sheet | Shipment ID, state, quantity, endpoints, expected/actual ticks, delay reason, freight and tariff |
| THE PENNY POST / `#post` | Masthead, manual ticker, breaking banner, edition filter, two-column article list | Single chronological list, wrapped ticker and actions, feature sheet | Structured event/article IDs, headline, body, city scope, category, tick |
| Corporate groups / `#groups` | Parent/child register and acquisition inspector | Indented list then acquisition review | Direct stake, company ID, proposal stage, vote eligibility; Review vote |
| Business states / `#states` | Native canvas plus state description, event vocabulary below | Native canvas scrolls; state description and controls stack | Explicit operating/activity state, attachment profile, dynamic name |

## Reusable event card

`eventCard` demonstrates the rendered record; adapt the richer proposed `contracts.ts` event to this view (see INTEGRATION.md). Header: 24px icon + category + severity word. Body: headline, affected cities and industries, effective period and lifecycle. The consequences action opens typed metric/effect rows and full scope. No quantified effects displays an explicit unavailable statement. The icon never generates outcomes. Twelve supported categories are mapped in `assets/art/phase6/event-icons.json`.

Critical breaking news uses a restrained raised-surface strip and Read report action. A compact notification links to the same event ID. Event cards and feature reports show the actual effective period; article publication tick is separate. No automatic ticker motion or forced pop-ups. Acknowledge/view is not dismissing the underlying economic effect.

## Interaction contracts

- Expansion cannot proceed for owned or capability-locked destinations. Name is required, trimmed and limited to 32 characters in the reference. Server must validate occupied plots and permitted names. Review shows licence, premises, working capital and total. Quote expiry, insufficient funds and missing acknowledgement have inline recovery messages. An expired quote requires fresh review; retry must preserve idempotency.
- Shipment filters never alter inventories. Import/export settings are proposed future-contract policy, not a command to teleport or destroy goods. Delivered is a confirmed lifecycle state. Hold/delay/disruption require a reason and next action supplied by the engine.
- Voting offers For, Against and Abstain, with an inline error for no selection. Acknowledgement does not change cash or ownership. Display quorum, eligibility and record-date weights when the engine supplies them; do not infer from current shares.
- Brand labels are dynamic text separate from legal ownership. Proposed subsidiaries are explicitly marked and excluded from owned totals. Subsidiary stakes are direct, not additive wealth.
- News filters use structured city IDs. Article → consequences preserves the event identity. All company, player and article strings must be escaped before HTML insertion.
- State preview uses one existing shop sprite; props and badges change. Production integration gates actors on actual activity and pauses them when the business stops. The reference freezes badges at their reduced-motion frame.

## Loading, empty, stale and error states for production binding

The fixture is synchronous and does not claim implemented network-state coverage. Use existing ScreenData/ResponsiveSheet behavior when binding real data:

| State | Required behavior |
|---|---|
| Loading | Keep heading, navigation and last known scope; show labelled loading rows, no invented zeros; disable mutations until current quote/eligibility arrives |
| Empty portfolio | “No companies in this region”; offer available destinations without claiming profit |
| Empty shipments/news | Explain selected filter and offer Clear filter; no decorative activity |
| Stale report | Show as-of tick and “Updating”; retain values with a stale label; require fresh quote for mutations |
| Read failure | Inline error with Retry preserving city/filter; no modal loop |
| Mutation failure | Preserve inputs; show authoritative reason; same idempotency key on safe retry |
| Unsupported feature | Explain capability requirement; never offer payment as an unlock unless actually supported |
| Missing sprite | Existing neutral building fallback plus text state; never block management actions on image loading |

## Accessibility and motion

Native buttons/selects, visible focus, skip link, native dialog Escape/focus behavior, semantic headings and labelled scrolling tables. Provide labels beside state icons. Map is a schematic overview with a text alternative; destination lists provide interaction, avoiding tiny map targets. Keep native city art at integer scale inside a scrollable viewport. Production animated badges use `animations.json`; honor reduced motion and pause offscreen. No flashing crash/celebration or unattended routes.

## Component mapping for Claude

Build `WorldNavigator`, `DestinationList`, `ExpansionReview`, `RegionalCompanyReport`, `ShipmentList`, `ShipmentDetail`, `EventCard`, `PennyPostTicker`, `NewsArticle`, `CorporateOwnershipTree`, `AcquisitionReview`, `BusinessStateLayer`. Compose existing MoneyValue, StatusLabel, DataTable, ResponsiveSheet, FinancialChart and artAssets loader. Keep the six-route fixture as a review tool, not a second app shell. Financial charts remain data-driven; this phase supplies no flattened chart artwork.
