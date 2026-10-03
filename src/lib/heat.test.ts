import { describe, it, expect } from 'vitest'
import {
  HALF_LIFE_DAYS,
  SIGNAL_WEIGHTS,
  signalWeight,
  decay,
  intentScore,
  heatScore,
  ageInDays,
  type HeatSignal,
} from './heat'

const fresh = (type: string): HeatSignal => ({ type, ageDays: 0 })

describe('signalWeight', () => {
  it('returns the configured weight per type', () => {
    expect(signalWeight('funding')).toBe(0.8)
    expect(signalWeight('hiring')).toBe(0.7)
    expect(signalWeight('launch')).toBe(0.6)
    expect(signalWeight('stack')).toBe(0.5)
    expect(signalWeight('other')).toBe(0.3)
  })

  it('falls back to "other" for unknown types', () => {
    expect(signalWeight('mystery')).toBe(SIGNAL_WEIGHTS.other)
  })
})

describe('decay', () => {
  it('is 1 for a fresh signal', () => {
    expect(decay(0)).toBe(1)
  })

  it('halves every half-life', () => {
    expect(decay(HALF_LIFE_DAYS)).toBeCloseTo(0.5, 10)
    expect(decay(2 * HALF_LIFE_DAYS)).toBeCloseTo(0.25, 10)
  })

  it('clamps negative (future-dated) ages to fresh', () => {
    expect(decay(-5)).toBe(1)
  })

  it('throws on a non-positive half-life', () => {
    expect(() => decay(10, 0)).toThrow()
  })
})

describe('intentScore', () => {
  it('is 0 with no signals', () => {
    expect(intentScore([])).toBe(0)
  })

  it('equals w·d for a single fresh signal', () => {
    expect(intentScore([fresh('funding')])).toBeCloseTo(0.8, 10)
    expect(intentScore([fresh('other')])).toBeCloseTo(0.3, 10)
  })

  it('decays as a single signal ages', () => {
    const atHalfLife = intentScore([{ type: 'funding', ageDays: HALF_LIFE_DAYS }])
    expect(atHalfLife).toBeCloseTo(0.4, 10) // 0.8 * 0.5
    const older = intentScore([{ type: 'funding', ageDays: 2 * HALF_LIFE_DAYS }])
    expect(older).toBeCloseTo(0.2, 10) // 0.8 * 0.25
    expect(older).toBeLessThan(atHalfLife)
  })

  it('stays within [0, 1)', () => {
    const many = Array.from({ length: 20 }, () => fresh('funding'))
    const score = intentScore(many)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('stacks two signals higher than one, but with diminishing returns', () => {
    const one = intentScore([fresh('funding')]) // 0.8
    const two = intentScore([fresh('funding'), fresh('funding')]) // 1 - 0.2^2 = 0.96
    expect(two).toBeCloseTo(0.96, 10)
    expect(two).toBeGreaterThan(one)
    const firstContribution = one - 0
    const secondContribution = two - one
    expect(secondContribution).toBeLessThan(firstContribution)
  })

  it('is order-independent', () => {
    const a = intentScore([fresh('funding'), { type: 'hiring', ageDays: 10 }])
    const b = intentScore([{ type: 'hiring', ageDays: 10 }, fresh('funding')])
    expect(a).toBeCloseTo(b, 12)
  })
})

describe('heatScore', () => {
  it('with no signals is just the fit floor (0.35 × fit)', () => {
    expect(heatScore(80, [])).toBe(28) // round(80 * 0.35)
    expect(heatScore(100, [])).toBe(35)
  })

  it('rises with one fresh strong signal', () => {
    // round(80 * (0.35 + 0.65 * 0.8)) = round(80 * 0.87) = round(69.6)
    expect(heatScore(80, [fresh('funding')])).toBe(70)
  })

  it('falls as that same signal ages', () => {
    const freshHeat = heatScore(80, [fresh('funding')])
    const agedHeat = heatScore(80, [{ type: 'funding', ageDays: HALF_LIFE_DAYS }])
    // round(80 * (0.35 + 0.65 * 0.4)) = round(80 * 0.61) = round(48.8) = 49
    expect(agedHeat).toBe(49)
    expect(agedHeat).toBeLessThan(freshHeat)
  })

  it('two signals score higher than one', () => {
    const one = heatScore(80, [fresh('funding')])
    const two = heatScore(80, [fresh('funding'), fresh('hiring')])
    expect(two).toBeGreaterThan(one)
  })

  describe('boundaries', () => {
    it('fit 0 is always heat 0', () => {
      expect(heatScore(0, [])).toBe(0)
      expect(heatScore(0, [fresh('funding'), fresh('hiring')])).toBe(0)
    })

    it('clamps fit above 100', () => {
      expect(heatScore(150, [])).toBe(heatScore(100, []))
    })

    it('clamps fit below 0', () => {
      expect(heatScore(-20, [fresh('funding')])).toBe(0)
    })

    it('never exceeds fit (intent → 1 is the ceiling)', () => {
      const strong = Array.from({ length: 50 }, () => fresh('funding'))
      const heat = heatScore(100, strong)
      expect(heat).toBeLessThanOrEqual(100)
      expect(heat).toBeGreaterThan(95) // intent ≈ 1 → heat ≈ fit
    })

    it('heat with max intent approaches fit, heat with no intent is 0.35×fit', () => {
      const floor = heatScore(100, [])
      const ceil = heatScore(100, Array.from({ length: 50 }, () => fresh('funding')))
      expect(floor).toBe(35)
      expect(ceil).toBeGreaterThan(floor)
    })
  })
})

describe('ageInDays', () => {
  it('computes whole-day ages from ISO dates', () => {
    const now = Date.parse('2026-10-02T00:00:00Z')
    expect(ageInDays('2026-10-01T00:00:00Z', now)).toBeCloseTo(1, 6)
    expect(ageInDays('2026-09-11T00:00:00Z', now)).toBeCloseTo(21, 6)
  })

  it('clamps future dates to 0 and tolerates garbage', () => {
    const now = Date.parse('2026-10-02T00:00:00Z')
    expect(ageInDays('2026-12-01T00:00:00Z', now)).toBe(0)
    expect(ageInDays('not-a-date', now)).toBe(0)
  })
})
