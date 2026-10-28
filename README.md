# Penny Empire

**Build a business. Own a city. Trade an empire.**

> Getting rich is fun. Staying rich is difficult. Every other player is either a customer, competitor, supplier or investment opportunity.

Penny Empire is a browser-first, mobile-friendly multiplayer economic simulation. Players establish local businesses, produce and trade goods, compete for city market share, own fictional company shares, and expand internationally.

## Status
**Pre-alpha / design foundation.** Bristol is the first playable city. All currencies and payment flows are **simulation-only**. There are no live deposits, cash withdrawals, cash-convertible game assets, or real-money gambling.

## Read first
- [Product brief](docs/PRODUCT-BRIEF.md)
- [Economic rules](docs/ECONOMY.md)
- [Architecture and safeguards](docs/ARCHITECTURE.md)
- [Visual and art brief](docs/VISUAL-BRIEF.md)
- [Milestones](docs/ROADMAP.md)

## Suggested build approach
- React + TypeScript + Vite for the browser UI.
- Cloudflare Workers for authenticated, server-authoritative game APIs; Durable Objects where useful for market matching and synchronisation.
- D1 or PostgreSQL-compatible persistence chosen after evaluating transaction guarantees, ledger requirements and deployment needs.
- Shared typed economic simulation and deterministic tests.
- Visual prototype first, then implement the actual economic core. Do **not** treat static mock numbers as game state.

## First slice
A player starts in Bristol, sees demand for flour, creates a flour mill or pizza shop, buys inputs from NPC/state or other players, sells outputs to local buyers, and watches profits, inventory and market share update.

## Project rules
See [AGENTS.md](AGENTS.md). Work on feature branches and submit pull requests. Never enable live financial transfers merely by changing a feature flag.

## Phase 1 implementation package

Start with [production readiness](docs/design/PRODUCTION-READINESS.md), then [Claude Code Prompt 1](docs/design/CLAUDE-PROMPT-1.md). The package includes screen specifications, shared TypeScript DTOs, a measured atlas manifest and a standalone art acceptance bench. Static integration is supported; final art certification and browser QA remain open. See the readiness report rather than treating source-image counts as completed production assets.
