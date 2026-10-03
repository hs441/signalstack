/**
 * Authenticated server actions. The worker is the only authorization boundary:
 * `tools.*` run RBAC-OFF, so every action re-checks ownership itself (load the
 * record, compare ownerUserId to the caller) before writing.
 */

import type { ActionHandler, ActionResult } from 'deepspace/worker'
import { createDeepSpaceAI, enqueueJob, resolveAppRole } from 'deepspace/worker'
import { generateText } from 'ai'
import type { Env } from '../../worker'
import { DEFAULT_CRM_TOOLKIT, MAX_SCANS_PER_DAY, MODEL_JUDGE, MODEL_REASON, SCAN_JOB_TYPE, SCAN_STALE_MINUTES } from '../constants'
import { DEEPSPACE_PRESET } from '../lib/preset'
import { ageInDays, decay, heatScore, signalWeight, type HeatSignal } from '../lib/heat'
import { buildCrmPayload } from '../lib/crm'
import { runDailyRescan } from '../cron'
import type { ActionTools } from 'deepspace/worker'

const DAY_MS = 86_400_000
const fail = (error: string, code?: string): ActionResult => ({ success: false, error, ...(code ? { code } : {}) })
const ok = <T>(data: T): ActionResult<T> => ({ success: true, data })

/**
 * startScan — enforce the per-user daily cap, then enqueue the scan job. The
 * cap is checked here (friendly UX) AND re-checked in runScan (hard bound), so
 * a direct job enqueue can't exceed it either. Cron rescans count the same way.
 */
const startScan: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const icpId = typeof params.icpId === 'string' ? params.icpId : ''
  if (!icpId) return fail('Missing icpId')

  // Ownership: the ICP must belong to the caller.
  const icp = await tools.get('icps', icpId)
  if (!icp.success || !icp.data.record) return fail('ICP not found', 'not_found')
  if ((icp.data.record.data as { ownerUserId?: string }).ownerUserId !== userId) {
    return fail('Not your ICP', 'forbidden')
  }

  const scans = await tools.query('scans', { where: { ownerUserId: userId }, limit: 200 })
  const now = Date.now()

  // Reap stale 'running' scans: a hard-killed DO alarm (15-min wall limit)
  // can't update its own scan record, so without this the banner spins forever.
  for (const s of scans.success ? scans.data.records : []) {
    const d = s.data as { status?: string; startedAt?: string }
    if (d.status === 'running' && d.startedAt && now - Date.parse(d.startedAt) > SCAN_STALE_MINUTES * 60_000) {
      await tools.update('scans', s.recordId, {
        status: 'failed',
        errorMessage: 'Interrupted — exceeded the time limit.',
        finishedAt: new Date().toISOString(),
      })
    }
  }

  // Daily cap. EVERY started scan counts — success OR failure — because a failed
  // scan may already have spent on search + LLM; counting it prevents retry-storms.
  const todays = (scans.success ? scans.data.records : []).filter((s) => {
    const started = (s.data as { startedAt?: string }).startedAt
    return started ? now - Date.parse(started) < DAY_MS : false
  })
  if (todays.length >= MAX_SCANS_PER_DAY) {
    return fail(`You've used all ${MAX_SCANS_PER_DAY} scans for today. New scans unlock tomorrow.`, 'rate_limited')
  }

  // Dev-only failure injection, honored only when debug routes are enabled.
  const forceFail = env.ALLOW_DEBUG_ROUTES === 'true' && params.__forceFail === true

  const jobId = await enqueueJob(
    env.JOB_ROOMS,
    `app:${env.DEEPSPACE_APP_ID}`,
    SCAN_JOB_TYPE,
    { icpId, forceFail },
    { enqueuedBy: userId, maxAttempts: 1 },
  )
  return ok({ jobId, scansRemaining: MAX_SCANS_PER_DAY - todays.length - 1 })
}

/**
 * triageAccount — accept/reject in one atomic step: verify the account is the
 * caller's, update its status, and write the feedback row together.
 */
