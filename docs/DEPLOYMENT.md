# Deploying Penny Empire to Cloudflare

**What is deployed:** one Cloudflare Worker named `pennyempire` (`wrangler.jsonc`):
- the Vite build (`dist/`) as static assets with single-page-app fallback, so `/commodities`, `/stocks` etc. load on refresh;
- `server/worker.ts` handling `/api/*` and the economic engine as a SQLite-backed Durable Object (`EconomyDO`). Developer endpoints are off (`DEV_ENDPOINTS=false`).

The Node-only pieces (`server/node.ts`, `server/cli.ts`, `node:sqlite`) are **not** bundled into the Worker; they are for local dev, simulations and tests.

## Private alpha (accounts)
The Worker requires accounts by default (`REQUIRE_AUTH="true"` in `wrangler.jsonc`). Set the operator secret with `npx wrangler secret put ADMIN_TOKEN`, then follow `docs/ALPHA.md` to create the first admin invite. Never put the token in `wrangler.jsonc` or the repository. Existing Durable Object data is kept: migrations 0006–0008 are additive and run on first request.

## Cloudflare setup (one-off)
The existing `pennyempire` Worker was created from the dashboard "Hello world" template. Replace it with this repo:

**Option A — Workers Builds (dashboard):** Workers & Pages → `pennyempire` → Settings → Builds → connect `heinrichmakernthings/pennyempire`, production branch `main` (or `deploy/cloudflare-test-link` until merged), build command `npm ci && npm run build`, deploy command `npx wrangler deploy`. Root directory `/`.

**Option B — GitHub Actions:** add secrets `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers template) and `CLOUDFLARE_ACCOUNT_ID`, and set repository variable `CLOUDFLARE_DEPLOY=true`. `.github/workflows/deploy.yml` then deploys on pushes to `main` and `deploy/cloudflare-test-link`. Do not enable it until the release gates below are met.

**Option C — manual:** `npm ci && npm run build && npx wrangler login && npx wrangler deploy`.

## Verified locally
See [combined release QA](combined-alpha/README.md): 525 tests, 308 browser checks, production build, 360-day ledger simulation, Worker dry-run, and 14 local workerd checks. These are local results, not proof of a healthy deployed service.

## Root cause of the failing builds
`.gitignore` contained an unanchored `data/` rule that also ignored `src/data/*`, so `shareClient.ts`, `managementApi.ts`, `exchangeClient.ts` and `serverSource.ts` were never committed and every clean checkout failed to compile. The rule is now `/data/` and the files are committed.

## Known requirements / limits
- The combined candidate is `integration/combined-playable-alpha`, combining private-alpha commit `21a2ffb` and Phase 10 art/UX commit `5af35e3`. Review the combined PR instead of independently deploying the old stacked branches.
- Durable Object storage persists across updates to the same namespace. A differently named Worker/namespace can have a separate world. A project-specific backup/restore drill has not been verified; establish it before updating the existing world.
- No custom domain or Cloudflare Access is configured; keep `DEV_ENDPOINTS=false` on public environments.

## Release gates from the 29 October 2026 audit

The audited production build trigger still watches `deploy/cloudflare-test-link` at `5477ac7`; the combined candidate is not live. `/api/health` returned Cloudflare 1101. Earlier runtime logs reported the Durable Objects free-tier rows-written limit. Deploying frontend fixes alone does not resolve that quota.

Before a private playtest: confirm a sufficient write budget; verify storage recovery; provision `ADMIN_TOKEN` securely; retain `REQUIRE_AUTH=true` and `DEV_ENDPOINTS=false`; test the reviewed commit on an isolated staging Worker/namespace; repeat the invited two-player journey there. Then point the chosen deployment mechanism at the approved release. Do not enable two independent automatic deployment paths unintentionally. No production settings, secrets, billing or data were changed in the combined-release work.
