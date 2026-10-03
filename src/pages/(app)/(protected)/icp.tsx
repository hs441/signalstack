/**
 * ICP editor — pre-filled with the DeepSpace preset (or the user's saved ICP).
 * Writes go through useMutations('icps'); ownerUserId is auto-stamped server-side
 * (userBound). Save is disabled until the collection is `ready`.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutations, useQuery } from 'deepspace'
import { Button, Label, Switch, useToast } from '@/components/ui'
import { DEEPSPACE_PRESET } from '../../../lib/preset'
import type { IcpData } from '../../../types'

export default function IcpEditorPage() {
  const navigate = useNavigate()
  const { success, error } = useToast()
  // Query on the stored boolean form (integer 1), not `true` — see BUILD_LOG.
  const icps = useQuery<IcpData>('icps', { where: { active: 1 }, limit: 5 })
  const { ready, create, put } = useMutations<IcpData>('icps')

  const existing = icps.records[0]
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState(DEEPSPACE_PRESET.name)
  const [who, setWho] = useState(DEEPSPACE_PRESET.who)
  const [triggers, setTriggers] = useState(DEEPSPACE_PRESET.triggers.join('\n'))
  const [disqualifiers, setDisqualifiers] = useState(DEEPSPACE_PRESET.disqualifiers.join('\n'))
  const [crmToolkit, setCrmToolkit] = useState(DEEPSPACE_PRESET.crmToolkit)
  const [rescanEnabled, setRescanEnabled] = useState(DEEPSPACE_PRESET.rescanEnabled)
  const [saving, setSaving] = useState(false)

  // Hydrate from the saved ICP once it loads (don't clobber edits after).
  useEffect(() => {
    if (loaded || icps.status === 'loading') return
    if (existing) {
      const d = existing.data
      setName(d.name)
      setWho(d.who)
      setTriggers((d.triggers ?? []).join('\n'))
      setDisqualifiers((d.disqualifiers ?? []).join('\n'))
      setCrmToolkit(d.crmToolkit || DEEPSPACE_PRESET.crmToolkit)
      setRescanEnabled(!!d.rescanEnabled)
    }
    setLoaded(true)
  }, [existing, icps.status, loaded])

  const toLines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)

  async function save() {
    if (!name.trim()) { error('Name required', 'Give your ICP a name.'); return }
    setSaving(true)
    // Omit ownerUserId: it's auto-stamped on create (userBound) and immutable on
    // update — sending it on put would trip the immutable-field check and reject
    // the whole write.
    const payload = {
      name: name.trim(),
      who: who.trim(),
      triggers: toLines(triggers),
      disqualifiers: toLines(disqualifiers),
      crmToolkit: crmToolkit.trim() || DEEPSPACE_PRESET.crmToolkit,
      rescanEnabled,
      active: true,
    }
    try {
      if (existing) await put(existing.recordId, payload)
      else await create(payload as IcpData)
      success('ICP saved', 'Head to the Board to run a scan.')
      navigate('/board')
    } catch (err) {
      error('Could not save', String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-foreground">Ideal customer profile</h1>
        <p className="text-xs text-muted-foreground">
          Describe who you sell to and the buying triggers you care about. Scans expand these into searches.
        </p>
      </div>

      <div className="space-y-5">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="DeepSpace ICP" />
        </Field>

        <Field label="Who you sell to" hint="One or two sentences describing the ideal company.">
          <textarea value={who} onChange={(e) => setWho(e.target.value)} rows={3} className={inputCls} />
        </Field>

        <Field label="Buying triggers" hint="One per line. Events that mean 'reach out now'.">
          <textarea value={triggers} onChange={(e) => setTriggers(e.target.value)} rows={6} className={inputCls} />
        </Field>

        <Field label="Disqualifiers" hint="One per line. Companies to exclude.">
          <textarea value={disqualifiers} onChange={(e) => setDisqualifiers(e.target.value)} rows={3} className={inputCls} />
        </Field>

        <Field label="CRM toolkit" hint="Composio toolkit accepted accounts push to.">
          <input value={crmToolkit} onChange={(e) => setCrmToolkit(e.target.value)} className={inputCls} placeholder="hubspot" />
        </Field>

        <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5">
          <div>
            <Label>Daily rescans</Label>
            <p className="text-xs text-muted-foreground">Rescan this ICP once a day; new signals stack, old ones decay.</p>
          </div>
          <Switch checked={rescanEnabled} onCheckedChange={setRescanEnabled} />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!ready || saving}>
            {saving ? 'Saving…' : existing ? 'Save changes' : 'Save ICP'}
          </Button>
          {!ready && <span className="text-xs text-muted-foreground">Connecting…</span>}
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      {hint && <p className="mb-1.5 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}