const triageAccount: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const accountId = typeof params.accountId === 'string' ? params.accountId : ''
  const decision = params.decision === 'accept' ? 'accept' : params.decision === 'reject' ? 'reject' : ''
  const reason = typeof params.reason === 'string' ? params.reason.slice(0, 500) : ''
  if (!accountId || !decision) return fail('Missing accountId or decision')

  const acct = await tools.get('accounts', accountId)
  if (!acct.success || !acct.data.record) return fail('Account not found', 'not_found')
  if ((acct.data.record.data as { ownerUserId?: string }).ownerUserId !== userId) {
    return fail('Not your account', 'forbidden')
  }

  const status = decision === 'accept' ? 'accepted' : 'rejected'
  const upd = await tools.update('accounts', accountId, { status, statusReason: reason })
  if (!upd.success) return fail(upd.error, upd.code)

  // Append feedback (calibration for future fit scoring).
  const fb = await tools.create('feedback', { ownerUserId: userId, accountId, decision, reason })
  if (!fb.success) return fail(fb.error, fb.code)

  return ok({ status })
}

/**
 * draftOpener — on demand, draft a short cold opener grounded in the account's
 * strongest recent signal. Not sent anywhere; the UI shows it with a copy
 * button. Owner-billed (anthropic is a 'developer' integration).
 */
const draftOpener: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const accountId = typeof params.accountId === 'string' ? params.accountId : ''
  if (!accountId) return fail('Missing accountId')

  const acct = await tools.get('accounts', accountId)
  if (!acct.success || !acct.data.record) return fail('Account not found', 'not_found')
  const a = acct.data.record.data as { ownerUserId?: string; companyName: string; domain: string; whyNow?: string; icpId?: string }
  if (a.ownerUserId !== userId) return fail('Not your account', 'forbidden')

  const sigRes = await tools.query('signals', { where: { ownerUserId: userId, accountId }, limit: 500 })
  const sigRecs = sigRes.success ? sigRes.data.records : []
  if (!sigRecs.length) return fail('No signals to ground an opener', 'no_signals')

  // Strongest signal = highest weight × freshness.
  const strongestRec = sigRecs
    .map((rec) => {
      const s = rec.data as { type: string; signalDate?: string }
      return { rec, score: signalWeight(s.type) * decay(ageInDays(s.signalDate || new Date().toISOString())) }
    })
    .sort((x, y) => y.score - x.score)[0].rec
  const strongest = strongestRec.data as { type: string; evidenceQuote: string; sourceUrl: string; signalDate?: string }

  let who = ''
  if (a.icpId) {
    const icp = await tools.get('icps', a.icpId)
    if (icp.success && icp.data.record) who = (icp.data.record.data as { who?: string }).who ?? ''
  }

  const ai = createDeepSpaceAI(env, 'anthropic')
  const system = [
    'You draft a short, specific cold outreach opener for a GTM seller. 2–3 sentences, max ~55 words.',
    'Ground it in the ONE concrete signal provided — name the specific thing that happened.',
    'No fake familiarity ("I\'ve long admired…"), no "hope this finds you well", no flattery, no emojis.',
    'End with one light, low-pressure question. Plain text only.',
  ].join('\n')
  const prompt = [
    who ? `We sell to: ${who}` : '',
    `Company: ${a.companyName} (${a.domain})`,
    `Signal (${strongest.type}${strongest.signalDate ? `, ${strongest.signalDate}` : ''}): "${strongest.evidenceQuote}"`,
    `Source: ${strongest.sourceUrl}`,
  ]
    .filter(Boolean)
    .join('\n')

  // Prefer the stronger model; fall back to the cheap one (e.g. free-tier
  // paid-model cap → 402), and surface a clean error rather than a 500.
  let text: string
  try {
    ;({ text } = await generateText({ model: ai(MODEL_REASON), maxOutputTokens: 400, system, prompt }))
  } catch (err) {
    console.warn(`[opener] ${MODEL_REASON} failed, retrying on ${MODEL_JUDGE}: ${String(err)}`)
    try {
      ;({ text } = await generateText({ model: ai(MODEL_JUDGE), maxOutputTokens: 400, system, prompt }))
    } catch (err2) {
      return fail(`Opener generation failed: ${String(err2)}`, 'ai_error')
    }
  }

  const opener = text.trim()
  // Cache on the account so reopening shows it without another model call.
  await tools.update('accounts', accountId, { opener, openerSignalId: strongestRec.recordId })
  return ok({ opener, openerSignalId: strongestRec.recordId })
}

