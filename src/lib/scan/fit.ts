/**
 * Step 5 — score an account's fit against the ICP with a stronger model
 * (Sonnet). Returns fit 0–100 + a rationale + a one-line "why now", grounded in
 * the account's signals. The caller feeds in the user's most recent ~10
 * accept/reject decisions as calibration examples (prompt calibration, not ML).
 */

import { generateObject } from 'ai'
import { MODEL_JUDGE, MODEL_REASON } from '../../constants'
import { FitSchema, type FitResult, type ModelFactory } from './types'
import type { IcpInput } from '../preset'

export interface FitSignalInput {
  type: string
  signalDate: string | null
  evidenceQuote: string
  sourceUrl: string
}

export interface FeedbackExample {
  decision: 'accept' | 'reject'
  companyName: string
  reason: string
}

export async function scoreFit(
  ai: ModelFactory,
  icp: Pick<IcpInput, 'who' | 'triggers' | 'disqualifiers'>,
  account: { companyName: string; domain: string },
  signals: FitSignalInput[],
  feedback: FeedbackExample[] = [],
): Promise<FitResult> {
  const system = [
    'You score how well a company fits an Ideal Customer Profile, for a GTM seller deciding who to contact this week.',
    'fit is 0–100: 100 = textbook ICP match, 0 = clearly not a fit (or a disqualifier).',
    'Ground your rationale and whyNow in the SIGNALS provided; do not invent facts.',
    'whyNow is one crisp line a seller could act on. No fake familiarity, no fluff.',
    feedback.length
      ? 'Calibrate to the user\'s past decisions below: lean toward what they accepted and away from what they rejected, for similar reasons.'
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const icpBlock = [
    `ICP who: ${icp.who}`,
    `Triggers: ${icp.triggers.join('; ')}`,
    `Disqualifiers: ${icp.disqualifiers.join('; ')}`,
  ].join('\n')

  const signalBlock = signals.length
    ? signals
        .map((s) => `- [${s.type}${s.signalDate ? ` ${s.signalDate}` : ''}] "${s.evidenceQuote}" (${s.sourceUrl})`)
        .join('\n')
    : '(no signals yet)'

  const feedbackBlock = feedback.length
    ? feedback
        .map((f) => `- ${f.decision === 'accept' ? 'Accepted' : 'Rejected'} ${f.companyName}: ${f.reason || '(no reason given)'}`)
        .join('\n')
    : ''

  const prompt = [
    icpBlock,
    `\nCompany: ${account.companyName} (${account.domain})`,
    `Signals:\n${signalBlock}`,
    feedbackBlock ? `\nUser's recent decisions (calibration):\n${feedbackBlock}` : '',
  ].join('\n')

  // Prefer the stronger model; fall back to the cheap one if it's unavailable
  // (e.g. a free-tier paid-model cap returns 402). The caller falls back to a
  // heuristic fit only if BOTH models fail.
  try {
    const { object } = await generateObject({ model: ai(MODEL_REASON), schema: FitSchema, system, prompt })
    return object
  } catch (err) {
    console.warn(`[scan] fit on ${MODEL_REASON} failed, retrying on ${MODEL_JUDGE}: ${String(err)}`)
    const { object } = await generateObject({ model: ai(MODEL_JUDGE), schema: FitSchema, system, prompt })
    return object
  }
}
