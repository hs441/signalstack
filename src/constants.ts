/** App name — replaced by the CLI during scaffolding */
export const APP_NAME = 'signalstack'

/** Immutable app identity — data scope keys to this, so renames never
 *  strand your records.
 *
 *  Injected by the build from `DEEPSPACE_APP_ID` in the wrangler config this
 *  build is running against — `deepspaceBuild()` in vite.config.ts supplies the
 *  define (see `deepspace/build`). wrangler.toml is the only source of truth,
 *  so `deepspace dev start`, `vite build`, and `deepspace deploy --env <name>`
 *  each get their own environment's id — not a copy frozen at scaffold time.
 *  Do not replace this with a literal: that is how a staging browser ends up
 *  reading production's rooms. */
declare const __DEEPSPACE_APP_ID__: string
export const APP_ID: string = __DEEPSPACE_APP_ID__

/** Primary scope ID for the app's RecordRoom DO */
export const SCOPE_ID = `app:${APP_ID}`

/** Roles and display config — imported from SDK (single source of truth) */
export { ROLES, ROLE_CONFIG, type Role } from 'deepspace'

/**
 * Cost caps — enforced server-side in the scan job (brief guardrail).
 * A friendly message is shown to the user when a cap is hit.
 */
/** Max scans a single user may start per rolling 24h. */
export const MAX_SCANS_PER_DAY = 5
/** Max search queries the LLM may expand the ICP triggers into, per scan. */
export const MAX_QUERIES_PER_SCAN = 12
/** Max search results fetched per query. */
export const MAX_RESULTS_PER_QUERY = 10

/** Heat scoring — half-life (days) for signal decay. See src/lib/heat.ts. */
export const HALF_LIFE_DAYS = 21

/** Drop judged candidates below this confidence (keeps evidence trustworthy). */
export const MIN_CONFIDENCE = 0.55

/** Background job type for a scan run. */
export const SCAN_JOB_TYPE = 'scan'

/** Search providers we route queries to (one provider per query). */
export const PROVIDERS = ['exa', 'firecrawl'] as const
export type Provider = (typeof PROVIDERS)[number]

/** Default CRM toolkit (Composio slug) new ICPs target. */
export const DEFAULT_CRM_TOOLKIT = 'hubspot'

/** LLM model ids (verified against DEEPSPACE_AI_MODELS). */
export const MODEL_JUDGE = 'claude-haiku-4-5' // cheap, bulk candidate judging
export const MODEL_REASON = 'claude-sonnet-5' // query expansion, fit rationale, openers

/**
 * Search mix — Firecrawl is lower-ROI than Exa (it uniquely catches funding
 * news but most news hits lack a company-own domain). Cap Firecrawl queries so
 * the budget skews to Exa; the rest of MAX_QUERIES_PER_SCAN goes to Exa.
 */
export const MAX_FIRECRAWL_QUERIES = 3

/**
 * Fit cost control — Sonnet fit scoring is the scan's cost driver (~$1/scan was
 * 32 fit calls). Only accounts whose intent clears this threshold get a full
 * Sonnet fit + rationale; the rest get a cheap heuristic fit. And never more
 * than MAX_FIT_SCORES_PER_SCAN Sonnet calls per scan, hard-bounding spend.
 */
export const FIT_INTENT_THRESHOLD = 0.4
export const MAX_FIT_SCORES_PER_SCAN = 20

/** A 'running' scan older than this is treated as interrupted/failed (the DO
 *  alarm has a ~15-min wall limit; a hard kill can't update the scan record). */
export const SCAN_STALE_MINUTES = 15

/** Typical scan wall-time, MEASURED (~189s on the DeepSpace preset). Shown in
 *  the empty state so first-time users know roughly how long to wait. */
export const SCAN_TYPICAL_MINUTES = 3
