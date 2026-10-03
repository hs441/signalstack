/**
 * The Board — accounts ranked by heat, computed at render time from live signals
 * (heat decays, so a stored value goes stale). Keyboard triage: j/k move,
 * a/r accept/reject, Enter/o open, Esc close. Run a scan from here and watch
 * live progress.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutations, useQuery } from 'deepspace'
import type { RecordData } from 'deepspace'
import { Radar, Search } from 'lucide-react'
import { Button, EmptyState, useToast } from '@/components/ui'
import { HeatBar } from '../../../components/HeatBar'
import { AccountDrawer } from '../../../components/AccountDrawer'
import { callAction } from '../../../lib/actions'
import { relativeDate, signalMeta } from '../../../lib/heat-ui'
import { ageInDays, heatScore, type HeatSignal } from '../../../lib/heat'
import { SCAN_STALE_MINUTES, SCAN_TYPICAL_MINUTES } from '../../../constants'
import { DEEPSPACE_PRESET } from '../../../lib/preset'
import type { AccountData, CrmPushData, IcpData, ScanData, SignalData } from '../../../types'

type Filter = 'all' | 'new' | 'accepted' | 'rejected'

interface Row {
  account: RecordData<AccountData>
  signals: RecordData<SignalData>[]
  heat: number
}

export default function BoardPage() {
  const { error, info } = useToast()
  // `active` is a boolean column stored as integer 0/1, and the query `where`
  // binds the raw value without coercion (unlike writes), so filter on the
  // STORED form `active: 1`, not `true`. See BUILD_LOG (boolean-query bug).
  const icps = useQuery<IcpData>('icps', { where: { active: 1 }, limit: 5 })
  const accountsQ = useQuery<AccountData>('accounts', { limit: 1000 })
  const signalsQ = useQuery<SignalData>('signals', { limit: 2000 })
  const scansQ = useQuery<ScanData>('scans', { orderBy: 'startedAt', orderDir: 'desc', limit: 1 })
  const pushesQ = useQuery<CrmPushData>('crmPushes', { limit: 1000 })
  const icpMut = useMutations<IcpData>('icps')

  const icp = icps.records[0]
  const latestScan = scansQ.records[0]
  // A 'running' scan older than the stale window was hard-killed; don't treat it
  // as live (the banner would spin forever and Run scan would stay disabled).
  const scanFresh =
    latestScan?.data.status === 'running' &&
    !!latestScan.data.startedAt &&
    Date.now() - Date.parse(latestScan.data.startedAt) < SCAN_STALE_MINUTES * 60_000
  const scanRunning = scanFresh

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Build heat-ranked rows from live signals.
  const rows = useMemo<Row[]>(() => {
    const byAccount = new Map<string, RecordData<SignalData>[]>()
    for (const s of signalsQ.records) {
      const list = byAccount.get(s.data.accountId) ?? []
      list.push(s)
      byAccount.set(s.data.accountId, list)
    }
    return accountsQ.records
      .map((account) => {
        const signals = byAccount.get(account.recordId) ?? []
        const heatSignals: HeatSignal[] = signals.map((s) => ({
          type: s.data.type,
          ageDays: ageInDays(s.data.signalDate || new Date().toISOString()),
        }))
        return { account, signals, heat: heatScore(account.data.fit, heatSignals) }
      })
      .sort((a, b) => b.heat - a.heat)
  }, [accountsQ.records, signalsQ.records])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter !== 'all' && r.account.data.status !== filter) return false
      if (q && !(`${r.account.data.companyName} ${r.account.data.domain}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [rows, filter, search])

  // Keep selection in range.
  useEffect(() => {
    if (selected >= filtered.length) setSelected(Math.max(0, filtered.length - 1))
  }, [filtered.length, selected])

  const openAccount = openId ? rows.find((r) => r.account.recordId === openId) : null

  async function quickTriage(row: Row, decision: 'accept' | 'reject') {
    const res = await callAction('triageAccount', { accountId: row.account.recordId, decision, reason: '' })
    if (!res.success) error('Could not save', res.error)
  }

  // Keyboard triage.
  const rowsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (openId) {
        if (e.key === 'Escape') setOpenId(null)
        return
      }
      if (!filtered.length) return
      if (e.key === 'j') { e.preventDefault(); setSelected((s) => Math.min(filtered.length - 1, s + 1)) }
      else if (e.key === 'k') { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)) }
      else if (e.key === 'Enter' || e.key === 'o') { e.preventDefault(); setOpenId(filtered[selected]?.account.recordId ?? null) }
      else if (e.key === 'a') { e.preventDefault(); void quickTriage(filtered[selected], 'accept') }
      else if (e.key === 'r') { e.preventDefault(); void quickTriage(filtered[selected], 'reject') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, selected, openId])

  async function runScan() {
    if (!icp) return
    setStarting(true)
    const res = await callAction<{ scansRemaining: number }>('startScan', { icpId: icp.recordId })
    setStarting(false)
    if (res.success) info('Scan started', `${res.data.scansRemaining} scans left today`)
    else error('Could not start scan', res.error)
  }

  // First-run one-click: create the DeepSpace preset ICP if none exists, then scan.
  async function runWithPreset() {
    setStarting(true)
    try {
      let icpId = icp?.recordId
      if (!icpId) {
        icpId = await icpMut.create({
          name: DEEPSPACE_PRESET.name,
          who: DEEPSPACE_PRESET.who,
          triggers: DEEPSPACE_PRESET.triggers,
          disqualifiers: DEEPSPACE_PRESET.disqualifiers,
          crmToolkit: DEEPSPACE_PRESET.crmToolkit,
          rescanEnabled: DEEPSPACE_PRESET.rescanEnabled,
          active: true,
        } as IcpData)
      }
      const res = await callAction<{ scansRemaining: number }>('startScan', { icpId })
      if (res.success) info('Scan started', `${res.data.scansRemaining} scans left today`)
      else error('Could not start scan', res.error)
    } catch (err) {
      error('Could not start scan', String(err))
    } finally {
      setStarting(false)
    }
  }

  const loading = accountsQ.status === 'loading' || icps.status === 'loading'
  const interrupted = latestScan?.data.status === 'running' && !scanFresh
  const firstTime = !loading && rows.length === 0 && scansQ.records.length === 0 && !scanRunning

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-4 py-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">Board</h1>
          <p className="truncate text-xs text-muted-foreground">
            {icp ? (
              <>Ranking against <Link to="/icp" className="text-primary hover:underline">{icp.data.name}</Link> · heat = fit × recent signal strength</>
            ) : (
              <>No ICP yet — <Link to="/icp" className="text-primary hover:underline">set one up</Link> to scan.</>
            )}
          </p>
        </div>
        <div className="flex-1" />
        <Button onClick={runScan} disabled={!icp || scanRunning || starting}>
          <Radar className="h-4 w-4" aria-hidden />
          {scanRunning ? 'Scanning…' : starting ? 'Starting…' : 'Run scan'}
        </Button>
      </div>

      {/* Live scan progress (or a failed / interrupted notice) */}
      {latestScan && (scanRunning || latestScan.data.status === 'failed' || interrupted) && (
        <ScanBanner scan={latestScan.data} interrupted={interrupted} />
      )}

      {firstTime ? (
        <FirstRun ready={icpMut.ready} starting={starting} onRun={runWithPreset} />
      ) : (
      <>
      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {(['all', 'new', 'accepted', 'rejected'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 text-xs capitalize ${filter === f ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by company or domain"
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <span className="hidden text-[11px] text-muted-foreground sm:block">
          <kbd className="rounded bg-muted px-1">j</kbd>/<kbd className="rounded bg-muted px-1">k</kbd> move · <kbd className="rounded bg-muted px-1">a</kbd>/<kbd className="rounded bg-muted px-1">r</kbd> triage · <kbd className="rounded bg-muted px-1">enter</kbd> open
        </span>
      </div>

      {/* Rows */}
      <div ref={rowsRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={scanRunning ? 'Verifying signals…' : rows.length === 0 ? 'No accounts yet' : 'Nothing matches'}
            description={
              scanRunning
                ? 'Accounts appear here as signals are verified.'
                : rows.length === 0
                  ? 'Run a scan to find accounts with recent buying signals.'
                  : 'Try a different filter or search.'
            }
          />
        ) : (
          <div className="space-y-1.5">
            {filtered.map((row, i) => (
              <AccountRow
                key={row.account.recordId}
                row={row}
                active={i === selected}
                onClick={() => { setSelected(i); setOpenId(row.account.recordId) }}
              />
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {openAccount && (
        <AccountDrawer
          account={openAccount.account}
          signals={openAccount.signals}
          heat={openAccount.heat}
          pushed={pushesQ.records.find((p) => p.data.accountId === openAccount.account.recordId)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}

function ScanBanner({ scan, interrupted }: { scan: ScanData; interrupted?: boolean }) {
  if (interrupted) {
    return (
      <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
        Last scan was interrupted (it ran past the time limit). Run another when you're ready.
      </div>
    )
  }
  if (scan.status === 'failed') {
    return (
      <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Scan failed: {scan.errorMessage || 'unknown error'}
      </div>
    )
  }
  const pct = Math.round((scan.progress || 0) * 100)
  return (
    <div className="mb-3 rounded-md border border-border bg-card px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-foreground">{scan.stage || 'Scanning…'}</span>
        <span className="text-muted-foreground tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
        <span>{scan.queriesRun} queries</span>
        <span>{scan.candidatesFound} candidates</span>
        <span>{scan.signalsVerified} signals</span>
      </div>
    </div>
  )
}

/** First-time Board, before any scan: honest empty state, no sample data. */
function FirstRun({ ready, starting, onRun }: { ready: boolean; starting: boolean; onRun: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
          <Radar className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <h2 className="text-base font-semibold text-foreground">Find who to contact this week</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A scan reads the public web for your ICP's triggers, attaches evidence-backed signals to
          company accounts, and ranks them by <span className="text-foreground">heat</span> — ICP fit ×
          how recent and numerous the signals are. Every signal links to its source.
        </p>
        <div className="mt-5">
          <Button onClick={onRun} disabled={!ready || starting}>
            <Radar className="h-4 w-4" aria-hidden />
            {starting ? 'Starting…' : 'Run scan with the DeepSpace preset'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Usually takes about {SCAN_TYPICAL_MINUTES} minutes · <Link to="/icp" className="text-primary hover:underline">customize the ICP first</Link>
        </p>
      </div>
    </div>
  )
}

function AccountRow({ row, active, onClick }: { row: Row; active: boolean; onClick: () => void }) {
  const a = row.account.data
  const types = Array.from(new Set(row.signals.map((s) => s.data.type)))
  return (
    <button
      onClick={onClick}
      aria-current={active}
      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
        active ? 'border-primary/60 bg-card ring-1 ring-primary/30' : 'border-border bg-card/50 hover:bg-card'
      } ${a.status === 'rejected' ? 'opacity-55' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{a.companyName}</span>
          <span className="truncate text-xs text-muted-foreground">{a.domain}</span>
          {a.status === 'accepted' && <span className="rounded-full bg-success/15 px-1.5 text-[10px] font-medium text-success">accepted</span>}
          {a.status === 'rejected' && <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-medium text-destructive">rejected</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {types.slice(0, 4).map((t) => {
              const m = signalMeta(t)
              return <m.Icon key={t} className="h-3 w-3" style={{ color: m.color }} aria-label={m.label} />
            })}
          </span>
          <span className="truncate">{a.whyNow || `${row.signals.length} signal${row.signals.length === 1 ? '' : 's'}`}</span>
        </div>
      </div>
      <div className="w-28 shrink-0">
        <HeatBar heat={row.heat} />
        <div className="mt-0.5 text-right text-[10px] text-muted-foreground">
          {relativeDate(a.lastSignalAt)}
        </div>
      </div>
    </button>
  )
}