/* ------------------------------------------------------------------ *
 * CRM push (HubSpot via Composio per-user OAuth)
 * ------------------------------------------------------------------ */

const TOOLKIT = DEFAULT_CRM_TOOLKIT // 'hubspot'
const NOTE_TO_COMPANY_ASSOC = 190 // HubSpot default association type id (note → company)

/** Load an account (owned by the caller), its signals, and its live heat. */
type LoadResult =
  | { ok: false; error: ActionResult }
  | { ok: true; account: Record<string, unknown>; payload: ReturnType<typeof buildCrmPayload>; accountId: string }

async function loadAccountForCrm(tools: ActionTools, userId: string, accountId: string): Promise<LoadResult> {
  const acct = await tools.get('accounts', accountId)
  if (!acct.success || !acct.data.record) return { ok: false, error: fail('Account not found', 'not_found') }
  const a = acct.data.record.data as Record<string, unknown>
  if (a.ownerUserId !== userId) return { ok: false, error: fail('Not your account', 'forbidden') }
  const sigRes = await tools.query('signals', { where: { ownerUserId: userId, accountId }, limit: 500 })
  const signals = (sigRes.success ? sigRes.data.records : []).map((s) => s.data as Record<string, unknown>)
  const heatSignals: HeatSignal[] = signals.map((s) => ({ type: s.type as string, ageDays: ageInDays((s.signalDate as string) || new Date().toISOString()) }))
  const heat = heatScore((a.fit as number) ?? 0, heatSignals)
  const payload = buildCrmPayload(
    { companyName: a.companyName as string, domain: a.domain as string, fit: (a.fit as number) ?? 0, whyNow: a.whyNow as string, fitRationale: a.fitRationale as string },
    signals.map((s) => ({ type: s.type as string, signalDate: (s.signalDate as string) ?? null, evidenceQuote: s.evidenceQuote as string, sourceUrl: s.sourceUrl as string, provider: s.provider as string })),
    heat,
  )
  return { ok: true, account: a, payload, accountId }
}

interface ComposioExec {
  ok: boolean
  data?: Record<string, unknown>
  requiresConnection?: boolean
  error?: string
}

/** Run a Composio tool on the caller's connected account (user-billed). */
async function composioExec(tools: ActionTools, slug: string, args: Record<string, unknown>): Promise<ComposioExec> {
  const r = await tools.integration<Record<string, unknown>>('composio/execute-tool', { slug, arguments: args })
  if (!r.success) return { ok: false, error: r.error }
  const out = r.data as Record<string, unknown>
  if (out?.requiresConnection) return { ok: false, requiresConnection: true }
  if (out?.successful === false) return { ok: false, error: (out.error as string) || 'HubSpot call failed' }
  // Composio wraps the provider response under `data` (fallback to the whole object).
  return { ok: true, data: (out?.data as Record<string, unknown>) ?? out }
}

/** Parse composio/list-connections → the connection list (shape: {connections:[…]}). */
function connectionsOf(data: Record<string, unknown>): Array<Record<string, unknown>> {
  return (data.connections as Array<Record<string, unknown>>) ?? (data.items as Array<Record<string, unknown>>) ?? (Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [])
}
function isActive(c: Record<string, unknown>): boolean {
  return c.active === true || String(c.status ?? '').toUpperCase() === 'ACTIVE'
}

/** crmStatus — is the caller connected to the CRM toolkit? */
const crmStatus: ActionHandler<Env> = async ({ params, tools }) => {
  const toolkit = typeof params.toolkit === 'string' ? params.toolkit : TOOLKIT
  const r = await tools.integration<Record<string, unknown>>('composio/list-connections', { toolkit })
  if (!r.success) return fail(r.error, r.code)
  const connected = connectionsOf(r.data).some(isActive)
  return ok({ connected, toolkit })
}

