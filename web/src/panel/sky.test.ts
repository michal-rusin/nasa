import { describe, expect, it } from 'vitest'
import { enuBasis } from '../physics'
import {
  earthLitFraction, equatorialToEcliptic, julianDate, parseStarCatalog, skyState, starEnu,
  starFrameDeltaDeg, sunEclipticLonDeg, wrapDeg,
} from './sky'

const PARAMS = { moonRadiusKm: 1737.4, observerHeightM: 2, sunRadiusDeg: 0.2666 }
const T0 = '2028-01-01T00:00:00Z'

/** Jeden krok efemeryd: Słońce (kierunek), Ziemia (km, MOON_ME). */
function ephem(sun: [number, number, number], earth: [number, number, number]): Float32Array {
  return Float32Array.from([...sun, ...earth])
}

describe('czas i Słońce', () => {
  it('JD epoki J2000 i długość ekliptyczna Słońca', () => {
    expect(julianDate('2000-01-01T12:00:00Z', 3600, 0)).toBeCloseTo(2451545.0, 6)
    expect(julianDate('2000-01-01T12:00:00Z', 3600, 24)).toBeCloseTo(2451546.0, 6)
    expect(sunEclipticLonDeg(2451545.0)).toBeCloseTo(280.37, 1)
  })

  it('wrapDeg zawija do [−180, 180)', () => {
    expect(wrapDeg(190)).toBeCloseTo(-170)
    expect(wrapDeg(-190)).toBeCloseTo(170)
    expect(wrapDeg(0)).toBeCloseTo(0)
    expect(wrapDeg(720 + 10)).toBeCloseTo(10)
  })
})

describe('katalog gwiazd', () => {
  it('RA/Dec → ekliptyka', () => {
    const [x0, y0, z0] = equatorialToEcliptic(0, 0)
    expect([x0, y0, z0].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0])
    const eps = (23.4393 * Math.PI) / 180
    const [, y1, z1] = equatorialToEcliptic(90, 0)
    expect(y1).toBeCloseTo(Math.cos(eps), 6)
    expect(z1).toBeCloseTo(-Math.sin(eps), 6)
    const [, y2, z2] = equatorialToEcliptic(0, 90) // biegun niebieski
    expect(y2).toBeCloseTo(Math.sin(eps), 6)
    expect(z2).toBeCloseTo(Math.cos(eps), 6)
  })

  it('parseStarCatalog: długość, kolejność i błędny format', () => {
    const cat = parseStarCatalog({ d: [0, 0, 1.5, 0.2, 90, 0, 3, 1.1] })
    expect(cat.n).toBe(2)
    expect(cat.mag[1]).toBeCloseTo(3)
    expect(cat.bv[1]).toBeCloseTo(1.1)
    expect(() => parseStarCatalog({ d: [1, 2, 3] })).toThrow()
    expect(() => parseStarCatalog(null)).toThrow()
  })

  it('gwiazda w kierunku Słońca (ekliptyka) ląduje przy Słońcu w ENU', () => {
    // Słońce w MOON_ME: długość 40°, oś Z bez nachylenia; w ekliptyce Słońce na 100°.
    const delta = starFrameDeltaDeg(40, 100)
    expect(delta).toBeCloseTo(-60)
    const star = parseStarCatalog({ d: [0, 0, 1, 0.6] }) // (1,0,0) ekliptyczne, długość 0°
    const sunEclLon = 0 // gwiazda dokładnie na długości Słońca
    const d = starFrameDeltaDeg(40, sunEclLon) // Słońce w ME na 40° → gwiazda też
    const basis = enuBasis(0, 40) // obserwator pod Słońcem: kierunek Słońca = „do góry"
    const out: [number, number, number] = [0, 0, 0]
    starEnu(star, 0, Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180), basis, out)
    expect(out[2]).toBeCloseTo(1, 5)
  })
})

describe('skyState', () => {
  // Obserwator na równiku, lon 0: góra = +X, wschód = +Y, północ = +Z.
  const POINT = { latDeg: 0, lonDeg: 0, elevM: 0 }

  it('rozmiar kątowy Ziemi ≈ 1,9° z 384 400 km', () => {
    const st = skyState(POINT, ephem([0, 0, -1], [384400, 0, 0]), 0, PARAMS, T0, 3600)
    expect(st.earthDiamDeg).toBeCloseTo(1.91, 1)
    expect(st.earthEl).toBeCloseTo(90, 3) // Ziemia w zenicie
  })

  it('faza: pełnia, kwadra i nów', () => {
    const full = skyState(POINT, ephem([-1, 0, 0], [384400, 0, 0]), 0, PARAMS, T0, 3600)
    expect(full.earthPhaseDeg).toBeCloseTo(0, 3) // Słońce za plecami obserwatora
    const half = skyState(POINT, ephem([0, 1, 0], [384400, 0, 0]), 0, PARAMS, T0, 3600)
    expect(half.earthPhaseDeg).toBeCloseTo(90, 3)
    const none = skyState(POINT, ephem([1, 0, 0], [384400, 0, 0]), 0, PARAMS, T0, 3600)
    expect(none.earthPhaseDeg).toBeCloseTo(180, 3)
    expect(earthLitFraction(0)).toBeCloseTo(1)
    expect(earthLitFraction(90)).toBeCloseTo(0.5)
    expect(earthLitFraction(180)).toBeCloseTo(0)
  })

  it('jasny limb Ziemi wskazuje Słońce', () => {
    // Ziemia w zenicie, Słońce na wschodzie (+Y = E): jasny limb po prawej (azymut rośnie w prawo).
    const st = skyState(POINT, ephem([0, 1, 0], [384400, 0, 0]), 0, PARAMS, T0, 3600)
    expect(Math.cos(st.earthLimbRad)).toBeGreaterThan(0.99)
    // Słońce na północy (+Z = N): w zenicie „w górę ekranu" zależy od azymutu, ale limb ma moduł 1.
    const north = skyState(POINT, ephem([0, 0, 1], [384400, 0, 0]), 0, PARAMS, T0, 3600)
    expect(Math.hypot(Math.cos(north.earthLimbRad), Math.sin(north.earthLimbRad))).toBeCloseTo(1)
  })

  it('Słońce: azymut i elewacja', () => {
    const st = skyState(POINT, ephem([0, 1, 0], [384400, 0, 0]), 0, PARAMS, T0, 3600)
    expect(st.sunAz).toBeCloseTo(90, 3) // wschód
    expect(st.sunEl).toBeCloseTo(0, 3)
  })
})
