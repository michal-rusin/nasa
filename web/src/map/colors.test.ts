import { describe, expect, it } from 'vitest'
import { computeRange, normalize, RAMP_STOPS, rampRgb, rgbCss, valueToColor } from './colors'

describe('colors', () => {
  const LAST = RAMP_STOPS[RAMP_STOPS.length - 1]!

  it('końce i środek skali to punkty kontrolne', () => {
    expect(rampRgb(0)).toEqual(RAMP_STOPS[0])
    expect(rampRgb(0.5)).toEqual(RAMP_STOPS[(RAMP_STOPS.length - 1) / 2])
    expect(rampRgb(1)).toEqual(LAST)
  })

  it('najgorzej = czerwony, najlepiej = zielony, odcień przechodzi płynnie przez żółć', () => {
    const [r0, g0] = rampRgb(0)
    const [r1, g1] = rampRgb(1)
    expect(r0).toBeGreaterThan(g0 * 2)
    expect(g1).toBeGreaterThan(r1 * 2)
    // czerwień maleje względem zieleni monotonicznie (bez skoków odcienia)
    let prev = Infinity
    for (let i = 0; i <= 50; i++) {
      const [r, g] = rampRgb(i / 50)
      const ratio = r / Math.max(1, g)
      expect(ratio).toBeLessThanOrEqual(prev + 1e-9)
      prev = ratio
    }
  })

  it('valueToColor mapuje min/max na końce skali i przycina', () => {
    expect(valueToColor(10, 10, 20)).toBe(rgbCss(RAMP_STOPS[0]!))
    expect(valueToColor(20, 10, 20)).toBe(rgbCss(LAST))
    expect(valueToColor(99, 10, 20)).toBe(rgbCss(LAST))
    expect(valueToColor(-5, 10, 20)).toBe(rgbCss(RAMP_STOPS[0]!))
  })

  it('NaN daje kolor braku danych, zakres zerowy nie dzieli przez zero', () => {
    expect(valueToColor(NaN, 0, 1)).toBe('rgb(128, 128, 128)')
    expect(normalize(5, 5, 5)).toBe(0)
  })

  it('computeRange pomija NaN', () => {
    expect(computeRange(new Float32Array([3, NaN, -1, 7]))).toEqual({ min: -1, max: 7 })
    expect(computeRange([NaN])).toEqual({ min: 0, max: 0 })
  })
})
