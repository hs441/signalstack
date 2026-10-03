/**
 * The scan orchestrator — runs inside the background job (and the dev harness).
 *
 * Pipeline: load+verify ICP → enforce daily cap → expand queries → search
 * (one provider per query) → judge candidates (Haiku) → dedupe & attach signals
 * to accounts → score fit (Sonnet) & cache heat → finalize scan record.
 *
 * All record writes go through buildCronContext (RBAC-bypassed tools API) and
 * are explicitly stamped with the TRUSTED owner (job.enqueuedBy), never an id
 * from the client payload. firecrawl/exa + Anthropic are billed to the app
 * owner; the per-user daily cap bounds that spend.
 */

import { buildCronContext, createDeepSpaceAI } from 'deepspace/worker'
import {
  FIT_INTENT_THRESHOLD,
  MAX_FIT_SCORES_PER_SCAN,
  MAX_RESULTS_PER_QUERY,
  MAX_SCANS_PER_DAY,
  MIN_CONFIDENCE,
} from '../../constants'
import type { Env } from '../../../worker'
import { normalizeDomain } from '../domain'
import { ageInDays, heatScore, intentScore, signalWeight, type HeatSignal } from '../heat'
import { expandQueries } from './queries'
import { runSearch } from './search'
import { judgeCandidates } from './judge'
import { scoreFit, type FeedbackExample } from './fit'
import { SIGNAL_TYPES, type ProviderStats } from './types'

const DAY_MS = 86_400_000

interface Rec<T = Record<string, unknown>> {
  recordId: string
  data: T
  createdAt?: string
  updatedAt?: string
}

type ProgressFn = (value: number, message?: string) => void

export interface RunScanOptions {
  icpId: string
  /** TRUSTED owner id (job.enqueuedBy / verified caller) — never from payload. */
  owner: string
  onProgress?: ProgressFn
  /** Dev-only: throw partway through, to exercise the failure path end to end. */
  forceFail?: boolean
}

export interface TopAccount {
  companyName: string
  domain: string
  fit: number
  heat: number
  whyNow: string
  signals: Array<{ type: string; provider: string; sourceUrl: string; evidenceQuote: string; signalDate: string | null }>
}

export interface RunScanResult {
  scanId: string
  status: 'done'
  perProvider: Record<'exa' | 'firecrawl', ProviderStats>
  searchCostUsd: number
  accountsTouched: number
  signalsStored: number
  topAccounts: TopAccount[]
}

