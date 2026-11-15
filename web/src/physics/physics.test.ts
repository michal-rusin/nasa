// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { azEl, dot, enuBasis, type Vec3 } from './enu'
import { MASK_SAMPLES, maskHeightDeg } from './mask'
import { DEFAULT_SUN_RADIUS_DEG, earthVisible, sunFraction } from './visibility'
import { longestCommGapH, longestNightH, sunPct } from './aggregates'

describe('ENU', () => {
  it('pole (lat -90, lon 0) without NaN', () => {
    const b = enuBasis(-90, 0)
    for (const v of [b.U, b.E, b.N]) for (const c of v) expect(Number.isNaN(c)).toBe(false)
    expect(b.U[2]).toBeCloseTo(-1, 12)
  })

  it('az = 0° along N, 90° along E; elevation 90° along U', () => {
    const b = enuBasis(-87.3, 141.2)
    expect(azEl(b.N, b).azDeg).toBeCloseTo(0, 9)
    expect(azEl(b.E, b).azDeg).toBeCloseTo(90, 9)
    const west: Vec3 = [-b.E[0], -b.E[1], -b.E[2]]
    expect(azEl(west, b).azDeg).toBeCloseTo(270, 9)
    expect(azEl(b.U, b).elDeg).toBeCloseTo(90, 9)
  })

  it('U, E, N are orthonormal', () => {
    for (const [lat, lon] of [[-90, 0], [-85, -179.9], [-89.7, 37], [0, 0]] as const) {
      const { U, E, N } = enuBasis(lat, lon)
      expect(dot(U, U)).toBeCloseTo(1, 12)
      expect(dot(E, E)).toBeCloseTo(1, 12)
      expect(dot(N, N)).toBeCloseTo(1, 12)
      expect(dot(U, E)).toBeCloseTo(0, 12)
      expect(dot(U, N)).toBeCloseTo(0, 12)
      expect(dot(E, N)).toBeCloseTo(0, 12)
    }
  })
})

describe('maskHeightDeg', () => {
  const mask = new Int16Array(MASK_SAMPLES)
  mask[0] = 200     // 2.00°
  mask[1] = 300     // 3.00°
  mask[10] = -250   // -2.50°
  mask[11] = -150
  mask[719] = 100   // 1.00°

  it('wraps 359.9° → 0°', () => {
    // position 719.8: 0.2·1.00 + 0.8·2.00
    expect(maskHeightDeg(mask, 359.9)).toBeCloseTo(1.8, 9)
    expect(maskHeightDeg(mask, 360)).toBeCloseTo(2, 9)
    expect(maskHeightDeg(mask, -0.5)).toBeCloseTo(1, 9)
  })

  it('interpolates halfway between samples', () => {
    expect(maskHeightDeg(mask, 0.25)).toBeCloseTo(2.5, 9)
  })

  it('supports negative values', () => {
    expect(maskHeightDeg(mask, 5)).toBeCloseTo(-2.5, 9)
    expect(maskHeightDeg(mask, 5.25)).toBeCloseTo(-2.0, 9)
  })
})

describe('sunFraction and earthVisible', () => {
  const r = DEFAULT_SUN_RADIUS_DEG
  it('d = -1 → 0, d = 1 → 1, d = 0 → 0.5', () => {
    expect(sunFraction(-r, 0)).toBe(0)
    expect(sunFraction(r, 0)).toBe(1)
    expect(sunFraction(1.3, 1.3)).toBeCloseTo(0.5, 12)
    expect(sunFraction(-5, 0)).toBe(0)
    expect(sunFraction(5, 0)).toBe(1)
  })

  it('earthVisible: strictly above the mask', () => {
    expect(earthVisible(1.0001, 1)).toBe(1)
    expect(earthVisible(1, 1)).toBe(0)
  })
})

describe('aggregates', () => {
  it('runs do not wrap at the period boundary', () => {
    const f = new Float32Array([0, 0, 1, 1, 0.005, 0, 0])
    expect(longestNightH(f, 3600)).toBe(3)       // not 4 (end + start)
    const g = new Uint8Array([0, 1, 0, 0, 1, 0])
    expect(longestCommGapH(g, 1800)).toBe(1)     // 2 steps × 0.5 h
    expect(sunPct([1, 0, 0.5, 0.5])).toBe(50)
  })
})
