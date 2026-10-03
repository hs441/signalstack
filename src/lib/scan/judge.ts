/**
 * Step 3 — judge candidate hits in batches with a cheap model (Haiku). For each
 * hit the model decides: is this a real company-level buying signal? It extracts
 * the company name, the company's OWN domain, the signal type/date, a verbatim
 * evidence quote, and a confidence. Hits with no company, no plausible domain,
 * or low confidence are dropped by the caller.
 */

import { generateObject } from 'ai'
import { MODEL_JUDGE } from '../../constants'
import { CandidateListSchema, type Candidate, type Hit, type ModelFactory } from './types'
import type { IcpInput } from '../preset'

const BATCH_SIZE = 8

/** A judged hit paired back with its source hit. */
export interface Judged {
  candidate: Candidate
  hit: Hit
}

export async function judgeCandidates(
  ai: ModelFactory,
  icp: Pick<IcpInput, 'who' | 'triggers' | 'disqualifiers'>,
  hits: Hit[],
  onProgress?: (done: number, total: number) => void,
): Promise<Judged[]> {
  const system = [
    'You verify whether web search results are REAL, company-level buying signals for a given ICP.',
    'For each hit decide isSignal. A signal is a concrete, recent event or statement about a SPECIFIC company that matches a trigger.',
    'Hard rules:',
    '- Companies only. Never a person, a listicle, a directory, a generic blog post, or the search provider itself.',
    "- companyDomain must be the COMPANY'S OWN domain (e.g. acme.com), inferred from the text — NOT the article host (techcrunch.com, news sites, Product Hunt).",
    '- If you cannot identify a specific company AND a plausible own-domain, set isSignal=false.',
    '- Honor the ICP disqualifiers (enterprises, agencies, non-software) — those are isSignal=false.',
    '- evidenceQuote must be a short verbatim span from the provided text. If none exists, isSignal=false.',
    '- confidence reflects how sure you are it is a real, on-ICP signal.',
    'Return one result object per hit, keyed by its index.',
  ].join('\n')

  const icpBlock = [
    `ICP who: ${icp.who}`,
    `Triggers: ${icp.triggers.join('; ')}`,
    `Disqualifiers: ${icp.disqualifiers.join('; ')}`,
  ].join('\n')

  const judged: Judged[] = []
  let done = 0

  for (let i = 0; i < hits.length; i += BATCH_SIZE) {
    const batch = hits.slice(i, i + BATCH_SIZE)
    const hitBlock = batch
      .map((h, j) => `# Hit ${j}\nurl: ${h.url}\ntitle: ${h.title}\ntext: ${h.snippet}`)
      .join('\n\n')

    try {
      const { object } = await generateObject({
        model: ai(MODEL_JUDGE),
        schema: CandidateListSchema,
        system,
        prompt: `${icpBlock}\n\nJudge these ${batch.length} hits (indices 0..${batch.length - 1}):\n\n${hitBlock}`,
      })
      for (const c of object.results) {
        const hit = batch[c.index]
        if (hit) judged.push({ candidate: c, hit })
      }
    } catch (err) {
      console.warn(`[scan] judge batch failed: ${String(err)}`)
    }

    done += batch.length
    onProgress?.(Math.min(done, hits.length), hits.length)
  }

  return judged
}