/** crmConnect — start per-user OAuth; returns a hosted consent URL to open. */
const crmConnect: ActionHandler<Env> = async ({ params, tools }) => {
  const toolkit = typeof params.toolkit === 'string' ? params.toolkit : TOOLKIT
  const callbackUrl = typeof params.callbackUrl === 'string' ? params.callbackUrl : undefined
  const r = await tools.integration<Record<string, unknown>>('composio/initiate-connection', { toolkit, ...(callbackUrl ? { callbackUrl } : {}) })
  if (!r.success) return fail(r.error, r.code)
  return ok({ redirectUrl: r.data.redirectUrl, connectedAccountId: r.data.connectedAccountId })
}

/** crmPreview — show the exact payload (same builder as push). No connection needed. */
const crmPreview: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const accountId = typeof params.accountId === 'string' ? params.accountId : ''
  if (!accountId) return fail('Missing accountId')
  const loaded = await loadAccountForCrm(tools, userId, accountId)
  if (!loaded.ok) return loaded.error
  return ok({ toolkit: TOOLKIT, ...loaded.payload })
}

/** crmPush — dedupe by domain, create-or-update the company, attach the note,
 *  and record the push idempotently. A second push updates, never duplicates. */
const crmPush: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const accountId = typeof params.accountId === 'string' ? params.accountId : ''
  if (!accountId) return fail('Missing accountId')
  const loaded = await loadAccountForCrm(tools, userId, accountId)
  if (!loaded.ok) return loaded.error
  const { payload } = loaded
  const notConnected = fail('Connect HubSpot first.', 'not_connected')

  // 1. Dedupe by domain.
  const search = await composioExec(tools, 'HUBSPOT_SEARCH_COMPANIES', {
    filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: payload.dedupeKey }] }],
    properties: ['domain', 'name'],
    limit: 1,
  })
  if (search.requiresConnection) return notConnected
  if (!search.ok) return fail(`HubSpot search failed: ${search.error}`, 'crm_error')

  const existingId = ((search.data?.results as Array<Record<string, unknown>>) ?? [])[0]?.id as string | undefined

  // 2. Create or update the company.
  let companyId: string | undefined
  let wasUpdate = false
  if (existingId) {
    wasUpdate = true
    const upd = await composioExec(tools, 'HUBSPOT_UPDATE_COMPANY', {
      companyId: existingId,
      properties: { name: payload.company.name, website: payload.company.website, description: payload.company.description },
    })
    if (upd.requiresConnection) return notConnected
    if (!upd.ok) return fail(`HubSpot update failed: ${upd.error}`, 'crm_error')
    companyId = existingId
  } else {
    const created = await composioExec(tools, 'HUBSPOT_CREATE_COMPANY', { ...payload.company })
    if (created.requiresConnection) return notConnected
    if (!created.ok) return fail(`HubSpot create failed: ${created.error}`, 'crm_error')
    companyId = created.data?.id as string | undefined
  }
  if (!companyId) return fail('HubSpot did not return a company id.', 'crm_error')

  // 3. Attach the note to the company.
  const note = await composioExec(tools, 'HUBSPOT_CREATE_NOTE', {
    hs_note_body: payload.noteBody,
    hs_timestamp: new Date().toISOString(),
    associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_COMPANY_ASSOC }] }],
  })
  if (note.requiresConnection) return notConnected
  // A failed note shouldn't lose the company link; log but continue.
  const noteId = note.ok ? (note.data?.id as string | undefined) : undefined
  if (!note.ok) console.warn(`[crm] note attach failed for ${payload.dedupeKey}: ${note.error}`)

  // 4. Best-effort portal id for a deep link.
  let portalId = ''
  const conns = await tools.integration<Record<string, unknown>>('composio/list-connections', { toolkit: TOOLKIT })
  if (conns.success) {
    const list = connectionsOf(conns.data)
    const active = list.find(isActive) ?? list[0]
    const meta = (active?.meta ?? active?.params ?? {}) as Record<string, unknown>
    portalId = String(meta.portalId ?? meta.hub_id ?? meta.hubId ?? '')
  }
  const externalUrl = portalId
    ? `https://app.hubspot.com/contacts/${portalId}/record/0-2/${companyId}`
    : `https://app.hubspot.com/contacts/record/0-2/${companyId}`

  // 5. Upsert the push record (dedupe by owner + toolkit + account).
  const existing = await tools.query('crmPushes', { where: { ownerUserId: userId, toolkit: TOOLKIT, accountId }, limit: 1 })
  const row = existing.success ? existing.data.records[0] : undefined
  const data = {
    ownerUserId: userId,
    accountId,
    toolkit: TOOLKIT,
    externalId: companyId,
    externalUrl,
    noteExternalId: noteId ?? '',
    status: wasUpdate ? 'updated' : 'pushed',
    pushedAt: new Date().toISOString(),
  }
  if (row) await tools.update('crmPushes', row.recordId, data)
  else await tools.create('crmPushes', data)

  console.info(`[crm] push ${wasUpdate ? 'updated' : 'created'} company=${companyId} note=${noteId ?? 'none'} domain=${payload.dedupeKey}`)
  return ok({ status: data.status, externalId: companyId, externalUrl, noteAttached: !!noteId })
}

