/**
 * Cron — daily rescan. Cron is app-level (not per-user), so one task iterates
 * every ICP with `rescanEnabled` and enqueues a scan job for its owner. Each
 * enqueue counts against that owner's MAX_SCANS_PER_DAY, same as a manual scan,
 * so rescans can't blow the cap.
 *
 * The schedule arms on the app's first request (armCronRoom middleware in
 * worker.ts). Logs appear as `[cron] daily-rescan ok <ms>ms`.
 */

import { buildCronContext, enqueueJob } from 'deepspace/worker'
import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { MAX_SCANS_PER_DAY, SCAN_JOB_TYPE } from './constants'

const DAY_MS = 86_400_000

export const tasks: CronTask[] = [
  // 09:00 America/New_York, daily.
  { name: 'daily-rescan', schedule: '0 9 * * *', timezone: 'America/New_York' },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === 'daily-rescan') return runDailyRescan(env)
}

/** Enqueue a scan for every rescan-enabled ICP whose owner is under the cap. */
export async function runDailyRescan(env: Env): Promise<void> {
  const scope = `app:${env.DEEPSPACE_APP_ID}`
  const ctx = buildCronContext(env, env.OWNER_USER_ID, scope)

  // RBAC-bypassed: returns every user's rescan-enabled ICP (boolean stored as 1).
  const icps = (await ctx.records.query('icps', { where: { rescanEnabled: 1 }, limit: 1000 })) as Array<{
    recordId: string
    data: { ownerUserId?: string; active?: boolean }
  }>

  const now = Date.now()
  let enqueued = 0
  let skipped = 0

  for (const icp of icps) {
    const owner = icp.data.ownerUserId
    if (!owner) continue
    const scans = (await ctx.records.query('scans', { where: { ownerUserId: owner }, limit: 200 })) as Array<{
      data: { startedAt?: string }
    }>
    const todays = scans.filter((s) => s.data.startedAt && now - Date.parse(s.data.startedAt) < DAY_MS).length
    if (todays >= MAX_SCANS_PER_DAY) {
      skipped += 1
      continue
    }
    await enqueueJob(env.JOB_ROOMS, scope, SCAN_JOB_TYPE, { icpId: icp.recordId }, { enqueuedBy: owner, maxAttempts: 1 })
    enqueued += 1
  }

  console.info(`[cron] daily-rescan: ${icps.length} rescan-enabled ICP(s), enqueued ${enqueued}, skipped ${skipped} (cap)`)
}
