# Phase 4 QA evidence

## Design comparison and scope

The reference extends the incumbent Pixel Tycoon × Market Terminal design in Operate mode. `index.html` imports `src/design/tokens.css`; comparison against the base commit found no edits to that file or `docs/design/DESIGN-SYSTEM.md`. The charcoal surfaces, amber actions, mint/coral financial semantics, system typography, tabular numbers, 4px controls/8px panels and desktop rail/mobile bottom navigation continue the existing direction. Pixel imagery remains limited to approved building/commodity assets; charts and economic text stay editable code.

The documentation pass checked the source styles, manifest, capture/check scripts and both reports, and visually sampled `desktop-marketplace.png` and `mobile-company-overview.png`. This is not a fresh independent audit of all 25 captures. Existing design/product documents remain authoritative; no duplicate root DESIGN.md or PRODUCT.md was created. No design launcher/detector was installed or used.

Inherited limitations remain unrepaired: detailed source artwork does not have certified uniform pixel density, and existing footprint/pivot/collision geometry is not certified for arbitrary world placement. See `docs/design/PRODUCTION-READINESS.md` and `docs/art/phase3/MISSING-ASSETS.md`. This UI extension neither replaces that art nor certifies those properties.

## Captured browser journeys

[browser-report.json](qa/browser-report.json) records 25 captures: 16 desktop and nine mobile. Desktop viewport is 1440×1000; mobile is 390×844. Captures are full-page except open dialogs, which use the viewport. Consequently image heights can exceed the viewport and fixed navigation can appear partway through a full-page image. Captures use reduced motion.

| Coverage | Desktop | Mobile |
|---|---|---|
| Company management | Overview, operations, inventory, growth, upgrade review, ownership | Overview, operations |
| Company creation | Opportunity, premises, budget, review, first production | Opportunity, premises, review |
| Marketplace | Exchange, trade review, supplier contract | Exchange, trade review, supplier contract |
| Other | Supply chain, component states | Supply chain |

All 25 report entries pass the page-overflow check. Both device journeys report empty error arrays (page errors and HTTP responses ≥400 monitored by the script). Recorded flows cover settings save, four-step creation, first setup, quote/confirm, partial-remainder cancellation and the contract dialog. Passing fixture journeys do not establish live economic correctness.

## Focused behaviour checks

[behaviour-report.json](qa/behaviour-report.json) reports `passed: true` for:

- Operations draft preservation across tabs and discard restoration; arrow-key tab selection.
- Insufficient funds blocking quote review without draft loss; seller fee display; Escape close and trigger-focus restoration.
- Quote expiry disabling confirmation with recovery copy; protected market-order proposal naming IOC/capability requirements.
- No page overflow at 360, 768 and 1199px on management, creation, marketplace and supply-chain routes.
- Explicit accessible names on all five tablet rail links (F1).
- Skip-to-content focus reaching the existing main landmark without changing creation/exchange routes or the market draft (F2).
- DPR 2, reduced-motion mobile trading buttons measuring at least 44px tall.

## Review disposition

The reviewer returned **ship / pass for the F1 and F2 remediation scope**. F1 (tablet labels) and F2 (skip-link routing) are resolved. The follow-up reviewed corrected source, the behaviour report and a regenerated marketplace screenshot. It did not independently execute the tests or perform a new whole-surface audit; this disposition is not blanket production acceptance or user visual approval. Manifest assets still carry visual approval pending status.

## Verification boundaries

No backend was tested or changed. No actual screen-reader session, human under-five-minute onboarding/usability study, production load test or full-device matrix was performed. Accessibility evidence is limited to the documented automated behaviours, source semantics and visual checks. DPR 2 coverage is specifically the mobile trading-control check, not certification of every sprite or screen at that density. Before release, integrate authoritative capabilities and data, then test real server outcomes, concurrency, permissions, accessibility and the new-player timing target described in [CLAUDE-HANDOFF.md](CLAUDE-HANDOFF.md).