export async function runScan(env: Env, opts: RunScanOptions): Promise<RunScanResult> {
  const scope = `app:${env.DEEPSPACE_APP_ID}`
  const ctx = buildCronContext(env, env.OWNER_USER_ID, scope)
  const ai = createDeepSpaceAI(env, 'anthropic')
  const { owner } = opts
  const progress: ProgressFn = opts.onProgress ?? (() => {})

  // 1. Load + verify ICP ownership (never trust the payload's owner).
  const icps = (await ctx.records.query('icps', { where: { ownerUserId: owner }, limit: 100 })) as Rec[]
  const icpRec = icps.find((r) => r.recordId === opts.icpId)
  if (!icpRec) throw new Error(`ICP ${opts.icpId} not found for this user`)
  const d = icpRec.data as Record<string, unknown>
  const icp = {
    who: (d.who as string) ?? '',
    triggers: (d.triggers as string[]) ?? [],
    disqualifiers: (d.disqualifiers as string[]) ?? [],
  }

  // 2. Hard daily-cap enforcement (closes any direct-enqueue bypass).
  const priorScans = (await ctx.records.query('scans', { where: { ownerUserId: owner }, limit: 200 })) as Rec[]
  const now = Date.now()
  const recent = priorScans.filter((s) => {
    const started = (s.data as { startedAt?: string }).startedAt
    return started ? now - Date.parse(started) < DAY_MS : false
  })
  if (recent.length >= MAX_SCANS_PER_DAY) {
    throw new Error(`Daily scan limit reached (${MAX_SCANS_PER_DAY}/day). Try again tomorrow.`)
  }

  // 3. Create the scan record the UI subscribes to for live progress.
  const startedAt = new Date().toISOString()
  const scanRec = (await ctx.records.create('scans', {
    ownerUserId: owner,
    icpId: opts.icpId,
    status: 'running',
    progress: 0.02,
    stage: 'Expanding triggers into queries',
    startedAt,
    queriesRun: 0,
    candidatesFound: 0,
    signalsVerified: 0,
    accountsTouched: 0,
  })) as Rec
  const scanId = scanRec.recordId
  const update = (patch: Record<string, unknown>) => ctx.records.update('scans', scanId, patch)
  const step = async (p: number, stage: string, extra: Record<string, unknown> = {}) => {
    progress(p, stage)
    await update({ progress: p, stage, ...extra })
  }

  try {
    // Dev failure injection — prove the failure path (status failed + readable
    // reason + banner stops + cap still counts this scan).
    if (opts.forceFail) throw new Error('Forced failure (dev test): simulated scan error.')

    // 4. Expand triggers → queries (≤ cap, one provider each).
    const plans = await expandQueries(ai, icp)
    await step(0.1, `Running ${plans.length} searches`, { queriesRun: plans.length })

    // 5. Search.
    const { hits, stats } = await runSearch(
      (ep, p) => ctx.integrations.call(ep, p),
      plans,
      MAX_RESULTS_PER_QUERY,
      (done, total) => progress(0.1 + 0.25 * (done / Math.max(1, total)), `Searching (${done}/${total})`),
    )
    await step(0.35, `Judging ${hits.length} candidates`, { candidatesFound: hits.length })

    // 6. Judge candidates, then filter by domain + confidence + evidence.
    const judged = await judgeCandidates(ai, icp, hits, (done, total) =>
      progress(0.35 + 0.3 * (done / Math.max(1, total)), `Judging (${done}/${total})`),
    )
    const kept = judged.filter(({ candidate, hit }) => {
      const prov = hit.provider
      if (candidate.isSignal) stats[prov].judgedSignals += 1
      const domain = normalizeDomain(candidate.companyDomain)
      const ok = candidate.isSignal && !!domain && candidate.confidence >= MIN_CONFIDENCE && !!candidate.evidenceQuote?.trim()
      if (!ok && candidate.isSignal) stats[prov].droppedLowConfidenceOrNoDomain += 1
      return ok
    })
    await step(0.68, `Attaching ${kept.length} signals`, { signalsVerified: kept.length })

    // 7. Upsert accounts + signals (dedupe by domain, and by account+url+type).
    const existingAccounts = (await ctx.records.query('accounts', { where: { ownerUserId: owner }, limit: 1000 })) as Rec[]
    const byDomain = new Map<string, Rec>(existingAccounts.map((a) => [(a.data as { domain: string }).domain, a]))
    const touched = new Set<string>()
    const changed = new Set<string>()

    for (const { candidate, hit } of kept) {
      const domain = normalizeDomain(candidate.companyDomain)
      if (!domain) continue
      const type = (SIGNAL_TYPES as readonly string[]).includes(candidate.signalType) ? candidate.signalType : 'other'
      const signalDate = candidate.signalDate || hit.publishedDate || startedAt.slice(0, 10)

      let acct = byDomain.get(domain)
      if (!acct) {
        // ctx.records.create returns { recordId } only — rebuild the envelope
        // locally from the data we just wrote so later steps can read .data.
        const accountData = {
          ownerUserId: owner,
          icpId: opts.icpId,
          companyName: candidate.companyName || domain,
          domain,
          status: 'new',
          fit: 0,
          intent: 0,
          heat: 0,
        }
        const created = (await ctx.records.create('accounts', accountData)) as { recordId: string }
        acct = { recordId: created.recordId, data: accountData }
        byDomain.set(domain, acct)
      }
      touched.add(acct.recordId)

      const existingSignals = (await ctx.records.query('signals', {
        where: { ownerUserId: owner, accountId: acct.recordId },
        limit: 500,
      })) as Rec[]
      const dup = existingSignals.some(
        (s) => (s.data as { sourceUrl: string }).sourceUrl === hit.url && (s.data as { type: string }).type === type,
      )
      if (dup) continue

      await ctx.records.create('signals', {
        ownerUserId: owner,
        accountId: acct.recordId,
        type,
        evidenceQuote: candidate.evidenceQuote.slice(0, 500),
        sourceUrl: hit.url,
        signalDate,
        provider: hit.provider,
        confidence: candidate.confidence,
        weight: signalWeight(type),
      })
      stats[hit.provider].stored += 1
      changed.add(acct.recordId)
    }

    // 8. Score fit, cache heat/intent. Fit scoring is the cost driver, so GATE
    // it: load each changed account's signals, compute intent, sort by intent,
    // and give a full Sonnet fit only to the strongest accounts (above
    // FIT_INTENT_THRESHOLD, capped at MAX_FIT_SCORES_PER_SCAN). The rest get a
    // cheap heuristic fit — they already rank low via intent anyway.
    const feedbackExamples = await loadFeedbackExamples(ctx, owner, byDomain)
    const acctById = new Map<string, Rec>([...byDomain.values()].map((a) => [a.recordId, a]))

    type Pending = { acctId: string; acct: Rec; sigs: Rec[]; heatSignals: HeatSignal[]; intent: number }
    const pending: Pending[] = []
    for (const acctId of changed) {
      const acct = acctById.get(acctId)
      if (!acct) continue
      const sigs = (await ctx.records.query('signals', { where: { ownerUserId: owner, accountId: acctId }, limit: 500 })) as Rec[]
      const heatSignals: HeatSignal[] = sigs.map((s) => ({
        type: (s.data as { type: string }).type,
        ageDays: ageInDays((s.data as { signalDate?: string }).signalDate || startedAt),
      }))
      pending.push({ acctId, acct, sigs, heatSignals, intent: intentScore(heatSignals) })
    }
    pending.sort((a, b) => b.intent - a.intent)

    let fitCalls = 0
    let fi = 0
    for (const p of pending) {
      fi += 1
      await step(0.7 + 0.28 * (fi / Math.max(1, pending.length)), `Scoring fit (${fi}/${pending.length})`)
      const a = p.acct.data as { companyName: string; domain: string; fit?: number; fitRationale?: string; whyNow?: string }
      const useSonnet = p.intent >= FIT_INTENT_THRESHOLD && fitCalls < MAX_FIT_SCORES_PER_SCAN

      let fit: number
      let rationale: string
      let whyNow: string
      if (useSonnet) {
        fitCalls += 1
        const fitInput = p.sigs.map((s) => {
          const sd = s.data as Record<string, unknown>
          return { type: sd.type as string, signalDate: (sd.signalDate as string) ?? null, evidenceQuote: sd.evidenceQuote as string, sourceUrl: sd.sourceUrl as string }
        })
        try {
          const res = await scoreFit(ai, icp, { companyName: a.companyName, domain: a.domain }, fitInput, feedbackExamples)
          fit = res.fit
          rationale = res.rationale
          whyNow = res.whyNow
        } catch (err) {
          console.warn(`[scan] fit failed for ${a.domain}: ${String(err)}`)
          ;({ fit, rationale, whyNow } = heuristicFit(p.sigs))
        }
      } else {
        ;({ fit, rationale, whyNow } = heuristicFit(p.sigs))
      }

      const lastSignalAt =
        p.sigs
          .map((s) => (s.data as { signalDate?: string }).signalDate)
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || startedAt
      await ctx.records.update('accounts', p.acctId, {
        fit,
        fitRationale: rationale,
        whyNow,
        fitComputedAt: new Date().toISOString(),
        intent: p.intent,
        heat: heatScore(fit, p.heatSignals),
        lastSignalAt,
      })
    }
    console.info(`[scan] fit: ${fitCalls} Sonnet calls, ${pending.length - fitCalls} heuristic`)

    // 9. Finalize + report.
    const topAccounts = await buildTop(ctx, owner)
    const searchCostUsd = round(stats.exa.searchCostUsd + stats.firecrawl.searchCostUsd)
    const signalsStored = stats.exa.stored + stats.firecrawl.stored
    const summary = { perProvider: stats, searchCostUsd, accountsTouched: touched.size, signalsStored }
    await update({
      status: 'done',
      progress: 1,
      stage: 'Done',
      finishedAt: new Date().toISOString(),
      accountsTouched: touched.size,
      signalsVerified: signalsStored,
      summary: JSON.stringify(summary),
    })
    console.info(
      `[scan] summary ${JSON.stringify({
        scanId,
        ...summary,
        top: topAccounts.slice(0, 5).map((t) => ({ name: t.companyName, domain: t.domain, heat: t.heat, fit: t.fit, signals: t.signals.length })),
      })}`,
    )
    return { scanId, status: 'done', perProvider: stats, searchCostUsd, accountsTouched: touched.size, signalsStored, topAccounts }
  } catch (err) {
    await update({ status: 'failed', stage: 'Failed', errorMessage: String(err), finishedAt: new Date().toISOString() }).catch(() => {})
    console.error(`[scan] failed scan=${scanId}: ${String(err)}`)
    throw err
  }
}

