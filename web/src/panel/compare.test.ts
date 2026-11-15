// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { isBetter } from './compare'

describe('isBetter', () => {
  it('higher is better for sunlight, lower is better for slope and night', () => {
    expect(isBetter('sun_pct', 70, 50)).toBe(true)
    expect(isBetter('sun_pct', 50, 70)).toBe(false)
    expect(isBetter('slope_deg', 2, 5)).toBe(true)
    expect(isBetter('longest_night_h', 300, 200)).toBe(false)
  })

  it('ties, NaN, and missing values produce no winner', () => {
    expect(isBetter('sun_pct', 50, 50)).toBe(false)
    expect(isBetter('sun_pct', NaN, 50)).toBe(false)
    expect(isBetter('dist_psr_km', 1, NaN)).toBe(false)
    expect(isBetter('sun_pct', undefined, 10)).toBe(false)
  })
})
