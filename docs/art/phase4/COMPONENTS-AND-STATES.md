# Shared components, interactions and responsive behaviour

## Component contract

| Component | Visual / semantic specification | Inputs / outputs |
|---|---|---|
| Button | 44px minimum height/target; 4px radius; primary amber/dark text, secondary raised/cream, destructive coral text; hover border, 2px amber focus ring; disabled label retained | Intent, disabled, pending, accessible name, callback. No button fires twice while pending |
| Field / select | Visible label, 16px input, helper/error 14px; native numeric controls; invalid state with aria-invalid + described-by | Value, server min/max/step, error, dirty; emits local draft only |
| Table / order row | 14/20 type; tabular numeric columns aligned right; row separators; semantic headers | Rows and stable IDs. Mobile uses contained horizontal scrolling only when necessary; never page overflow |
| Company card | Name, industry/level, one meaningful daily result; commodity icon as compact identifier | Company summary, selected state, selection callback. Full building sprite belongs in larger detail, not a blurred thumbnail |
| Inventory card | 48px commodity, available/reserved, coverage text, contextual action | Inventory line plus shared company capacity; cannot sell reserved stock |
| FinancialChart | Data-driven SVG, min detailed 280×120; zero baseline for profit; amber revenue, dashed muted expenses, mint profit; missing-data gaps and table alternative | Timestamped integer-minor history, currency, period, completeness; no synthetic interpolation |
| Market depth | Price-sorted cumulative aggregation; quantity and cumulative values accompany subtle bars | Orders with side, price, remaining units. Do not present a truncated page as the full book; mark visible depth if incomplete |
| TradeTicket / QuoteReview | 336px desktop column; full-width mobile ticket; dialog/bottom-sheet review for commitment | Company ID, commodity ID, side/type, quantity, price/protection, server quote, expiry, permissions and capability flags |
| Tabs | Text tabs with 3px amber selected underline; horizontal overflow; role tablist/tab/tabpanel, selected state and Arrow/Home/End keyboard handling | Active tab, panel ID, dirty-draft guard where navigation would discard edits |
| Notice / notification | Inline raised surface, 1px divider, 24px symbol, concise title and recovery text. Mint/coral/amber supplemented with text | Severity, message, action. Announce command outcomes once, never every price tick |
| Modal / sheet | Native dialog in reference; 560px max desktop; mobile bottom sheet max80dvh; close button, Escape, focus containment and return | Reviewable action summary, cancellation, commit, pending/error. Routine edits do not open dialogs |
| SupplyChainNode / Edge | Icon + company + availability + state + action; four columns desktop, stacked mobile with downward arrows | Recipe, inventory, supplier, company and optional shipment data; all text remains DOM |
| Loading / empty | Stable shell; static skeleton in reduced motion; explicit unavailable actions. Empty explains next action, not fake data | Load status, retry, contextual action; unknown values display unavailable, never 0 |

Use `tools/company-marketplace/components.js`, `styles.css` and individual icons from `assets/art/phase4/manifest.json` as implementation references. Existing React Button, Field, DataTable, FinancialChart, ResponsiveSheet, StatusLabel, Tabs and TradeTicket should be extended rather than duplicated. CurrentColor icons use inline trusted SVG or CSS mask; external img colour does not inherit text colour.

## Required feedback

| State | Placement and recovery |
|---|---|
| Buying supplies / selling inventory | Ticket pending state with stable idempotency key; no optimistic balance/stock mutation |
| Insufficient funds | Inline ticket error naming company funds, reservation and recovery: reduce quantity or fund company; retain draft |
| Missing materials | Company overview and recipe dependency; identify commodity and needed/available units; Buy supplies deep link |
| Successful trade | Inline outcome + own order row; distinguish accepted/open, partial and completely filled |
| Failed order / quote expired | Preserve terms; identify failure; request new quote and require another confirmation |
| Operating at a loss | Overview warning with period and cost/price action; never confuse negative profit with insolvency |
| Upgrade available | Growth tab, cost/requirements and explicit review; unavailable capability has reason |
| New company created | Confirmation screen leading to first setup; use actual returned company ID |
| Bankruptcy / insolvency | Persistent operating-state notice; explain production stopped, arrears and server recovery requirements. Do not invent liquidation or erase inventory |
| Loading / empty / stale / forbidden | Stable shell and readable explanation; block money actions while stale or unauthorised; preserve draft and show retry |

## Interaction rules

- Creation Back retains industry, plot and name. Changing industry invalidates incompatible premises and costs in production. Quote freshness and plot availability must be checked again at final commit.
- Management settings use explicit Save/Discard. A production implementation must keep unsaved drafts per company or present Save/Discard/Stay before changing company/route; the fixture’s session-local drafts are not a persistence implementation.
- Quote snapshots bind all terms and company identity. Any ticket edit invalidates the quote. A quote expiry disables confirmation and explains recovery. Unknown timeout requires command-status reconciliation, not a new idempotency key.
- Market data refresh must not steal focus, reorder a user-selected row unexpectedly or reset an active draft. Show “updated” metadata unobtrusively.
- Order cancellation can race a fill: render the server’s final filled/cancelled remainder, not the amount seen before confirmation.
- Supplier contracts require bilateral acceptance and explicit lifecycle/termination/renewal policy. Do not silently turn a saved draft into an active recurring payment.
- Screen text is escaped in the reference. Production should render untrusted names through framework text nodes, never interpolate them as markup.

## Responsive rules

| Width | Shell and primary workflows |
|---|---|
| ≥1200px | Existing 184px nav / 64px HUD. Company list216px + detail. Trading layout208px + flexible book +336px ticket. Creation flexible main +336px artwork/context rail |
| 768–1199px | Existing72px icon rail. 176px selector + main content. Trading ticket moves below the book; creation context rail300px. Large building preview can hide, essential data/actions remain |
| <768px | Two-line88px HUD and56px bottom navigation plus safe area. Full-width forms, company selector, scrollable tabs. Commodity selector becomes a horizontal strip. Open trading ticket reveals full-width form and focuses its first field. Confirmation uses max80dvh bottom sheet |

Mobile order-book cumulative column is secondary and may hide; prices and quantities remain. Mandatory financial fields never shrink below14px. All actions are at least44px tall. Creation footer stays above bottom nav; dialogs clear safe-area inset. Charts remain DOM/SVG with table alternatives. The screenshot set covers1440px and390px; additional360px/768px/1199px and DPR2 checks are recorded separately if executed.

Motion is functional only: native focus/scroll, pending state and authoritative event cues. No ambient moving ticker, decorative chart loops or animated balances. Honour reduced motion and pause any future world animation in hidden tabs.
