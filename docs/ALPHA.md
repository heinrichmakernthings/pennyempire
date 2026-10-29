# Private multiplayer alpha — operator guide

Penny Empire's private alpha is one shared, server-authoritative Bristol on Cloudflare. A single Durable Object owns the world, and every player is a real account bound to one `players` row. NPC companies and NPC investors keep the economy moving when no one is online.

## What players get
- **Invite-only accounts.** A single-use invite code (valid 14 days) is required to register. Usernames are 3–20 characters (`a-z 0-9 _`), passwords are 10–200 characters, and display names are 2–32 characters (sanitised).
- **Sessions.** A random 256-bit token lives in an `HttpOnly; SameSite=Lax` cookie (`Secure` on HTTPS) for 30 days. Only its SHA-256 digest is stored. Logout revokes it on the server, and **Sign out everywhere** revokes all of them.
- **Passwords.** Stored as PBKDF2-SHA-256 hashes with 100,000 iterations and a per-user salt, computed with WebCrypto, which both Node and Workers provide. Changing a password signs out all other devices.
- **Recovery.** There is no email in the alpha. An administrator issues a single-use **reset code** (valid 24 hours) and gives it to the player privately. The player uses *Reset password* on the sign-in screen.
- **Profile and settings.** Display name, pop-up alerts, reduced motion, and hiding the getting-started checklist.
- **Starting position.** 20,000 EC as a recorded `issuance` ("new player starting capital"), a separate SIMULATED GBP wallet at £0, and no company.
- **Onboarding.** A getting-started banner shows progress the server computes from what the player has actually done. Founding a company takes seconds, so meaningful progress comes within the first minute (the browser journey measures about 2 s).
- **Notifications.** Derived only from real events: their companies' events, commodity fills, share fills, dividends received, and city-wide economic events. The client polls every 15 s, and screens refresh on the engine's tick clock.

## What is enforced on the server
- Every request runs as the session's player. Commands check ownership (`FORBIDDEN` otherwise). Another player's management, financials, bank services and loan quotes return 403.
- Idempotency keys are namespaced per user, so retries and double-clicks execute once and players cannot collide with or read each other's command results.
- **Cross-site writes are refused.** For every non-GET request, the Origin host must match the Host header.
- **Rate limits.**
  - Login: 5 failures per username, or 20 per IP, within 15 minutes locks further attempts.
  - Registration: 10 failed invite attempts per IP.
  - Actions: 40 per 10 seconds per player.
- Every game route requires a session when `REQUIRE_AUTH` is not `false`; the Worker defaults to requiring one. `/api/health` stays public.
- `/api/admin/*` needs an admin-role session or the `ADMIN_TOKEN` header. Every admin action, including denied attempts, is written to `admin_log`.
- There is **no route that edits a balance.** Coins only move through ledger rules, and simulated pounds only through the GBP_TEST ledger's own operations.

## Setting up the alpha on Cloudflare
1. Deploy the `release/private-alpha-v01` build (see `docs/DEPLOYMENT.md`).
2. Set the operator token as a secret, never in `wrangler.jsonc`:
   ```bash
   npx wrangler secret put ADMIN_TOKEN
   ```
   Use a long random value of at least 12 characters.
3. Create the first administrator invite:
   ```bash
   curl -X POST https://<your-worker-host>/api/admin/invites -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" -d '{"role":"admin","note":"organiser"}'
   ```
4. Open `https://<your-worker-host>/?invite=<code>` and create the organiser account. From then on, use **Admin → Players & invites** to invite players. Invite links have the form `/?invite=<code>`.
5. Keep `DEV_ENDPOINTS=false` and `REQUIRE_AUTH=true` (both are the `wrangler.jsonc` defaults).

## Admin console (`/admin`)
- **System health:**
  - Day, failed ticks and tick time.
  - Empire Coin ledger reconciliation (issued, destroyed, circulating) and GBP_TEST ledger reconciliation (SIMULATED).
  - Companies by owner and status, open orders, today's trades, NPC decisions and active economic events.
  - Recent rejected actions and the reward-budget view.
- **Players & invites:**
  - Create player or admin invites; each code is shown once.
  - Issue reset codes, sign a player out everywhere, disable or enable an account.
- **Economy controls:** trigger an economic event (type, severity, days, required reason) and set the central bank base rate. The server bounds both and logs them.
- **Audit log:** every admin action, with its actor.

## Local alpha mode
```bash
npm run build
```
```bash
PENNY_REQUIRE_AUTH=true PENNY_ADMIN_TOKEN=some-long-local-token npm run server
```
```bash
npx vite preview
```
`npm run qa:alpha` runs the same flow in real browsers: a desktop player, a phone player and an administrator.

## Verification
| Check | Command | Result |
|---|---|---|
| Unit, integration, playtest, security | `npm test` | 508 tests pass |
| Two-player §19 playtest | `server/api/alphaPlaytest.test.ts` | farm→wheat→mill→flour→pizza between two accounts, IPO, B buys shares, dividend paid to B, prestige, admin recession, simulated £5 reward and £5 withdrawal, restart from disk |
| Security and concurrency | `server/api/alphaSecurity.test.ts`, `server/api/accounts.test.ts` | 19 tests: simultaneous buyers, replays, invalid input, escalation, forged or expired sessions, CSRF, rate limits, ownership |
| Stress | `npm run alpha-stress` → `docs/scenarios/alpha-stress.md` | 1, 10 and 100 players; 300 simultaneous orders; recession + inflation + energy shortage with a bankruptcy; 180-day NPC run. All invariants hold |
| Browser | `npm run qa:alpha`, `npm run qa:browser` and the 6 feature journeys | 19/19, 118/118, all journeys pass |
| Worker runtime | `wrangler deploy --dry-run`, `wrangler dev --local` | bundles; health, 401 for anonymous, invite registration (WebCrypto PBKDF2), login, SPA routes and CSRF refusal all work under workerd |

## Known issues and limits
- **Land is scarce:** Bristol has 10 vacant lots (4 industrial, 6 retail). With 100 players, 10 could found a company and 90 were refused for lack of a free lot. Everyone can still trade shares, buy prestige and use the wallet. A private alpha should stay at about 10 players until the map grows.
- Idle player companies can fail: in the 10-player run, 3 of 9 untended companies were insolvent or closed after 30 days. This is the intended simulation, but new players need the checklist and notifications to notice.
- The live Cloudflare URL could not be verified from the build environment, because its network policy blocks Cloudflare hosts. The deployed Worker still served an older build at last check.
- One Durable Object serves the whole world. Ticks take about 80–130 ms on average and about 280 ms at most in stress runs. That is fine for the alpha but is the scaling ceiling.
- No backups or export of the Durable Object yet.
- No email: password recovery depends on an administrator.
- The action rate limiter is in memory (per instance). Login limits are persistent.
- The GBP wallet, deposits, rewards and withdrawals are **SIMULATED** and connected to no payment provider. Real-money activation is out of scope and must stay separate. It needs legal review, licensing and safeguarding first. Coin lotteries are coin-only and cannot be converted to cash.
