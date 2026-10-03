/**
 * CRM payload builder — the SINGLE source of truth for what we send to HubSpot.
 * The drawer preview and the real push both call this, so the two can never
 * disagree. Pure + unit-tested.
 *
 * HubSpot (via Composio): company dedupe key is `domain`. CREATE_COMPANY takes
 * flat properties; UPDATE_COMPANY takes { companyId, properties }; CREATE_NOTE
 * takes { hs_note_body, hs_timestamp, associations }.
 */

export interface CrmAccountInput {
  companyName: string
  domain: string
  fit: number
  whyNow?: string
  fitRationale?: string
}

export interface CrmSignalInput {
  type: string
  signalDate: string | null
  evidenceQuote: string
  sourceUrl: string
  provider?: string
}

export interface CrmPayload {
  /** Dedupe key — one company per normalized domain. */
  dedupeKey: string
  /** Flat company properties (HubSpot internal names). */
  company: {
    name: string
    domain: string
    website: string
    description: string
  }
  /** Plain-text note body listing signals, sources, and why-now. */
  noteBody: string
}

export function buildCrmPayload(account: CrmAccountInput, signals: CrmSignalInput[], heat: number): CrmPayload {
  const domain = account.domain
  const description = [
    `SignalStack — heat ${heat}, fit ${account.fit}.`,
    account.whyNow ? `Why now: ${account.whyNow}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500)

  const lines: string[] = []
  lines.push(`${account.companyName} (${domain}) — SignalStack`)
  lines.push(`Heat ${heat} · Fit ${account.fit}`)
  if (account.whyNow) lines.push(`Why now: ${account.whyNow}`)
  if (account.fitRationale) lines.push(`Fit: ${account.fitRationale}`)
  lines.push('')
  lines.push(`Signals (${signals.length}):`)
  for (const s of signals) {
    const date = s.signalDate ? ` ${s.signalDate}` : ''
    const prov = s.provider ? ` [${s.provider}]` : ''
    lines.push(`• ${s.type}${date}${prov}: "${s.evidenceQuote}"`)
    lines.push(`  ${s.sourceUrl}`)
  }
  const noteBody = lines.join('\n')

  return {
    dedupeKey: domain,
    company: {
      name: account.companyName,
      domain,
      website: `https://${domain}`,
      description,
    },
    noteBody,
  }
}
