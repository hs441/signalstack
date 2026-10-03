/**
 * Heat scoring — deterministic code, not vibes.
 *
 * The LLM judges (fit 0–100 against the ICP rubric); THIS module computes heat.
 * Pure functions, unit-tested, no I/O. Formula from the brief:
 *
 *   decay   d_i  = 0.5 ^ (ageDays / halfLifeDays)      // 21-day half-life
 *   intent       = 1 − Π(1 − w_i · d_i)                 // independent-probability stack
 *   heat         = round( fit × (0.35 + 0.65 × intent) )
 *
 * Intent combines signals like independent probabilities: a second signal adds
 * less than the first (diminishing returns) and the total stays in [0, 1]. Fit
 * sets the ceiling; intent decides how close an account gets to it.
 */

import { HALF_LIFE_DAYS } from '../constants'

export { HALF_LIFE_DAYS }

/** Signal types and their base weights (brief defaults). */
export const SIGNAL_WEIGHTS = {
  funding: 0.8,
  hiring: 0.7,
  launch: 0.6,
  stack: 0.5,
  other: 0.3,
} as const

export type SignalType = keyof typeof SIGNAL_WEIGHTS

/** Weight for a signal type; unknown types fall back to `other`. */
export function signalWeight(type: string): number {
  return (SIGNAL_WEIGHTS as Record<string, number>)[type] ?? SIGNAL_WEIGHTS.other
}

/**
 * Age-based decay in [0, 1]. Fresh (age ≤ 0) → 1; one half-life → 0.5.
 * Negative ages (clock skew, future-dated) are clamped to "fresh".
 */
export function decay(ageDays: number, halfLifeDays: number = HALF_LIFE_DAYS): number {
  if (halfLifeDays <= 0) throw new Error('halfLifeDays must be > 0')
  if (ageDays <= 0) return 1
  return Math.pow(0.5, ageDays / halfLifeDays)
}

/** Minimal shape heat scoring needs from a signal. */
export interface HeatSignal {
  type: string
  /** Age of the signal in days (now − signalDate). */
  ageDays: number
}

/**
 * intent = 1 − Π(1 − w_i · d_i), in [0, 1).
 * No signals → 0.
 */
export function intentScore(signals: readonly HeatSignal[], halfLifeDays: number = HALF_LIFE_DAYS): number {
  let product = 1
  for (const s of signals) {
    const w = signalWeight(s.type)
    const d = decay(s.ageDays, halfLifeDays)
    product *= 1 - w * d
  }
  return 1 - product
}

/**
 * heat = round( fit × (0.35 + 0.65 × intent) ), in [0, 100].
 * `fit` is clamped to [0, 100] defensively.
 */
export function heatScore(
  fit: number,
  signals: readonly HeatSignal[],
  halfLifeDays: number = HALF_LIFE_DAYS,
): number {
  const clampedFit = Math.max(0, Math.min(100, fit))
  const intent = intentScore(signals, halfLifeDays)
  return Math.round(clampedFit * (0.35 + 0.65 * intent))
}

/** Convenience: age in days between an ISO date and `now` (ms), never negative. */
export function ageInDays(signalDateIso: string, now: number = Date.now()): number {
  const then = Date.parse(signalDateIso)
  if (Number.isNaN(then)) return 0
  return Math.max(0, (now - then) / 86_400_000)
}
