import { describe, expect, it } from 'vitest'
import { isBetter } from './compare'

describe('isBetter', () => {
  it('więcej = lepiej dla nasłonecznienia, mniej = lepiej dla nachylenia i nocy', () => {
    expect(isBetter('sun_pct', 70, 50)).toBe(true)
    expect(isBetter('sun_pct', 50, 70)).toBe(false)
    expect(isBetter('slope_deg', 2, 5)).toBe(true)
    expect(isBetter('longest_night_h', 300, 200)).toBe(false)
  })

  it('remis, NaN i brak wartości nie dają zwycięzcy', () => {
    expect(isBetter('sun_pct', 50, 50)).toBe(false)
    expect(isBetter('sun_pct', NaN, 50)).toBe(false)
    expect(isBetter('dist_psr_km', 1, NaN)).toBe(false)
    expect(isBetter('sun_pct', undefined, 10)).toBe(false)
  })
})