/**
 * Cheap, deterministic fit for accounts that don't clear the fit-scoring gate.
 * Modest ceiling (≤60) + an honest rationale; these accounts already rank low
 * via intent, and a stronger signal later promotes them to a full Sonnet score.
 */
function heuristicFit(sigs: Rec[]): { fit: number; rationale: string; whyNow: string } {
  const confs = sigs.map((s) => Number((s.data as { confidence?: number }).confidence ?? 0.5))
  const maxConf = confs.length ? Math.max(...confs) : 0.5
  const fit = Math.round(Math.max(0, Math.min(60, 10 + 50 * maxConf)))
  const strongest = sigs
    .map((s) => s.data as { type?: string; signalDate?: string })
    .sort((a, b) => signalWeight(b.type || 'other') - signalWeight(a.type || 'other'))[0]
  const whyNow = strongest?.type
    ? `Recent ${strongest.type} signal${strongest.signalDate ? ` (${strongest.signalDate})` : ''}.`
    : ''
  return { fit, rationale: 'Heuristic fit (low signal strength); deeper scoring runs when stronger signals arrive.', whyNow }
}

type Ctx = ReturnType<typeof buildCronContext>

async function loadFeedbackExamples(ctx: Ctx, owner: string, byDomain: Map<string, Rec>): Promise<FeedbackExample[]> {
  const fb = (await ctx.records.query('feedback', { where: { ownerUserId: owner }, limit: 50 })) as Rec[]
  const nameByAccountId = new Map<string, string>()
  for (const a of byDomain.values()) nameByAccountId.set(a.recordId, (a.data as { companyName: string }).companyName)
  return fb
    .filter((f) => f && f.data)
    .sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''))
    .slice(0, 10)
    .map((f) => {
      const fd = f.data as { decision: 'accept' | 'reject'; accountId: string; reason?: string }
      return { decision: fd.decision, companyName: nameByAccountId.get(fd.accountId) || 'a company', reason: fd.reason || '' }
    })
}

/** Re-query accounts, recompute live heat, sort desc, take top 5 with signals. */
async function buildTop(ctx: Ctx, owner: string): Promise<TopAccount[]> {
  const accounts = (await ctx.records.query('accounts', { where: { ownerUserId: owner }, limit: 1000 })) as Rec[]
  const enriched: TopAccount[] = []
  for (const a of accounts) {
    const ad = a.data as { companyName: string; domain: string; fit?: number; whyNow?: string }
    const sigs = (await ctx.records.query('signals', { where: { ownerUserId: owner, accountId: a.recordId }, limit: 500 })) as Rec[]
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
      signals: sigs.map((s) => {
        const sd = s.data as Record<string, unknown>
        return {
          type: sd.type as string,
          provider: (sd.provider as string) ?? '',
          sourceUrl: sd.sourceUrl as string,
          evidenceQuote: sd.evidenceQuote as string,
          signalDate: (sd.signalDate as string) ?? null,
        }
      }),
    })
  }
  return enriched.sort((x, y) => y.heat - x.heat).slice(0, 5)
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}
