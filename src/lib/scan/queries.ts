/**
 * Step 1 — expand the ICP's triggers into a capped set of search queries, one
 * LLM call with structured output. Each query is routed to exactly one provider
 * (never both): Exa for semantic company-discovery, Firecrawl for keyword/news
 * triggers. The combined total is capped at MAX_QUERIES_PER_SCAN.
 */

import { generateObject } from 'ai'
import { MAX_FIRECRAWL_QUERIES, MAX_QUERIES_PER_SCAN, MODEL_JUDGE, MODEL_REASON } from '../../constants'
import { QueryPlanListSchema, type ModelFactory, type QueryPlan } from './types'
import type { IcpInput } from '../preset'

export async function expandQueries(
  ai: ModelFactory,
  icp: Pick<IcpInput, 'who' | 'triggers' | 'disqualifiers'>,
  cap: number = MAX_QUERIES_PER_SCAN,
): Promise<QueryPlan[]> {
  const system = [
    'You are a GTM research planner. Turn an Ideal Customer Profile into web search queries that will surface RECENT, company-level buying signals.',
    'Rules:',
    `- Produce AT MOST ${cap} queries, COMBINED across both providers.`,
    `- Prefer 'exa'. Use AT MOST ${MAX_FIRECRAWL_QUERIES} 'firecrawl' queries, reserved for funding/launch NEWS; make all the rest 'exa'.`,
    '- Route each query to exactly ONE provider:',
    "    • 'exa' — semantic discovery: 'startups building <X>', 'companies writing about <Y>'. Use for finding companies by what they build or say. This is the high-ROI provider; favor it.",
    "    • 'firecrawl' — keyword/news only: funding announcements and launch news with a named company. Dated, event-like triggers.",
    '- Cover a spread of the triggers; do not spend all queries on one trigger.',
    '- Prefer queries that name a trigger + the ICP shape, and that return companies, not listicles.',
    '- Never target login-only sites (LinkedIn) or individual people. Companies only.',
  ].join('\n')

  const prompt = [
    `ICP — who: ${icp.who}`,
    `Triggers:\n${icp.triggers.map((t) => `  - ${t}`).join('\n')}`,
    `Disqualifiers:\n${icp.disqualifiers.map((d) => `  - ${d}`).join('\n')}`,
  ].join('\n\n')

  // Prefer the stronger model; fall back to the cheap one if it's unavailable
  // (e.g. a free-tier paid-model cap returns 402), so a scan never dies at the
  // very first step.
  let object: { queries: QueryPlan[] }
  try {
    ;({ object } = await generateObject({ model: ai(MODEL_REASON), schema: QueryPlanListSchema, system, prompt }))
  } catch (err) {
    console.warn(`[scan] query expansion on ${MODEL_REASON} failed, retrying on ${MODEL_JUDGE}: ${String(err)}`)
    ;({ object } = await generateObject({ model: ai(MODEL_JUDGE), schema: QueryPlanListSchema, system, prompt }))
  }

  // Enforce the mix deterministically even if the model overruns: keep all Exa
  // queries, cap Firecrawl, and hold the combined total at `cap` (Exa-first).
  const exa = object.queries.filter((q) => q.provider === 'exa')
  const firecrawl = object.queries.filter((q) => q.provider === 'firecrawl').slice(0, MAX_FIRECRAWL_QUERIES)
  return [...exa, ...firecrawl].slice(0, cap)
}
