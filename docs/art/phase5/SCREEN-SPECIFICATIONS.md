# Phase 5 screen and interaction specifications

Visual authority: existing Phase 1–4 design system and `src/design/tokens.css`. Mode: Operate. Extend the dark market terminal with the existing amber/mint/coral semantics, system typography, 4px controls and 8px panels. No new fonts, palette or sprite grid.

## Exchange

Desktop: a company directory (210px), fluid issuer content and 304px order ticket. First viewport gives the issuer, current price/change, market capitalisation, history and trade controls. Lower content contains book, financial report, ownership, dividends and news. Directory selection replaces the issuer and resets any stale quote. State firms may be unlisted; show unavailable history and disabled ticket rather than a fabricated share price.

Share history is an SVG generated from observations. Break paths on nulls, label days/EC and disclose cropped vertical scale. Exact data is in an accessible table. Price changes include sign/text, not only colour. Reports declare their period and status. Ownership percentages use outstanding shares as denominator.

Ticket: side → limit/market → whole shares → price (limit only) → review → confirmation. Review protects focus and shows issuer, quantity, notional, fee and maximum reservation/net proceeds. Quotes expire. Market quotes require a maximum spend guard. Acknowledgement is not execution. Production lifecycle: pending → open → partial → filled; cancellation applies only to remaining shares; rejected and expired states retain the draft and explain recovery. Reference condition selector is a QA control, not a player-facing production field.

## State services and advertising

Six distinct existing buildings support service discovery. Detail dialogs explain each institution’s economic role and capability availability. Payment destinations are accurate to the audited engine. Small branch-bank sprite extends the bank family. Advertising preview accepts escaped dynamic player branding; native image pixels remain unchanged.

## Prestige

Catalogue groups vehicles, properties, waterfront and collectibles. Buildings display at native logical size; small catalogue props use exactly 2× nearest-neighbour enlargement. Native 1× contact sheets and city composition remain the scale authority. Rarity is textual: Refined, Rare, Exceptional, Landmark. These labels are fixture taxonomy, not economic balancing. Owned state, price and preview action are separate. Two unsupported assets remain clearly unavailable, with no fake thumbnail or purchase button.

Preview → eligible location → confirm purchase. Confirm includes price, prestige, cosmetic nature and placement. Insufficient EC/placement failure are inline errors; no unrelated popups. Success updates the preview collection and cash once. Owned-item dialog offers dynamic nameplate text/colour, not a fabricated body paint system. Temporary perks show “None active”; production needs server-supplied effect and expiry, with no automatic earnings multiplier.

## Portfolio

Allocation, holdings, private companies, dividend events and collection are one view. Fictional EC totals exclude GBP_TEST and prestige acquisition prices. Private valuations are estimates, not cash. Declared dividends are separate from paid dividends. Reserved shares remain owned and counted in share market value but cannot be sold twice. Dynamic allocation uses labelled table plus proportional segments; colour is supplemental.

## News

The Bristol Ledger uses a broad lead column and narrower civic/local column, with compact tags, title, body, entity, day and a contextual link. Nine templates: IPO, dividend, market crash, acquisition, bankruptcy, state announcement, commodity shortage, milestone, international expansion. Reuse the same event record for a compact notification (one title, entity/day, one action) and the larger article. Do not render economic claims from asset names. Escape text, deduplicate event IDs and preserve read state in production.

## Responsive and accessibility

At 1200px+: 3-column exchange, 3-column prestige catalogue. At 768–1199px: directory + issuer, ticket below issuer; 2-column catalogue; stacked portfolio. Below 768px: horizontal issuer selector, single column, ticket after issuer details, fixed 56px bottom navigation with safe-area allowance, single-column catalogue and news. Reference captures include 1440 and 390, overflow checks include 360/768/1199. An “Open trading ticket” jump link above the chart focuses the mobile ticket for long issuer reports.

Dialog uses native `showModal`, Escape and focus return; bottom sheet inherits Phase 4’s 80dvh maximum. Keyboard focus is visible. Tables scroll within their container on narrow screens. Main content has a skip link that does not navigate to another screen. Loading uses semantic `aria-busy` and skeleton blocks matching final dimensions; no animated shimmer required. Empty means no holdings/listings/news; unavailable means missing capability or data; errors name retry/recovery. Never substitute 0 EC for null.

## Event and motion rules

No autonomous decorative animation is added. News, order acknowledgements and purchases follow real confirmed state events. Stock price changes may briefly highlight their row after a new sequence arrives; reduced-motion uses the static updated value and text change marker. City sprite animation remains in existing Phase 2/3 sheets; Phase 5 supplies static parked assets only.

Review refinement: two-column financial/dividend tables fit mobile without horizontal scrolling. Genuinely wide tables use labelled focusable scroll regions and a visible horizontal-scroll hint. Issuer announcements are filtered by stable company ID; issuer-specific newspaper links retain that selection, including unlisted state institutions.
