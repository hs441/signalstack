/**
 * Domain normalization — the dedupe key for accounts. A company is one account
 * per normalized registrable-ish domain. We keep this deterministic and in one
 * place so the scan engine, CRM push, and UI agree on identity.
 */

/**
 * Normalize a URL or bare domain to a lowercase host without scheme, `www.`,
 * path, port, or query. Returns '' when nothing usable is present.
 *
 *   https://www.Acme.com/careers  → acme.com
 *   Acme.com                      → acme.com
 *   sub.acme.co.uk                → sub.acme.co.uk  (we don't strip subdomains)
 */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return ''
  let s = input.trim().toLowerCase()
  if (!s) return ''
  // Add a scheme so URL() can parse bare domains too.
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`
  let host: string
  try {
    host = new URL(s).hostname
  } catch {
    return ''
  }
  host = host.replace(/^www\./, '')
  // Reject obvious non-domains (no dot, or localhost).
  if (!host.includes('.') || host === 'localhost') return ''
  return host
}

/** Hostname of a result URL (for provenance / "is this the company's own site?"). */
export function hostOf(url: string): string {
  return normalizeDomain(url)
}
