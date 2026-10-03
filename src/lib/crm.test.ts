import { describe, it, expect } from 'vitest'
import { buildCrmPayload } from './crm'

const account = {
  companyName: 'Acme',
  domain: 'acme.com',
  fit: 82,
  whyNow: 'Just raised a seed round.',
  fitRationale: 'AI-native, small team.',
}
const signals = [
  { type: 'funding', signalDate: '2026-09-28', evidenceQuote: 'raised $8M seed', sourceUrl: 'https://x.com/a', provider: 'firecrawl' },
  { type: 'hiring', signalDate: '2026-09-20', evidenceQuote: 'hiring founding engineer', sourceUrl: 'https://acme.com/jobs', provider: 'exa' },
]

describe('buildCrmPayload', () => {
  it('uses domain as the dedupe key', () => {
    expect(buildCrmPayload(account, signals, 70).dedupeKey).toBe('acme.com')
  })

  it('sets flat company properties', () => {
    const { company } = buildCrmPayload(account, signals, 70)
    expect(company.name).toBe('Acme')
    expect(company.domain).toBe('acme.com')
    expect(company.website).toBe('https://acme.com')
    expect(company.description).toContain('heat 70')
    expect(company.description).toContain('fit 82')
  })

  it('note body lists every signal with its source and why-now', () => {
    const { noteBody } = buildCrmPayload(account, signals, 70)
    expect(noteBody).toContain('Why now: Just raised a seed round.')
    expect(noteBody).toContain('raised $8M seed')
    expect(noteBody).toContain('https://x.com/a')
    expect(noteBody).toContain('hiring founding engineer')
    expect(noteBody).toContain('https://acme.com/jobs')
    expect(noteBody).toContain('Signals (2):')
  })

  it('is deterministic (preview and push get identical output)', () => {
    const a = buildCrmPayload(account, signals, 70)
    const b = buildCrmPayload(account, signals, 70)
    expect(a).toEqual(b)
  })
})
