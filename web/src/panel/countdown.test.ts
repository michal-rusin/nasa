// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { earthTransition, nextTransition, splitHours, sunTransition } from './countdown'
import { stepToUtc } from './timelineMath'

describe('countdown', () => {
  it('steps until state change', () => {
    const on = [1, 1, 1, 0, 0, 1]
    expect(nextTransition(on.length, 0, (k) => on[k] === 1)).toEqual({ on: true, steps: 3 })
    expect(nextTransition(on.length, 3, (k) => on[k] === 1)).toEqual({ on: false, steps: 2 })
    expect(nextTransition(on.length, 5, (k) => on[k] === 1)).toEqual({ on: true, steps: null })
  })

  it('clamps out-of-range cursor and handles empty series', () => {
    const on = [0, 1]
    expect(nextTransition(2, -5, (k) => on[k] === 1)).toEqual({ on: false, steps: 1 })
    expect(nextTransition(2, 99, (k) => on[k] === 1)).toEqual({ on: true, steps: null })
    expect(nextTransition(0, 0, () => true)).toEqual({ on: false, steps: null })
  })

  it('Sun: night threshold matches longest_night_h; a partial disk can still mean daytime', () => {
    const f = new Float32Array([1, 0.5, 0.02, 0.005, 0, 0.3])
    expect(sunTransition(f, 0, 0.01)).toEqual({ on: true, steps: 3 })
    expect(sunTransition(f, 3, 0.01)).toEqual({ on: false, steps: 2 })
  })

  it('Earth: g = 1 means visible', () => {
    const g = new Uint8Array([1, 1, 0, 1])
    expect(earthTransition(g, 0)).toEqual({ on: true, steps: 2 })
    expect(earthTransition(g, 2)).toEqual({ on: false, steps: 1 })
  })

  it('splitHours', () => {
    expect(splitHours(0)).toEqual({ d: 0, h: 0 })
    expect(splitHours(49)).toEqual({ d: 2, h: 1 })
    expect(splitHours(23.6)).toEqual({ d: 1, h: 0 })
  })

  it('stepToUtc: hourly step from t0, with and without time', () => {
    expect(stepToUtc('2028-01-01T00:00:00Z', 3600, 0)).toBe('2028-01-01 00:00')
    expect(stepToUtc('2028-01-01T00:00:00Z', 3600, 8783)).toBe('2028-12-31 23:00')
    expect(stepToUtc('2028-01-01T00:00:00Z', 3600, 8783, false)).toBe('2028-12-31')
    expect(stepToUtc('invalid', 3600, 5)).toBe('#5')
  })
})