/* ------------------------------------------------------------------ *
 * Dev-only helpers — gated by ALLOW_DEBUG_ROUTES + admin role. Used to
 * drive a backend-only scan before the UI exists (Phase 2). They refuse
 * in production.
 * ------------------------------------------------------------------ */

async function assertDevAdmin(env: Env, userId: string): Promise<ActionResult | null> {
  if (env.ALLOW_DEBUG_ROUTES !== 'true') return fail('Not found', 'not_found')
  const role = await resolveAppRole(env, userId)
  if (role !== 'admin') return fail('Forbidden', 'forbidden')
  return null
}

const __devSeedPresetIcp: ActionHandler<Env> = async ({ userId, tools, env }) => {
  const denied = await assertDevAdmin(env, userId)
  if (denied) return denied

  const existing = await tools.query('icps', { where: { ownerUserId: userId }, limit: 50 })
  const active = (existing.success ? existing.data.records : []).find((r) => (r.data as { active?: boolean }).active)
  if (active) return ok({ icpId: active.recordId, created: false })

  const created = await tools.create('icps', {
    ownerUserId: userId,
    name: DEEPSPACE_PRESET.name,
    who: DEEPSPACE_PRESET.who,
    triggers: DEEPSPACE_PRESET.triggers,
    disqualifiers: DEEPSPACE_PRESET.disqualifiers,
    crmToolkit: DEEPSPACE_PRESET.crmToolkit,
    rescanEnabled: DEEPSPACE_PRESET.rescanEnabled,
    active: DEEPSPACE_PRESET.active,
  })
  if (!created.success) return fail(created.error, created.code)
  return ok({ icpId: created.data.recordId, created: true })
}

