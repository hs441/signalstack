/**
 * Scan history — each run with its status, counts, and search cost (parsed from
 * the stored summary). Live rows update as a running scan progresses.
 */

import { useQuery } from 'deepspace'
import { EmptyState } from '@/components/ui'
import { relativeDate } from '../../../lib/heat-ui'
import type { ScanData } from '../../../types'

interface Summary {
  searchCostUsd?: number
  perProvider?: Record<string, { queries?: number; stored?: number; searchCostUsd?: number }>
}

function parseSummary(s?: string): Summary {
  if (!s) return {}
  try {
    return JSON.parse(s) as Summary
  } catch {
    return {}
  }
}

const statusStyle: Record<string, string> = {
  running: 'bg-info/15 text-info',
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
}

export default function ScansPage() {
  const scans = useQuery<ScanData>('scans', { orderBy: 'startedAt', orderDir: 'desc', limit: 50 })

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-lg font-semibold text-foreground">Scan history</h1>

      {scans.status === 'loading' ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
      ) : scans.records.length === 0 ? (
        <EmptyState title="No scans yet" description="Run your first scan from the Board." />
      ) : (
        <div className="space-y-2">
          {scans.records.map((rec) => {
            const s = rec.data
            const sum = parseSummary(s.summary)
            return (
              <div key={rec.recordId} className="rounded-md border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusStyle[s.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {s.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{relativeDate(s.startedAt)}</span>
                  {typeof sum.searchCostUsd === 'number' && (
                    <span className="ml-auto text-xs text-muted-foreground">search ${sum.searchCostUsd.toFixed(3)}</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <Stat label="queries" value={s.queriesRun} />
                  <Stat label="candidates" value={s.candidatesFound} />
                  <Stat label="signals" value={s.signalsVerified} />
                  <Stat label="accounts" value={s.accountsTouched} />
                </div>
                {s.status === 'running' && (
                  <div className="mt-2">
                    <div className="mb-1 text-xs text-foreground">{s.stage}</div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((s.progress || 0) * 100)}%` }} />
                    </div>
                  </div>
                )}
                {s.status === 'failed' && s.errorMessage && (
                  <p className="mt-2 text-xs text-destructive">{s.errorMessage}</p>
                )}
                {sum.perProvider && (
                  <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
                    {Object.entries(sum.perProvider).map(([prov, v]) => (
                      <span key={prov}>
                        {prov}: {v.stored ?? 0} signals / {v.queries ?? 0}q
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span> {label}
    </span>
  )
}
