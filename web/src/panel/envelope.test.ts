import { describe, expect, it } from 'vitest'
import { azBin, sunEnvelope } from './envelope'
import { bucketMean, longestRunSpan, monthTicks } from './timelineMath'

describe('sunEnvelope', () => {
  it('min/max w przedziałach 5°, z zawinięciem azymutu', () => {
    const az = [359.9, 0.1, 360, -0.1, 2, 180]
    const el = [1.0, -0.5, 0.7, 1.4, 0.2, -1.2]
    const env = sunEnvelope(az, el, 5)
    expect(env.min.length).toBe(72)
    // 359.9 i -0.1 → ostatni przedział, 0.1, 360 i 2 → pierwszy.
    expect(env.min[71]).toBeCloseTo(1.0)
    expect(env.max[71]).toBeCloseTo(1.4)
    expect(env.min[0]).toBeCloseTo(-0.5)
    expect(env.max[0]).toBeCloseTo(0.7)
    expect(env.min[36]).toBeCloseTo(-1.2)
    expect(Number.isNaN(env.min[10]!)).toBe(true)
  })

  it('azBin', () => {
    expect(azBin(360, 5, 72)).toBe(0)
    expect(azBin(-0.1, 5, 72)).toBe(71)
    expect(azBin(725, 5, 72)).toBe(1)
  })
})

describe('oś czasu', () => {
  it('bucketMean agreguje, nie próbkuje', () => {
    const m = bucketMean([1, 0, 0, 0, 1, 1], 2)
    expect(m[0]).toBeCloseTo(1 / 3)
    expect(m[1]).toBeCloseTo(2 / 3)
    expect(Array.from(bucketMean([0, 1], 4))).toEqual([0, 0, 1, 1])
  })

  it('longestRunSpan: start i długość, bez zawijania', () => {
    const a = [1, 1, 0, 0, 0, 1, 0, 0, 1, 1]
    expect(longestRunSpan(a.length, (i) => a[i] === 0)).toEqual({ start: 2, len: 3 })
    expect(longestRunSpan(a.length, (i) => a[i] === 1)).toEqual({ start: 0, len: 2 })
    expect(longestRunSpan(3, () => false)).toEqual({ start: 0, len: 0 })
  })

  it('monthTicks z t0_utc', () => {
    const t = monthTicks('2028-01-01T00:00:00Z', 3600, 8784)
    expect(t.length).toBe(12)
    expect(t[0]).toEqual({ pos: 0, label: 'sty' })
    expect(t[1]!.pos).toBeCloseTo((31 * 24) / 8784)
  })
})