const __devScanReport: ActionHandler<Env> = async ({ userId, tools, env }) => {
  const denied = await assertDevAdmin(env, userId)
  if (denied) return denied

  const scans = await tools.query('scans', { where: { ownerUserId: userId }, limit: 200 })
  const latest = (scans.success ? scans.data.records : [])
    .slice()
    .sort((a, b) => ((b.data as { startedAt?: string }).startedAt || '').localeCompare((a.data as { startedAt?: string }).startedAt || ''))[0]

  const accountsRes = await tools.query('accounts', { where: { ownerUserId: userId }, limit: 1000 })
  const accounts = accountsRes.success ? accountsRes.data.records : []
  const enriched = []
  for (const a of accounts) {
    const sigRes = await tools.query('signals', { where: { ownerUserId: userId, accountId: a.recordId }, limit: 500 })
    const sigs = sigRes.success ? sigRes.data.records : []
    const ad = a.data as { companyName: string; domain: string; fit?: number; whyNow?: string; status?: string }
    const heatSignals: HeatSignal[] = sigs.map((s) => ({
      type: (s.data as { type: string }).type,
      ageDays: ageInDays((s.data as { signalDate?: string }).signalDate || new Date().toISOString()),
    }))
    enriched.push({
      companyName: ad.companyName,
      domain: ad.domain,
      fit: ad.fit ?? 0,
      heat: heatScore(ad.fit ?? 0, heatSignals),
      whyNow: ad.whyNow ?? '',
      status: ad.status ?? 'new',
      signals: sigs.map((s) => {
        const sd = s.data as Record<string, unknown>
        return {
          type: sd.type,
          provider: sd.provider,
          sourceUrl: sd.sourceUrl,
          evidenceQuote: sd.evidenceQuote,
          signalDate: sd.signalDate ?? null,
          confidence: sd.confidence,
        }
      }),
    })
  }
  enriched.sort((x, y) => y.heat - x.heat)

  return ok({
    scan: latest ? { ...(latest.data as Record<string, unknown>), scanId: latest.recordId } : null,
    totalAccounts: enriched.length,
    top: enriched.slice(0, 50),
  })
}

/** Wipe the caller's scan data (accounts/signals/scans/feedback) — dev only. */
const __devReset: ActionHandler<Env> = async ({ userId, tools, env }) => {
  const denied = await assertDevAdmin(env, userId)
  if (denied) return denied
  const deleted: Record<string, number> = {}
  for (const collection of ['signals', 'accounts', 'scans', 'feedback', 'crmPushes']) {
    let total = 0
    for (let i = 0; i < 20; i++) {
      const res = await tools.deleteWhere(collection, { ownerUserId: userId }, 500)
      const n = res.success ? (res.data as unknown as { deleted: number }).deleted : 0
      total += n
      if (n < 500) break
    }
    deleted[collection] = total
  }
  return ok({ deleted })
}

/**
 * Seed one account + signal owned by the CALLER — for the two-user isolation
 * test (so we don't need a full scan). Gated by ALLOW_DEBUG_ROUTES only (not
 * admin) so ordinary test-member accounts can seed their own data; refuses in prod.
 */
const __devSeedAccount: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  if (env.ALLOW_DEBUG_ROUTES !== 'true') return fail('Not found', 'not_found')
  const tag = typeof params.tag === 'string' ? params.tag.replace(/[^A-Za-z0-9]/g, '') : 'X'
  const stamp = Date.now()
  const domain = `iso-${tag}-${stamp}.example`.toLowerCase()
  const company = `__ISO ${tag} ${stamp}`
  const acct = await tools.create('accounts', {
    ownerUserId: userId,
    companyName: company,
    domain,
    status: 'new',
    fit: 50,
    intent: 0.5,
    heat: 40,
    whyNow: 'Seeded for the isolation test.',
  })
  if (!acct.success) return fail(acct.error, acct.code)
  await tools.create('signals', {
    ownerUserId: userId,
    accountId: acct.data.recordId,
    type: 'funding',
    evidenceQuote: 'Seeded signal for isolation test.',
    sourceUrl: `https://example.com/${tag}`,
    signalDate: new Date().toISOString().slice(0, 10),
    provider: 'exa',
    confidence: 0.9,
    weight: 0.8,
  })
  return ok({ accountId: acct.data.recordId, company, domain })
}

/** Fire the daily-rescan cron handler on demand (dev only) to show it works. */
const __devRunCron: ActionHandler<Env> = async ({ userId, env }) => {
  const denied = await assertDevAdmin(env, userId)
  if (denied) return denied
  await runDailyRescan(env)
  return ok({ ran: 'daily-rescan' })
}

export const actions: Record<string, ActionHandler<Env>> = {
  startScan,
  triageAccount,
  draftOpener,
  crmStatus,
  crmConnect,
  crmPreview,
  crmPush,
  __devSeedPresetIcp,
  __devScanReport,
  __devReset,
  __devRunCron,
  __devSeedAccount,
}
