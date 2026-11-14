import { describe, expect, it } from 'vitest'
import { latitudeRadiusM, latLonToXY } from './projection'

const PROJ = '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs'
const R = 1737400

describe('projection', () => {
  it('biegun to (0, 0)', () => {
    const [x, y] = latLonToXY(PROJ, R, -90, 0)
    expect(Math.abs(x)).toBeLessThan(1e-6)
    expect(Math.abs(y)).toBeLessThan(1e-6)
  })

  it('84°S: promień 2R·tan(3°), bez przesunięcia elipsoidy', () => {
    expect(latitudeRadiusM(PROJ, R, -84)).toBeCloseTo(2 * R * Math.tan((3 * Math.PI) / 180), 0)
  })

  it('kierunki: lon 0 → +y, lon 90E → +x (zgodnie z x_m, y_m w danych)', () => {
    const [x0, y0] = latLonToXY(PROJ, R, -85, 0)
    expect(Math.abs(x0)).toBeLessThan(1e-6)
    expect(y0).toBeGreaterThan(0)
    const [x90, y90] = latLonToXY(PROJ, R, -85, 90)
    expect(x90).toBeGreaterThan(0)
    expect(Math.abs(y90)).toBeLessThan(1e-6)
  })
})
