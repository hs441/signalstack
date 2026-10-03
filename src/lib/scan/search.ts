/**
 * Step 2 — run each planned query on its single provider, normalize results to
 * `Hit`, dedupe by URL, and tally per-provider cost + counts.
 *
 * Exa → exa/search (semantic discovery, returns clean `text` for evidence).
 * Firecrawl → firecrawl/search (keyword/news; `description` is the reliable
 * snippet since scraped `markdown` can be a bot-wall challenge page).
 */

import { MAX_RESULTS_PER_QUERY } from '../../constants'
import type { Hit, ProviderStats, QueryPlan } from './types'

/** Matches CronContext.integrations.call / ActionTools.integration (returns raw output). */
export type CallFn = (endpoint: string, params: Record<string, unknown>) => Promise<unknown>

const MAX_SNIPPET = 1200

function clamp(s: unknown, n = MAX_SNIPPET): string {
  const str = typeof s === 'string' ? s : ''
  return str.length > n ? `${str.slice(0, n)}…` : str
}

/** Firecrawl's scraped markdown is only useful when it isn't a bot-wall page. */
function usableMarkdown(md: unknown): string {
  const s = typeof md === 'string' ? md : ''
  if (/checking your browser|verifying\b|enable javascript|cf-challenge|turnstile/i.test(s)) return ''
  return s
}

interface ExaItem { title?: string; url?: string; publishedDate?: string | null; text?: string }
interface FirecrawlItem {
  url?: string
  title?: string
  description?: string
  markdown?: string
  metadata?: { publishedTime?: string; modifiedTime?: string } | string | null
}

function parsePublishedTime(metadata: FirecrawlItem['metadata']): string | null {
  if (!metadata) return null
  if (typeof metadata === 'string') {
    const m = metadata.match(/'publishedTime':\s*'([^']+)'/)
    return m ? m[1] : null
  }
  return metadata.publishedTime ?? metadata.modifiedTime ?? null
}

async function runExa(call: CallFn, plan: QueryPlan, limit: number): Promise<{ hits: Hit[]; costUsd: number }> {
  const out = (await call('exa/search', {
    query: plan.query,
    numResults: limit,
    type: 'auto',
    contents: { text: { maxCharacters: 1000 } },
  })) as { results?: ExaItem[]; costUsd?: number }
  const hits: Hit[] = (out.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      url: r.url as string,
      title: r.title ?? '',
      snippet: clamp(r.text ?? r.title ?? ''),
      publishedDate: r.publishedDate ?? null,
      provider: 'exa' as const,
      query: plan.query,
    }))
  return { hits, costUsd: out.costUsd ?? 0 }
}

async function runFirecrawl(call: CallFn, plan: QueryPlan, limit: number): Promise<{ hits: Hit[]; costUsd: number }> {
  const out = (await call('firecrawl/search', {
    query: plan.query,
    limit,
    scrapeOptions: { formats: ['markdown'] },
  })) as { data?: FirecrawlItem[]; costUsd?: number }
  const hits: Hit[] = (out.data ?? [])
    .filter((r) => r.url)
    .map((r) => {
      const md = usableMarkdown(r.markdown)
      const snippet = clamp([r.description, md].filter(Boolean).join('\n\n'))
      return {
        url: r.url as string,
        title: r.title ?? '',
        snippet: snippet || clamp(r.title ?? ''),
        publishedDate: parsePublishedTime(r.metadata),
        provider: 'firecrawl' as const,
        query: plan.query,
      }
    })
  return { hits, costUsd: out.costUsd ?? 0 }
}

export interface SearchOutcome {
  hits: Hit[]
  stats: Record<'exa' | 'firecrawl', ProviderStats>
}

function emptyStats(): ProviderStats {
  return { queries: 0, hits: 0, judgedSignals: 0, stored: 0, droppedLowConfidenceOrNoDomain: 0, searchCostUsd: 0 }
}

/**
 * Run all plans, dedupe hits by URL (first provider to surface a URL wins),
 * and return hits + per-provider stats (queries/hits/cost filled in here;
 * judged/stored/dropped filled in later by the judge + persistence steps).
 */
export async function runSearch(
  call: CallFn,
  plans: QueryPlan[],
  maxResults: number = MAX_RESULTS_PER_QUERY,
  onProgress?: (done: number, total: number) => void,
): Promise<SearchOutcome> {
  const stats = { exa: emptyStats(), firecrawl: emptyStats() }
  const seen = new Set<string>()
  const hits: Hit[] = []

  let done = 0
  for (const plan of plans) {
    stats[plan.provider].queries += 1
    try {
      const { hits: got, costUsd } =
        plan.provider === 'exa'
          ? await runExa(call, plan, maxResults)
          : await runFirecrawl(call, plan, maxResults)
      stats[plan.provider].searchCostUsd += costUsd
      for (const h of got) {
        const key = h.url.toLowerCase().replace(/[#?].*$/, '').replace(/\/$/, '')
        if (seen.has(key)) continue
        seen.add(key)
        stats[plan.provider].hits += 1
        hits.push(h)
      }
    } catch (err) {
      // A single query failing (rate limit, provider hiccup) must not sink the
      // whole scan; log and move on.
      console.warn(`[scan] query failed (${plan.provider}): ${String(err)}`)
    }
    done += 1
    onProgress?.(done, plans.length)
  }

  return { hits, stats }
}
