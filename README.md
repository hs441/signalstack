# SignalStack

**A signal-stacking ICP finder.** Describe your ideal customer and the buying triggers you care about; SignalStack scans the public web, attaches each hit as an evidence-backed **signal** to a company account, and ranks accounts by **heat** — so you know *who to contact this week, and why now*.

🔗 **Live:** https://signalstack.app.space · built on [DeepSpace](https://docs.deep.space)

It ships with the **DeepSpace ICP preset** loaded, so the demo answers: *who should DeepSpace sell to this week?*

---

## What makes it different

Static lead lists don't tell a seller who to contact *now*, or why. SignalStack:

- Works at the **account level** — signals **stack** on a company over time and **decay** with age.
- **Cites a source** for every signal (URL + a short evidence quote) and every score.
- **Learns from your feedback** — accept/reject decisions calibrate future scoring (prompt calibration, not ML).
- Pushes accepted accounts to **your own CRM**, deduped and idempotent.

Not a one-shot list, not a thread-reply queue. Companies only, public web only, draft-never-send.

## Core flow

1. **Sign in** → land on an **ICP editor** pre-filled with the DeepSpace preset.
2. **Run scan** → a background job shows live progress (queries run, candidates found, signals verified).
3. **Board** ranks accounts by heat. Each card: company + domain, heat bar + fit, signal-type icons, a one-line "why now".
4. **Open an account** → signal timeline (date, type, evidence quote, **source link**), fit rationale, a **Draft opener** button, and **Accept / Reject** with a reason.
5. **Push to CRM** on an accepted account → create-or-update the company (deduped by domain), attach a note with signals + sources + why-now, and get a "View in CRM" link. A second push updates, never duplicates.
6. **Daily rescans** (opt-in) stack new signals and decay old ones.

Keyboard-first triage: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>a</kbd>/<kbd>r</kbd> accept/reject · <kbd>enter</kbd> open.

## Scoring — deterministic code, not vibes

The LLM only **extracts and judges**; code computes **heat** (`src/lib/heat.ts`, pure + unit-tested):

```
decay   dᵢ = 0.5 ^ (ageDays / 21)                 # 21-day half-life
intent     = 1 − Π(1 − wᵢ · dᵢ)                    # signals stack like independent probabilities
heat       = round( fit × (0.35 + 0.65 × intent) ) # fit sets the ceiling, intent decides how close
```

Type weights: funding 0.8 · hiring 0.7 · launch 0.6 · stack/pain 0.5 · other 0.3. Heat is recomputed **at render time** from live signals (a stored value goes stale as signals decay).

## Built on DeepSpace primitives

| Primitive | Used for |
|---|---|
| **Records + RBAC** | Every collection private per user (`ownerField`, `read: 'own'`, `userBound`, `immutable`, `uniqueOn` for dedupe). The RecordRoom drops unauthorized rows before the wire. |
| **Background jobs** (`JobRoom`, `buildCronContext`) | The scan runs past the HTTP response and streams live progress into a `scans` record the Board subscribes to. |
| **Server actions** | The authorization boundary — `startScan`, `triageAccount`, `draftOpener`, and the CRM actions, each re-checking ownership. |
| **Integrations proxy** | `firecrawl/search` + `exa/search` (web search), `anthropic` via `createDeepSpaceAI` + `generateObject` (structured output), **`composio/*`** (per-user CRM OAuth). |
| **Scheduled jobs** (`CronRoom`) | Daily rescan per opted-in ICP. |
| **Auth + UI scaffold** | Sign-in, protected routes, and the themeable components (restyled into the "signal desk" theme). |

**Models:** `claude-haiku-4-5` for bulk signal judging, `claude-sonnet-5` for fit rationale + openers (with a graceful Haiku fallback). **Search:** Exa for semantic company discovery, Firecrawl for funding/launch news.

**CRM:** per-user OAuth via **Composio** (HubSpot), `billing: 'user'` — each push lands in that user's own CRM, deduped by domain, idempotent on re-push.

## Guardrails

- **Companies only** — no person entities, no login-only sources (public web: job boards, funding news, HN, GitHub, company blogs, launch sites).
- **Evidence or it didn't happen** — a signal without a source URL + quote is never stored.
- **Draft, never send** — openers are for copy-paste; nothing is sent automatically.
- **Private per user** — enforced by DeepSpace RBAC, verified by a two-user isolation test.
- **Cost caps** (`src/constants.ts`): 5 scans/user/day · 12 queries/scan · 10 results/query.

## Develop

Requires Node 22.15+/24/26 (not 25) and npm ≥ 11.6.

```
npm install
npx deepspace dev start      # local dev server
npm run test:unit            # heat + CRM payload unit tests (Vitest)
npx deepspace test run all   # Playwright: smoke, api, collab, two-user isolation
npx deepspace deploy         # deploy (ships from this GitHub checkout)
```

Secrets are managed via `npx deepspace secrets` and never committed (`.dev.vars` is gitignored).

## Project map

```
src/schemas/      icps · accounts · signals · scans · feedback · crmPushes (all private per user)
src/lib/heat.ts   deterministic heat scoring (pure, unit-tested)
src/lib/scan/     scan engine: queries → search → judge → fit → run (orchestrator)
src/lib/crm.ts    buildCrmPayload — single source for CRM preview + push
src/actions/      server actions (scan, triage, opener, CRM)
src/cron.ts       daily rescan
src/pages/        landing (static) · Board · ICP editor · scan history
```

## Tradeoffs

- **Single-user depth** over a multiplayer workspace — clean RBAC, fast triage; team/shared queues deliberately cut.
- **Deterministic heat; LLM only judges** — reproducible scores, every one cites a source.
- **Cost discipline** — daily cap, gated fit scoring, and a Sonnet→Haiku fallback so a tier cap degrades quality instead of breaking the app.

See `BUILD_LOG.md` for the full build history (including dead ends and fixes) and `WRITEUP_NOTES.md` for the submission writeup.
