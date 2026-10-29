# In-game integration

- Bristol renders the cargo ship as harbour scenery, in addition to the worker loops, moving pedestrians, delivery replay and NPC portraits integrated in PR #21.
- Delivery replay movement follows a 2:1 isometric line.
- The main navigation includes **Beyond Bristol** (`/world`): London, Lisbon, Mexico City, freight port and air freight environments. These are explicitly marked as future destinations, with no expansion or shipping transactions.
- Prestige shows the executive office interior as an unavailable future cosmetic. No entitlement, payment, or economic modifier is invented.
- Cloudflare production must build `deploy/cloudflare-test-link`, which contains the application. `main` is the art-only branch and is not a deployable game. The existing Workers build configuration was watching `main`, while application-branch updates ran the unconfigured preview command instead.

Validation: production build and 24 fixture/server-source tests passed locally. Existing 386-test CI suite runs on the integration PR. Live deployment uses the existing EconomyDO binding and migration, without resetting game data.
