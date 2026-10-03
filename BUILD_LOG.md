# BUILD_LOG — SignalStack

Signal-stacking ICP finder on DeepSpace. GTM Engineer take-home.
Deadline: Mon Oct 5 2026 23:59 ET. Repo submitted to GitHub.
Name: **signalstack** → `signalstack.app.space`. CRM: **HubSpot via Composio**.

---

## 2026-10-02 — Phase 0: Ground truth

### Environment
- node v25.9.0 initially → **unsupported** by the scaffolder (needs 22.15+, 24, or 26; odd 25 excluded). Installed Node 24.21.0 via nvm; all subsequent commands run under `nvm use 24` (npm 11.19.0 ≥11.6 ✓).
- `deepspace` CLI v0.17.0 → v0.34.0 (create-deepspace). Harshit logged in himself (brief rule); authed as Harshit Sharma (developer account).
- Scaffold installs the `deepspace` agent skill at `.agents/skills/deepspace/SKILL.md` — read it. Followed its + the brief's reading procedure (docs.deep.space/llms.txt → `.md` pages → `.d.ts`).

### Integration catalog (`npx deepspace integrations list`, pre-auth OK)
45 providers / 303 endpoints. Relevant:
- **Search/scrape**: `firecrawl/{search,scrape,crawl,map}`, `exa/{search,news-search,...}`, `serpapi/*`, `websearch/advanced-search`, `dataforseo`.
- **LLM**: `anthropic/chat-completion` (default `claude-opus-5-5`; `claude-haiku-4-5` standard-priced), plus openai/gemini.
- **CRM**: NO first-class CRM. Path = **`composio/*`** per-user OAuth meta-integration.

### Key endpoint shapes
- `firecrawl/search` in `{query*, limit(1-50,def5), lang, country, scrapeOptions}` → `{data, creditsUsed, costUsd}`. **No recency param** (brief contradiction).
- `anthropic/chat-completion` in `{model, max_tokens, messages[], system, temperature}` → raw Anthropic Messages. **No JSON-mode** (contradiction).
- `composio/initiate-connection {toolkit*,callbackUrl,scopes}` → hosted per-user consent URL. `composio/execute-tool {slug*,arguments}` → runs on calling user's account, `requiresConnection` if not connected. Plus get/list/disconnect + list-toolkits/list-tools for slug discovery (Phase 4, needs auth).

