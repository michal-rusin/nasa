// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { computeRange, normalize, RAMP_STOPS, rampRgb, rgbCss, valueToColor } from './colors'

describe('colors', () => {
  const LAST = RAMP_STOPS[RAMP_STOPS.length - 1]!

  it('scale endpoints and midpoint are control points', () => {
    expect(rampRgb(0)).toEqual(RAMP_STOPS[0])
    expect(rampRgb(0.5)).toEqual(RAMP_STOPS[(RAMP_STOPS.length - 1) / 2])
    expect(rampRgb(1)).toEqual(LAST)
  })

  it('worst = red, best = green, hue transitions smoothly through yellow', () => {
    const [r0, g0] = rampRgb(0)
    const [r1, g1] = rampRgb(1)
    expect(r0).toBeGreaterThan(g0 * 2)
    expect(g1).toBeGreaterThan(r1 * 2)
    // red decreases relative to green monotonically (no hue jumps)
    let prev = Infinity
    for (let i = 0; i <= 50; i++) {
      const [r, g] = rampRgb(i / 50)
      const ratio = r / Math.max(1, g)
      expect(ratio).toBeLessThanOrEqual(prev + 1e-9)
      prev = ratio
    }
  })

  it('valueToColor maps min/max to scale endpoints and clamps', () => {
    expect(valueToColor(10, 10, 20)).toBe(rgbCss(RAMP_STOPS[0]!))
    expect(valueToColor(20, 10, 20)).toBe(rgbCss(LAST))
    expect(valueToColor(99, 10, 20)).toBe(rgbCss(LAST))
    expect(valueToColor(-5, 10, 20)).toBe(rgbCss(RAMP_STOPS[0]!))
  })

  it('NaN yields the missing-data color; zero range avoids division by zero', () => {
    expect(valueToColor(NaN, 0, 1)).toBe('rgb(128, 128, 128)')
    expect(normalize(5, 5, 5)).toBe(0)
  })

  it('computeRange ignores NaN', () => {
    expect(computeRange(new Float32Array([3, NaN, -1, 7]))).toEqual({ min: -1, max: 7 })
    expect(computeRange([NaN])).toEqual({ min: 0, max: 0 })
  })
})
