// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { nearestPoint } from './nearestPoint'

describe('nearestPoint', () => {
  const cx = new Float32Array([0, 2000, 4000, NaN])
  const cy = new Float32Array([0, 0, 2000, 0])

  it('finds the nearest point within the radius', () => {
    expect(nearestPoint(1900, 100, cx, cy, 500)).toBe(1)
    expect(nearestPoint(3900, 1800, cx, cy, 500)).toBe(2)
  })

  it('returns −1 when no point is within the radius', () => {
    expect(nearestPoint(1000, 1000, cx, cy, 500)).toBe(-1)
  })

  it('skips NaN and handles empty data', () => {
    expect(nearestPoint(0, 0, [NaN], [0], 1e9)).toBe(-1)
    expect(nearestPoint(0, 0, [], [], 1e9)).toBe(-1)
  })

  it('mask excludes filtered points and Infinity radius searches without a limit', () => {
    const mask = new Uint8Array([1, 0, 1, 1])
    expect(nearestPoint(1900, 100, cx, cy, 500, mask)).toBe(-1)
    expect(nearestPoint(1900, 100, cx, cy, Infinity, mask)).toBe(0)
    expect(nearestPoint(1e6, 1e6, cx, cy, Infinity)).toBe(2)
  })
})