### Decisions & contradictions (Checkpoint 0 — approved)
1. CRM = **Composio per-user OAuth**, target **HubSpot** (Harshit's pick). Legit primitive, not a workaround.
2. `firecrawl/search` has no recency param → bake time terms into queries + route funding/launch via `exa/news-search`. (technical, logged)
3. `anthropic/chat-completion` has no JSON-mode → do structured extraction/judging via worker AI SDK (`createDeepSpaceAI` + `generateObject` + Zod) inside the job. (technical, logged)
4. Cron is app-level → one daily global task iterates ICPs with `rescanEnabled` and enqueues a scan job per owner.
5. Models: `claude-haiku-4-5` (bulk signal checks), Sonnet (fit rationale + openers; exact id confirmed at Phase 2).
6. Reusable features to pull later: `landing`, `cron`, `sidebar`/`topbar`, `search-bar`. Reference repo `threadhunt` matches our architecture 1:1.

---

## 2026-10-02 — Phase 1: Scaffold & data model

### Scaffold
- `npm create deepspace@latest signalstack` (Node 24). Registers app id on first id-needing verb (dev/test/secrets/deploy). Source authority still **unclaimed** — latches to GitHub at first deploy from the GitHub checkout. **Never run `deepspace push`** (would latch DeepSpace source).
- Confirmed `signalstack.app.space` free (HTTP 404; control apps threadhunt/storynest = 200).

### Schemas (`src/schemas/`, wired in `src/schemas.ts`)
Verified exact types in `node_modules/deepspace/dist/schema.d.ts` before writing (`ColumnDefinition`, `PermissionLevel`, `uniqueOn`, `ownerField`, `writableFields`, `interpretation` kinds).

Six new collections, all **private per user** via `ownerField: 'ownerUserId'` + `read/update/delete: 'own'`:
- `icps`, `feedback` — client-created; `ownerUserId` is `userBound` (can't forge another's id).
- `accounts`, `signals`, `scans`, `crmPushes` — `member.create: false` (server/job writes only); `ownerUserId` `immutable`.
- `accounts.member.update` limited via `writableFields: ['status','statusReason']` so clients triage but can't tamper with heat/fit.
- Dedup: `accounts` uniqueOn `[ownerUserId, domain]`; `signals` `[ownerUserId, accountId, sourceUrl, type]`; `crmPushes` `[ownerUserId, accountId]` (re-push updates, no dup).
- `users` schema kept unmodified.

**Write path confirmed** (from `worker.d.ts`): `JobContext` has no records API; `buildCronContext(env, ownerUserId, roomId)` → `records.{query,create,update,delete}` + `integrations.call` (app-owner billed). The scan job builds it with `job.enqueuedBy` to stamp `ownerUserId` (RBAC-bypassed). CRM push → server action with user's JWT (Composio user-billed).

### Caps & billing
- `src/constants.ts`: `MAX_SCANS_PER_DAY=5`, `MAX_QUERIES_PER_SCAN=12`, `MAX_RESULTS_PER_QUERY=10`, `HALF_LIFE_DAYS=21`.
- `src/integrations.ts`: `composio: 'user'` (required), `firecrawl`/`anthropic` `'developer'` (job runs app-owner; scan cap bounds spend).

### Heat scoring (`src/lib/heat.ts` + `heat.test.ts`)
Pure module: `decay = 0.5^(age/halfLife)`, `intent = 1 − Π(1 − w·d)`, `heat = round(fit × (0.35 + 0.65 × intent))`. Weights funding .8 / hiring .7 / launch .6 / stack .5 / other .3. Tests cover: no signals, one fresh signal, same signal aging, two-vs-one (diminishing returns), boundaries (fit 0/clamp/ceiling), decay half-life, order-independence, `ageInDays`.

---

## 2026-10-02 — Phase 2: Scan engine (Checkpoint-1 changes folded in)

### Checkpoint-1 changes applied
1. Heat computed at render time (client) — stored `heat`/`intent` are a cache; `fit` (LLM, no decay) is authoritative. (schema comments + heat.ts shared.)
2. Daily cap enforced in `startScan` action (counts caller's last-24h scans) AND hard-enforced in `runScan` (closes direct-enqueue bypass). Cron rescans count the same.
3. `triageAccount` action: verify ownership → update account status + write feedback atomically. `feedback`/`accounts` are now server-write-only.
4. Job trusts `job.enqueuedBy` (set by the action), loads the ICP, verifies `ownerUserId === enqueuedBy`; payload ids never trusted.
5. `crmPushes.uniqueOn = [ownerUserId, toolkit, accountId]`; `signals.provider` added.

### Search rules (Harshit)
One provider per query — Exa = semantic company-discovery, Firecrawl = keyword/news triggers (funding/hiring/launch). `MAX_QUERIES_PER_SCAN=12` combined. Provider stored on every signal; per-provider FP + cost reported here.

### Verified integration shapes (real probes, billed)
- `firecrawl/search` → `{data:[{url,title,description,position,markdown,metadata}], creditsUsed, costUsd}`. `description` is the reliable snippet (`markdown` can be a bot-wall page, e.g. TechCrunch Cloudflare). `metadata.publishedTime` dates it. ~$0.0038/result.
- `exa/search` → `{results:[{title,url,publishedDate,author,text}], costUsd}` (`contents.text` for evidence; `startPublishedDate/endPublishedDate` for recency). ~$0.0035/result.
- News URLs ≠ company domain → LLM extracts the company's OWN domain from the text.

### Models (verified ids in DEEPSPACE_AI_MODELS)
`claude-haiku-4-5` (bulk judging), `claude-sonnet-5` (query expansion, fit, openers). Structured output via worker AI SDK `createDeepSpaceAI` + `generateObject` + zod (the raw anthropic endpoint has no JSON mode). Scan runs owner-billed (no authToken).

### Engine (`src/lib/scan/*`, `src/jobs.ts`, `src/actions/index.ts`)
`queries.ts` (expand→≤12, provider+signalType each) → `search.ts` (one provider/query, dedupe by URL, per-provider cost) → `judge.ts` (Haiku, batches of 8, extract company/domain/date/quote/confidence) → filter (`MIN_CONFIDENCE=0.55` + plausible domain + evidence) → `run.ts` upserts accounts (dedupe by domain) + signals (dedupe by account+url+type), scores fit (Sonnet, with recent-feedback calibration), caches heat/intent, writes live progress to the `scans` record. `buildCronContext` is the server write path; all writes stamped with trusted `owner`.

Local trigger (backend-first, UI is Phase 3): dev-only guarded actions `__devSeedPresetIcp` / `__devScanReport` / `__devReset` (gated by `ALLOW_DEBUG_ROUTES` + admin); production path is `startScan` → job. Owner JWT from `.dev.vars` authenticates action calls locally.

### First run: bug + fix
First scan: 12 queries → 102 candidates → 50 signals, then **failed** at `loadFeedbackExamples` — `ctx.records.create` returns `{recordId}` only (MutateActionData), not the full envelope; I'd stored the bare object in the domain map and later read `.data`. Fixed by rebuilding the account envelope locally from the written data. Added `__devReset` to clear partial data between runs.

### Second run — clean (Checkpoint 2 data)
DeepSpace preset, 1 scan. **12 queries → 98 candidates → 32 accounts, 32 signals stored.** All 5 top source URLs verified HTTP 200.

Per-provider (this scan):
| Provider | Queries | Hits | Judged signals | Stored | Dropped (low-conf/no-domain) | Search $ |
|---|---|---|---|---|---|---|
| Exa | 5 | 50 | 30 | 28 | 2 | $0.035 |
| Firecrawl | 7 | 48 | 4 | 4 | 0 | $0.053 |

**Exa is far higher ROI** (28 signals/5 queries) than Firecrawl (4 signals/7 queries) — Firecrawl's news hits often have no extractable company-own-domain. But Firecrawl caught funding news Exa missed (Mastra $13M, Smallest.AI $8M). Recommendation to Harshit at Checkpoint 2: rebalance toward Exa, keep a small Firecrawl funding allocation, or drop Firecrawl.

Cost (from `app usage`, credits ≈ cents, 500 free = $5): this scan ≈ **$1.09** total — anthropic dominates (~$0.86 cum across both runs / 120 calls), driven by **32 Sonnet fit calls**. Search ~$0.09. → ~4–5 scans exhaust the free tier. Optimization options noted: gate fit scoring to stronger accounts, batch fit, or use Haiku for fit.

False positives (my spot-check; Harshit to hand-verify the 32): top-10 all clean true positives; ~5–6 borderline lower down are infra/sync peers-or-competitors (Liveblocks, PowerSync, Stacksync, RushDB) or too-large (DevRev) or a weak code-snippet hit (mk0r) — and heat/fit correctly ranks these at the bottom. Rough FP ≈ 15–19%, concentrated in the tail. One minor type mislabel: Piston's seed-funding evidence tagged `hiring`.

Known edges: single run shows ~1 signal/account (stacking emerges across scans over time, by design); fit scoring doesn't yet honor `ctx.signal` cancellation mid-loop; small race between cap-check and scan-create under concurrent enqueues (action pre-check covers normal UX).

### Checkpoint-2 decisions (Harshit) — applied + validated
1. **Rebalance toward Exa**: `MAX_FIRECRAWL_QUERIES=3`; expansion favors Exa, deterministically caps Firecrawl.
2. **Gate fit scoring**: full Sonnet fit only for accounts with `intent ≥ FIT_INTENT_THRESHOLD (0.4)`, capped at `MAX_FIT_SCORES_PER_SCAN=20`; the rest get a cheap deterministic `heuristicFit` (≤60, honest rationale, promoted to Sonnet when signals strengthen).

Validation scan (3rd run): 9 Exa + 3 Firecrawl queries → 97 candidates → **44 accounts / 45 signals** (more coverage than the 32 before), fit log `20 Sonnet calls, 24 heuristic`. Cost **~$0.57** (57 credits) vs ~$1.09 before — **~48% cheaper with better coverage**. Exa 9q→41 stored; Firecrawl 3q→4 stored.

---

## 2026-10-02 — Phase 3: UI (core flow end to end)

### Design — "signal desk"
Own theme `signal` in themes.css (deep ink `#0b0e14`, cool slate panels, one calm cyan accent `#4cc3e0`), registered in themes.ts, wired in index.html (data-theme + first-paint bg). Heat has its OWN gradient scale (cool→hot) in `src/lib/heat-ui.ts` so the single accent doesn't fight it. Dense, keyboard-first.

### Pages (Generouted)
- `index.tsx` — static landing (prerendered, no hooks): hero, trigger chips, 3 feature cards.
- `(app)/home.tsx` — redirects to `/board` (auth lands on /home).
- `(app)/(protected)/board.tsx` — **the Board**: heat-ranked rows (heat computed at RENDER time from live signals via heat.ts), Run scan + live progress banner (subscribes to the `scans` record), filter tabs + search, keyboard **j/k move · a/r triage · Enter/o open · Esc close**, account drawer.
- `(app)/(protected)/icp.tsx` — ICP editor, preset-prefilled, `useMutations('icps')` (ownerUserId auto-stamped); Save disabled until `ready`.
- `(app)/(protected)/scans.tsx` — scan history with status/counts/cost parsed from summary.
- `components/`: `HeatBar`, `AccountDrawer` (signal timeline w/ evidence + source links, fit rationale, **Draft opener** via `draftOpener` action + copy, Accept/Reject with reason via `triageAccount`).

### Server bits
- `draftOpener` action (Sonnet, grounded in strongest recent signal, owner-billed, draft-only).
- Client `callAction` helper (`src/lib/actions.ts`) — `getAuthToken` + POST `/api/actions/:name`.

### Verified in browser (test account, real dev server)
Signed in with a `@deepspace.test` account (local dev host → allowed). Landing ✓, auth gate ✓, ICP editor preset-prefill + save ✓, Board ICP recognition + Run scan + **live progress banner** ✓.

### Bug fix
Board/ICP first used `useQuery('icps', { where: { active: true } })` — `active` is a boolean stored as a number (0/1), so the equality `where` didn't match and the Board showed "No ICP yet" after saving. Fixed: query without the boolean `where`, filter `active` client-side.

### Stubbed / deferred (for Checkpoint 3)
- **Push to CRM** button is present in the drawer but disabled ("ships in the next step") — Phase 4.
- Daily rescan cron — Phase 4.
- `ctx.signal` cancel not wired into the scan loop.

---

## 2026-10-02 — Phase 4 pre-work: fixes

### 1. Boolean query bug — diagnosed (not worked around)
Root cause in SDK source `node_modules/deepspace/dist/worker.js:2156` (`executeTableQuery`): the query `where` builds `"col" = ?` and binds the **raw** value — it does NOT run it through `coerceValue` the way writes do (`coerceValue` at :547 maps boolean→1). A `boolean` column is `storage:'number'`, stored as integer `0/1`, so `where: { active: true }` binds JS `true` and never equals the stored `1`. **Fix:** query on the stored form — `where: { active: 1 }`. Verified live: the Board now recognizes the active ICP and renders accounts. Reverted the client-side filter; using the real query filter. (Limitation to remember: query `where` is exact-equality on the *stored* representation — use `1/0` for booleans, and it can't express ranges.)

### 2. Opener caching
Added `opener` + `openerSignalId` columns to `accounts`. `draftOpener` stores the opener + the signal id it was grounded in; the drawer shows the cached opener on open (no model call) and only re-calls on an explicit **Regenerate**. A staleness hint appears when newer signals have arrived. Cost decision: openers are the most-reopened per-account LLM output; caching avoids paying every time a card is reopened. Verified live (reopen shows cached opener + Regenerate, no call).

### 3. Failure path
- Scan errors/timeouts end as `status: 'failed'` with a readable `errorMessage`; the Board banner stops (shows the red failed notice). Verified via a forced failure (`__forceFail`, dev-only) → `status failed`, reason set, `finishedAt` set, progress frozen. Also seen live when the Sonnet cap failed a real scan (banner: "Scan failed: Payment Required").
- **Stale-running reaper**: a hard-killed DO alarm can't update its scan record, so `startScan` marks any of the caller's `running` scans older than `SCAN_STALE_MINUTES` (15) as `failed` ("Interrupted — exceeded the time limit"), and the Board treats a stale-running scan as interrupted (enables Run scan). 
- **Cap rule (logged):** EVERY started scan counts against `MAX_SCANS_PER_DAY`, success OR failure — a failed scan may already have spent on search/LLM, so counting it prevents retry-storms. The action pre-check and the job hard-check both count all statuses within 24h.

### 4. First-time empty state (product decision: honest, no sample data)
Before any scan, the Board shows a one-line explanation of what SignalStack does, a primary **"Run scan with the DeepSpace preset"** button (one click: auto-creates the preset ICP if none, then scans), the measured duration ("about 3 minutes" — measured 189s), and what heat means. During a scan the live banner is the main content and accounts stream in as they're verified (the job writes accounts incrementally in the attach step). Verified live on a fresh account.

---

## 2026-10-02 — Phase 4: CRM push (HubSpot via Composio) + cron

### CRM target: HubSpot via Composio (why)
No first-class CRM integration exists; Composio provides **per-user OAuth** (`initiate-connection` → hosted consent URL; `execute-tool` runs on the *calling user's* connected account). HubSpot chosen (Harshit's pick): free tier, easy test account, strong Composio tool coverage. `composio` is `billing: 'user'` so each push lands in that user's own CRM.

Discovered slugs (via `composio/list-tools` + `get-tool`): `HUBSPOT_SEARCH_COMPANIES` (dedupe by domain, `filterGroups`), `HUBSPOT_CREATE_COMPANY` (flat props), `HUBSPOT_UPDATE_COMPANY` (`{companyId, properties}`), `HUBSPOT_CREATE_NOTE` (`{hs_note_body, hs_timestamp, associations}`, note→company assoc typeId 190).

### 5. `buildCrmPayload(account, signals, heat)` — single source of truth
`src/lib/crm.ts` (pure, unit-tested): produces the exact HubSpot company fields + the note text (signals, sources, why-now) + the dedupe key (domain). Both preview and push call it, so they can't disagree.

### 6/7. Drawer CRM + push
`crmStatus` (list-connections → connected?), `crmConnect` (initiate-connection → hosted URL), `crmPreview` (buildCrmPayload, **works without connecting**), `crmPush` (search by domain → create-or-update company → create+associate note → upsert `crmPushes` with external id + "View in HubSpot" link). `crmPushes.uniqueOn [ownerUserId, toolkit, accountId]` makes a second push UPDATE, not duplicate. Not-connected and failures return clean codes (`not_connected`, `crm_error`), never silent. **Verified live (non-connected user):** Preview shows dedupe key + company fields + note; "Connect HubSpot" button shown. Real push + re-push to a connected HubSpot = **Checkpoint-4 demo with Harshit** (needs his OAuth); the exact HubSpot response shapes (company-id extraction, note assoc, portal-id deep link) are validated there.

### 8. Daily rescan cron
`src/cron.ts` `daily-rescan` (09:00 America/New_York): iterates every ICP with `rescanEnabled` (RBAC-bypassed `where:{rescanEnabled:1}`), and for each, if the owner is under `MAX_SCANS_PER_DAY`, enqueues a scan as that owner. **Verified live** via `__devRunCron` (dev-only): `[cron] daily-rescan: 1 rescan-enabled ICP(s), enqueued 1, skipped 0 (cap)`, and a scan actually started. Schedule arms on the app's first request (armCronRoom middleware).

### Bug found + fixed: ICP updates silently rejected
Toggling rescan never persisted. Cause: the ICP editor sent `ownerUserId: ''` in the update payload, but `ownerUserId` is **immutable** → the DO rejected the entire `put` (`'' !== storedId`). (Create worked because create ignores immutability and userBound stamps it, which masked the bug.) Fix: omit `ownerUserId` from the editor payload entirely (auto-stamped on create, untouched on update). This had been breaking ALL ICP edits, not just rescan.

### Free-tier Sonnet cap + model fallback (robustness)
During heavy testing the account's free tier (500 credits ≈ $5) passed its paid-model budget, so `claude-sonnet-5` via the AI-SDK proxy began returning **402 Payment Required** (Haiku still fine; owner-billed Sonnet via the *integration* endpoint still allowed — it's a proxy/tier cap, not auth or credit exhaustion — 249 credits remained). Added graceful **Sonnet → Haiku fallback** to query expansion, fit scoring, and openers, so scans and openers keep working under the cap (lower rationale quality, still functional); fit falls back to the deterministic heuristic only if both models fail. On a paid tier / fresh cycle, Sonnet is used as intended.

### Checkpoint-4 CRM verification outcome (honest)
Done live with Harshit:
- **Preview (non-connected):** ✓ shows dedupe key + company fields + note.
- **Connect flow:** ✓ `crmConnect` → Composio `initiate-connection` returns a real hosted consent URL (`connect.composio.dev/link/...`).
- **crmStatus bug found + fixed:** it read `data.items` but Composio returns `data.connections` (each with an `active` flag) — so it ALWAYS reported "not connected" ("stuck at connecting"). Fixed (`connectionsOf`/`isActive`), applied to the portal-id lookup too. Also made Connect popup-proof: a visible "Open HubSpot consent" link + "I've connected — recheck".
- **Push reaches HubSpot correctly:** `crmPush` → `HUBSPOT_SEARCH_COMPANIES` executed; on the `signalstack-demo` test account it returned a clean **"Insufficient credits"** error surfaced as a non-silent "Push failed" toast. This CONFIRMS the per-user billing model (composio `billing: 'user'`): each push is charged to the calling user, and the zero-credit test account is correctly blocked.
- **NOT verified against live HubSpot** (Harshit opted to assume it works rather than push from a funded account): the actual company create/update, note create+association (typeId 190), domain dedupe, re-push-updates, and the portal-id deep link. Built to the exact Composio tool schemas (`get-tool`), but the live response shapes are unconfirmed. **Flag this clearly in the writeup as the one unverified path.**

### Forced-failure + cron (Checkpoint-4 demos done)
- Forced-failure scan: ✓ `status: failed` + readable reason + banner stops + counts against cap.
- Cron: ✓ `[cron] daily-rescan: 1 rescan-enabled ICP(s), enqueued 1, skipped 0 (cap)` and a scan started.

All green: `tsc`, `lint`, 28 unit tests (heat + crm payload).

---

## 2026-10-02 — Phase 5: Tests (deploy gated on GitHub remote)

### Test suite — all passing
- **Unit (vitest, `npm run test:unit`):** 28 pass — `heat.test.ts` (23) + `crm.test.ts` (5, proves preview/push payload parity).
- **E2E (`npx deepspace test run all`, Playwright):** 12 pass — smoke (6), api (2), collab (2), **isolation (1)**.

### Two-user isolation test (`tests/isolation.spec.ts`) — the security-critical one
Seeds each user one account+signal via a dev-only `__devSeedAccount` action (gated by `ALLOW_DEBUG_ROUTES`, non-admin so test members can seed; refuses in prod) — no real scan needed. Calls authenticated actions from each signed-in browser context via a `window.__callAction` test hook. Asserts:
- **Read:** A's Board shows A's company; **B's Board shows B's own but never A's** (RecordRoom drops unauthorized rows before the wire).
- **Write:** B's `triageAccount` on A's account → refused.
- **Push:** B's `crmPush` on A's account → refused (before any CRM call).
- **Sanity:** A *can* triage its own account (so the refusals are real, not false negatives).
Logs confirm the path: `__devSeedAccount` for both users, B's refused `triageAccount`/`crmPush`, A's accepted `triageAccount`.

### Deploy — PAUSED (Harshit's call)
Harshit sets up the GitHub repo + remote before the first `deepspace deploy` (deploy latches source authority to GitHub, permanently). **I have not deployed and will never run `deepspace push`.** Pending: deploy from the GitHub checkout, then `logs`/`releases`/`app usage` checks + a live smoke test with a fresh account.

Note: the test runner starts its own vite on :5173 with `--strictPort`, so the local dev server must be stopped first (it was).
