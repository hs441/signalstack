/**
 * Shared types + structured-output (zod) schemas for the scan engine.
 *
 * The LLM only ever returns these structured shapes (via the worker AI SDK's
 * `generateObject` — the raw `anthropic/chat-completion` integration has no
 * JSON mode). Code does everything else: search, dedupe, scoring (heat.ts).
 */

import { z } from 'zod'
import type { LanguageModel } from 'ai'
import { PROVIDERS } from '../../constants'
import type { SignalType } from '../heat'

/** A provider-resolving model factory, e.g. createDeepSpaceAI(env, 'anthropic'). */
export type ModelFactory = (modelId: string) => LanguageModel

export const SIGNAL_TYPES = ['funding', 'hiring', 'launch', 'stack', 'other'] as const

/** One planned search query, routed to exactly one provider. */
export const QueryPlanSchema = z.object({
  query: z.string().min(3).describe('The search query string.'),
  provider: z
    .enum(PROVIDERS)
    .describe(
      "'exa' for semantic company-discovery (find companies building X); 'firecrawl' for keyword/news trigger searches (funding, hiring, launch news).",
    ),
  signalType: z.enum(SIGNAL_TYPES).describe('The trigger type this query hunts for.'),
  rationale: z.string().optional(),
})
export type QueryPlan = z.infer<typeof QueryPlanSchema>

export const QueryPlanListSchema = z.object({
  queries: z.array(QueryPlanSchema),
})

/** A normalized search hit, provider-agnostic. */
export interface Hit {
  url: string
  title: string
  /** Best snippet/evidence text the provider gave us. */
  snippet: string
  /** ISO date the source was published, when known. */
  publishedDate: string | null
  provider: (typeof PROVIDERS)[number]
  /** The query that surfaced it (for debugging / provenance). */
  query: string
}

/** The LLM's judgment of a single candidate hit. */
export const CandidateSchema = z.object({
  index: z.number().int().describe('The 0-based index of the hit being judged.'),
  isSignal: z.boolean().describe('True only if this is a real buying trigger for a specific COMPANY.'),
  companyName: z.string().nullable(),
  companyDomain: z
    .string()
    .nullable()
    .describe("The COMPANY'S OWN domain (e.g. acme.com), not the article's host (e.g. techcrunch.com)."),
  signalType: z.enum(SIGNAL_TYPES),
  signalDate: z.string().nullable().describe('ISO date of the event if stated, else null.'),
  evidenceQuote: z.string().describe('A short verbatim quote from the text that evidences the signal.'),
  confidence: z.number().min(0).max(1),
})
export type Candidate = z.infer<typeof CandidateSchema>

export const CandidateListSchema = z.object({
  results: z.array(CandidateSchema),
})

/** The LLM's fit judgment for one account against the ICP rubric. */
export const FitSchema = z.object({
  fit: z.number().min(0).max(100).describe('0–100 fit against the ICP rubric.'),
  rationale: z.string().describe('One or two sentences justifying the fit score, citing the signals.'),
  whyNow: z.string().describe('A single crisp line: why reach out to this account THIS week.'),
})
export type FitResult = z.infer<typeof FitSchema>

/** Per-provider tallies reported at Checkpoint 2. */
export interface ProviderStats {
  queries: number
  hits: number
  judgedSignals: number
  stored: number
  droppedLowConfidenceOrNoDomain: number
  searchCostUsd: number
}

export type SignalTypeName = SignalType
