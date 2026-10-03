/**
 * Background-job handler — invoked by AppJobRoom (worker.ts) for every job
 * picked up from the queue. See src/lib/scan/run.ts for the scan pipeline.
 *
 * Progress / cancel:
 *   - `ctx.progress(0..1, msg?)` publishes real-time updates over the room's
 *     WebSocket; runScan also mirrors stage/progress into the scan record.
 *   - `ctx.signal` fires on client cancel (not yet wired into runScan loops).
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { SCAN_JOB_TYPE } from './constants'
import { runScan } from './lib/scan/run'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === SCAN_JOB_TYPE) {
    const { icpId, forceFail } = (job.payload ?? {}) as { icpId?: string; forceFail?: boolean }
    // The owner is the verified enqueuer — set by the startScan action, never
    // read from the client-controlled payload. runScan re-checks ICP ownership.
    const owner = job.enqueuedBy
    if (!owner) throw new Error('scan job has no enqueuedBy; refusing to run')
    if (!icpId) throw new Error('scan job missing icpId')
    return await runScan(env, { icpId, owner, forceFail, onProgress: (v, m) => ctx.progress(v, m) })
  }

  throw new Error(`Unknown job type: ${job.type}`)
}
