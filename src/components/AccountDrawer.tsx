/**
 * AccountDrawer — right-side slide-over for one account: signal timeline (with
 * evidence + source links), fit rationale, a draft-opener tool, and accept/
 * reject with a reason. Triage + opener go through server actions.
 */

import { useEffect, useState } from 'react'
import type { RecordData } from 'deepspace'
import { Building2, Check, Copy, ExternalLink, Sparkles, X } from 'lucide-react'
import { Button, useToast } from './ui'
import { HeatBar } from './HeatBar'
import { callAction } from '../lib/actions'
import { relativeDate, signalMeta } from '../lib/heat-ui'
import { ageInDays, decay, signalWeight } from '../lib/heat'
import type { AccountData, CrmPushData, SignalData } from '../types'

interface CrmPreview {
  toolkit: string
  dedupeKey: string
  company: { name: string; domain: string; website: string; description: string }
  noteBody: string
}

interface Props {
  account: RecordData<AccountData>
  signals: RecordData<SignalData>[]
  heat: number
  pushed?: RecordData<CrmPushData>
  onClose: () => void
}

export function AccountDrawer({ account, signals, heat, pushed, onClose }: Props) {
  const { success, error, info } = useToast()
  const a = account.data
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  // Opener is cached on the account; show it without calling the model. Only an
  // explicit Draft/Regenerate click calls the model again.
  const [opener, setOpener] = useState(a.opener ?? '')
  const [openerSignalId, setOpenerSignalId] = useState(a.openerSignalId ?? '')
  const [openerLoading, setOpenerLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // CRM state.
  const [connected, setConnected] = useState<boolean | null>(null)
  const [preview, setPreview] = useState<CrmPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectUrl, setConnectUrl] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)
  const [pushResult, setPushResult] = useState<{ externalUrl?: string; status?: string } | null>(
    pushed ? { externalUrl: pushed.data.externalUrl, status: pushed.data.status } : null,
  )

  // Reset transient state when switching accounts.
  useEffect(() => {
    setReason('')
    setOpener(a.opener ?? '')
    setOpenerSignalId(a.openerSignalId ?? '')
    setCopied(false)
    setPreview(null)
    setPushResult(pushed ? { externalUrl: pushed.data.externalUrl, status: pushed.data.status } : null)
  }, [account.recordId, a.opener, a.openerSignalId, pushed])

  // Check CRM connection once per account.
  useEffect(() => {
    let cancelled = false
    void callAction<{ connected: boolean }>('crmStatus').then((r) => {
      if (!cancelled) setConnected(r.success ? r.data.connected : false)
    })
    return () => {
      cancelled = true
    }
  }, [account.recordId])

  const sorted = [...signals].sort((x, y) => (y.data.signalDate || '').localeCompare(x.data.signalDate || ''))

  // The signal an opener *should* be grounded in now (strongest = weight × freshness).
  const strongestId = [...signals]
    .map((s) => ({ id: s.recordId, score: signalWeight(s.data.type) * decay(ageInDays(s.data.signalDate || new Date().toISOString())) }))
    .sort((x, y) => y.score - x.score)[0]?.id
  const openerStale = !!opener && !!openerSignalId && !!strongestId && openerSignalId !== strongestId

  async function triage(decision: 'accept' | 'reject') {
    setBusy(true)
    const res = await callAction('triageAccount', { accountId: account.recordId, decision, reason })
    setBusy(false)
    if (res.success) {
      success(decision === 'accept' ? 'Accepted' : 'Rejected', a.companyName)
      onClose()
    } else {
      error('Could not save', res.error)
    }
  }

  async function draft() {
    setOpenerLoading(true)
    const res = await callAction<{ opener: string; openerSignalId: string }>('draftOpener', { accountId: account.recordId })
    setOpenerLoading(false)
    if (res.success) {
      setOpener(res.data.opener)
      setOpenerSignalId(res.data.openerSignalId)
    } else error('Could not draft opener', res.error)
  }

  async function doPreview() {
    setPreviewLoading(true)
    const res = await callAction<CrmPreview>('crmPreview', { accountId: account.recordId })
    setPreviewLoading(false)
    if (res.success) setPreview(res.data)
    else error('Could not build preview', res.error)
  }

  async function doConnect() {
    setConnecting(true)
    const res = await callAction<{ redirectUrl?: string }>('crmConnect', {
      callbackUrl: `${window.location.origin}/board`,
    })
    setConnecting(false)
    if (res.success && res.data.redirectUrl) {
      setConnectUrl(res.data.redirectUrl)
      // Best-effort auto-open; the visible link below is the reliable path
      // (programmatic window.open is often popup-blocked).
      window.open(res.data.redirectUrl, '_blank', 'noopener')
    } else {
      error('Could not start HubSpot connect', res.success ? 'No redirect URL' : res.error)
    }
  }

  async function recheck() {
    setRechecking(true)
    const res = await callAction<{ connected: boolean }>('crmStatus')
    setRechecking(false)
    if (res.success && res.data.connected) {
      setConnected(true)
      setConnectUrl(null)
      info('HubSpot connected', 'You can push now.')
    } else {
      info('Not connected yet', 'Finish the HubSpot consent, then recheck.')
    }
  }

  async function doPush() {
    setPushing(true)
    const res = await callAction<{ status: string; externalUrl: string }>('crmPush', { accountId: account.recordId })
    setPushing(false)
    if (res.success) {
      setPushResult({ externalUrl: res.data.externalUrl, status: res.data.status })
      success(res.data.status === 'updated' ? 'Updated in HubSpot' : 'Pushed to HubSpot', a.companyName)
    } else if (res.code === 'not_connected') {
      setConnected(false)
      error('Not connected', 'Connect HubSpot first, then push.')
    } else {
      error('Push failed', res.error)
    }
  }

  async function copyOpener() {
    try {
      await navigator.clipboard.writeText(opener)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      error('Copy failed', 'Select the text and copy manually.')
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-label={`${a.companyName} details`}>
      <button aria-label="Close" className="flex-1 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-border bg-shell-panel shadow-[0_0_40px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">{a.companyName}</h2>
            <a
              href={`https://${a.domain}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              {a.domain} <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Scores */}
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>Fit <span className="font-semibold text-foreground">{a.fit}</span></span>
              <span className="text-border">·</span>
              <span>{sorted.length} signal{sorted.length === 1 ? '' : 's'}</span>
              {a.status !== 'new' && (
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${a.status === 'accepted' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
                  {a.status}
                </span>
              )}
            </div>
            <HeatBar heat={heat} />
          </div>

          {/* Why now */}
          {a.whyNow && (
            <div className="rounded-md border border-border bg-card p-3">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Why now</div>
              <p className="text-sm text-foreground">{a.whyNow}</p>
            </div>
          )}

          {/* Fit rationale */}
          {a.fitRationale && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Fit rationale</div>
              <p className="text-sm text-muted-foreground">{a.fitRationale}</p>
            </div>
          )}

          {/* Signal timeline */}
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Signals</div>
            <ol className="space-y-3">
              {sorted.map((s) => {
                const meta = signalMeta(s.data.type)
                return (
                  <li key={s.recordId} className="relative border-l border-border pl-4">
                    <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                    <div className="flex items-center gap-2 text-xs">
                      <meta.Icon className="h-3.5 w-3.5" style={{ color: meta.color }} aria-hidden />
                      <span className="font-medium text-foreground">{meta.label}</span>
                      <span className="text-muted-foreground">{relativeDate(s.data.signalDate)}</span>
                      <span className="ml-auto text-[10px] uppercase text-muted-foreground">{s.data.provider}</span>
                    </div>
                    <blockquote className="mt-1 text-sm text-muted-foreground">“{s.data.evidenceQuote}”</blockquote>
                    <a
                      href={s.data.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Source <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </li>
                )
              })}
            </ol>
          </div>

          {/* Opener */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Opener</div>
              <Button size="sm" variant="secondary" onClick={draft} disabled={openerLoading}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {openerLoading ? 'Drafting…' : opener ? 'Regenerate' : 'Draft opener'}
              </Button>
            </div>
            {opener && (
              <div className="rounded-md border border-border bg-card p-3">
                <p className="whitespace-pre-wrap text-sm text-foreground">{opener}</p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={copyOpener}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  {openerStale && (
                    <span className="text-[11px] text-warning">New signals since — regenerate to refresh.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* CRM */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">CRM — HubSpot</div>
              <Button size="sm" variant="secondary" onClick={doPreview} disabled={previewLoading}>
                <Building2 className="h-3.5 w-3.5" aria-hidden />
                {previewLoading ? 'Building…' : 'Preview payload'}
              </Button>
            </div>

            {preview && (
              <div className="mb-2 space-y-2 rounded-md border border-border bg-card p-3 text-xs">
                <div className="text-muted-foreground">
                  Dedupe key: <span className="text-foreground">{preview.dedupeKey}</span>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span className="text-muted-foreground">name</span><span className="text-foreground">{preview.company.name}</span>
                  <span className="text-muted-foreground">domain</span><span className="text-foreground">{preview.company.domain}</span>
                  <span className="text-muted-foreground">website</span><span className="truncate text-foreground">{preview.company.website}</span>
                  <span className="text-muted-foreground">description</span><span className="text-foreground">{preview.company.description}</span>
                </div>
                <div>
                  <div className="mb-1 text-muted-foreground">note</div>
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px] text-muted-foreground">{preview.noteBody}</pre>
                </div>
              </div>
            )}

            {pushResult ? (
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${pushResult.status === 'updated' ? 'bg-info/15 text-info' : 'bg-success/15 text-success'}`}>
                  {pushResult.status === 'updated' ? 'updated' : 'pushed'}
                </span>
                {pushResult.externalUrl && (
                  <a href={pushResult.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    View in HubSpot <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
                <Button size="sm" variant="secondary" className="ml-auto" onClick={doPush} disabled={pushing}>
                  {pushing ? 'Pushing…' : 'Push again'}
                </Button>
              </div>
            ) : connected === false ? (
              connectUrl ? (
                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={connectUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    Open HubSpot consent <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  <Button size="sm" variant="secondary" onClick={recheck} disabled={rechecking}>
                    {rechecking ? 'Checking…' : "I've connected — recheck"}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" onClick={doConnect} disabled={connecting}>
                  {connecting ? 'Opening…' : 'Connect HubSpot'}
                </Button>
              )
            ) : connected ? (
              <Button size="sm" onClick={doPush} disabled={pushing}>
                {pushing ? 'Pushing…' : 'Push to HubSpot'}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Checking HubSpot connection…</span>
            )}
          </div>
        </div>

        {/* Triage footer */}
        <div className="space-y-2 border-t border-border p-4">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional) — tunes future scoring"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => triage('accept')} disabled={busy}>
              Accept
            </Button>
            <Button className="flex-1" variant="destructive" onClick={() => triage('reject')} disabled={busy}>
              Reject
            </Button>
          </div>
        </div>
      </aside>
    </div>
  )
}
