import { describe, expect, it } from 'vitest'
import { distanceFactor, SOLAR_CONSTANT_WM2, solarPower } from './solarPower'

const T0 = Date.UTC(2028, 0, 1)

function series(n: number, el: (k: number) => number, az: (k: number) => number, f: (k: number) => number) {
  return {
    f: Float32Array.from({ length: n }, (_, k) => f(k)),
    sunEl: Float32Array.from({ length: n }, (_, k) => el(k)),
    sunAz: Float32Array.from({ length: n }, (_, k) => az(k)),
  }
}

describe('moc z paneli', () => {
  it('odległość od Słońca: styczeń (peryhelium) ~+3,4%, lipiec ~−3,3%', () => {
    expect(distanceFactor(Date.UTC(2028, 0, 3))).toBeCloseTo(1.034, 2)
    expect(distanceFactor(Date.UTC(2028, 6, 4))).toBeCloseTo(0.967, 2)
  })

  it('Słońce zawsze z jednego kierunku: nieruchomy panel = obracany, patrzy na Słońce', () => {
    const s = series(240, () => 2, () => 135, () => 1)
    const p = solarPower(s, 0, 240, T0, 3600)
    expect(p.fixedWm2 / p.trackingWm2).toBeGreaterThan(0.999)
    expect(Math.abs(p.fixedAzDeg - 135)).toBeLessThanOrEqual(2.5)
    expect(p.trackingWm2).toBeGreaterThan(SOLAR_CONSTANT_WM2)
  })

  it('Słońce obiega horyzont: nieruchomy panel dostaje ~1/π mocy obracanego', () => {
    const n = 720
    const s = series(n, () => 1, (k) => (k * 360) / n, () => 1)
    const p = solarPower(s, 0, n, T0, 3600)
    expect(p.fixedWm2 / p.trackingWm2).toBeCloseTo(1 / Math.PI, 2)
  })

  it('noc i częściowe zasłonięcie liczą się przez f; okno [start, start+len)', () => {
    const s = series(100, () => 0, () => 0, (k) => (k < 50 ? 0 : 0.5))
    const all = solarPower(s, 0, 100, T0, 3600)
    const day = solarPower(s, 50, 50, T0, 3600)
    expect(day.trackingWm2).toBeCloseTo(2 * all.trackingWm2, 6)
    expect(solarPower(s, 0, 50, T0, 3600).trackingWm2).toBe(0)
  })
})
