# Deploying Penny Empire to Cloudflare

**What is deployed:** one Cloudflare Worker named `pennyempire` (`wrangler.jsonc`):
- the Vite build (`dist/`) as static assets with single-page-app fallback, so `/exchange`, `/shares` etc. load on refresh;
- `server/worker.ts` handling `/api/*` and the economic engine as a SQLite-backed Durable Object (`EconomyDO`). Developer endpoints are off (`DEV_ENDPOINTS=false`).

The Node-only pieces (`server/node.ts`, `server/cli.ts`, `node:sqlite`) are **not** bundled into the Worker; they are for local dev, simulations and tests.

## Private alpha (accounts)
The Worker requires accounts by default (`REQUIRE_AUTH="true"` in `wrangler.jsonc`). Set the operator secret with `npx wrangler secret put ADMIN_TOKEN`, then follow `docs/ALPHA.md` to create the first admin invite. Never put the token in `wrangler.jsonc` or the repository. Existing Durable Object data is kept: migrations 0006–0008 are additive and run on first request.

## Cloudflare setup (one-off)
The existing `pennyempire` Worker was created from the dashboard "Hello world" template. Replace it with this repo:

**Option A — Workers Builds (dashboard):** Workers & Pages → `pennyempire` → Settings → Builds → connect `heinrichmakernthings/pennyempire`, production branch `main` (or `deploy/cloudflare-test-link` until merged), build command `npm ci && npm run build`, deploy command `npx wrangler deploy`. Root directory `/`.

**Option B — GitHub Actions:** add secrets `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers template) and `CLOUDFLARE_ACCOUNT_ID`, and set repository variable `CLOUDFLARE_DEPLOY=true`. `.github/workflows/deploy.yml` then deploys on every push to `main`.

**Option C — manual:** `npm ci && npm run build && npx wrangler login && npx wrangler deploy`.

## Verified locally
`npm ci`, `tsc -b`, `vitest` (386 tests), `vite build`, `wrangler deploy --dry-run`, and `wrangler dev --local` (SPA routes return the app, `/api/health` answers from the Durable Object, no console errors).

## Root cause of the failing builds
`.gitignore` contained an unanchored `data/` rule that also ignored `src/data/*`, so `shareClient.ts`, `managementApi.ts`, `exchangeClient.ts` and `serverSource.ts` were never committed and every clean checkout failed to compile. The rule is now `/data/` and the files are committed.

## Known requirements / limits
- `main` currently holds only docs; the app lives on the stacked PR branches (#5 → #17). Merge those in order (or point Workers Builds at this branch) for the production branch to contain the app.
- The Durable Object world starts fresh per deployment name; there is no persistent backup yet.
- No custom domain or Cloudflare Access is configured; keep `DEV_ENDPOINTS=false` on public environments.

**World pace.** One in-game day takes 10 real minutes (`realMsPerTick` 600 000). A world created before Prompt 12 on the old one-minute pace is moved by seed patch `pace-v1` on its next start, and the clock is re-anchored so no day is skipped or replayed. Change it with `POST /api/admin/param` (key `realMsPerTick`, 1 minute to 24 hours); see `docs/PLAYABILITY.md`.
