// Geometria nieba widzianego z punktu na Księżycu: Słońce, Ziemia (rozmiar, faza), gwiazdy.
// Czyste funkcje, bez DOM. Wejście: te same efemerydy i maska co reszta aplikacji (physics/).

import {
  azimuthDeg, dot, elevationDeg, enuBasis, EPHEM_COLS, observerRadiusKm,
  type EnuBasis, type PhysicsParams,
} from '../physics'

const DEG = Math.PI / 180
export const EARTH_RADIUS_KM = 6371
const OBLIQUITY = 23.4393 * DEG

/** Różnica kątów zawinięta do [−180, 180). */
export function wrapDeg(d: number): number {
  return ((((d + 540) % 360) + 360) % 360) - 180
}

/** Data juliańska kroku k (t0 + k·stepS). */
export function julianDate(t0Utc: string, stepS: number, k: number): number {
  return (Date.parse(t0Utc) + k * stepS * 1000) / 86400000 + 2440587.5
}

/** Długość ekliptyczna Słońca [deg], przybliżenie niskiej precyzji (~0.01°). */
export function sunEclipticLonDeg(jd: number): number {
  const n = jd - 2451545.0
  const L = 280.46 + 0.9856474 * n
  const g = (357.528 + 0.9856003 * n) * DEG
  return (((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) + 360) % 360
}

// --- Katalog gwiazd ---------------------------------------------------------

export interface StarCatalog {
  n: number
  /** Jednostkowe wektory w układzie ekliptycznym (x, y, z na gwiazdę). */
  ecl: Float32Array
  mag: Float32Array
  bv: Float32Array
}

export const EMPTY_STARS: StarCatalog = {
  n: 0, ecl: new Float32Array(0), mag: new Float32Array(0), bv: new Float32Array(0),
}

/** RA/Dec (stopnie, J2000) → jednostkowy wektor ekliptyczny. */
export function equatorialToEcliptic(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  const x = Math.cos(dec) * Math.cos(ra)
  const y = Math.cos(dec) * Math.sin(ra)
  const z = Math.sin(dec)
  return [x, y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY), -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)]
}

/** public/assets/stars.json: { d: [ra, dec, mag, bv, ...] } (stopnie, J2000). */
export function parseStarCatalog(json: unknown): StarCatalog {
  const d = typeof json === 'object' && json !== null ? (json as { d?: unknown }).d : undefined
  if (!Array.isArray(d) || d.length % 4 !== 0) throw new Error('stars.json: oczekiwano tablicy d o długości 4·n')
  const n = d.length / 4
  const ecl = new Float32Array(n * 3)
  const mag = new Float32Array(n)
  const bv = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const ra = Number(d[4 * i]), dec = Number(d[4 * i + 1])
    const m = Number(d[4 * i + 2]), c = Number(d[4 * i + 3])
    if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
      mag[i] = 99
      continue
    }
    const v = equatorialToEcliptic(ra, dec)
    ecl[3 * i] = v[0]
    ecl[3 * i + 1] = v[1]
    ecl[3 * i + 2] = v[2]
    mag[i] = Number.isFinite(m) ? m : 99
    bv[i] = Number.isFinite(c) ? c : 0.6
  }
  return { n, ecl, mag, bv }
}

/**
 * Obrót gwiazd z układu ekliptycznego do MOON_ME: wokół osi Z o kąt Δ, taki że kierunek
 * Słońca w ekliptyce trafia na długość Słońca w MOON_ME (z efemeryd). Oś obrotu Księżyca
 * traktujemy jak biegun ekliptyki (różnica 1,5°), więc orientacja gwiazd ma błąd rzędu 1–2°.
 */
export function starFrameDeltaDeg(sunLonMeDeg: number, sunEclLonDeg: number): number {
  return wrapDeg(sunLonMeDeg - sunEclLonDeg)
}

/** Kierunek gwiazdy i w bazie ENU punktu (jednostkowy), po obrocie o Δ (cd = cosΔ, sd = sinΔ). */
export function starEnu(
  cat: StarCatalog, i: number, cd: number, sd: number, basis: EnuBasis, out: [number, number, number],
): void {
  const x = cat.ecl[3 * i]!, y = cat.ecl[3 * i + 1]!, z = cat.ecl[3 * i + 2]!
  const mx = x * cd - y * sd
  const my = x * sd + y * cd
  const { E, N, U } = basis
  out[0] = mx * E[0] + my * E[1] + z * E[2]
  out[1] = mx * N[0] + my * N[1] + z * N[2]
  out[2] = mx * U[0] + my * U[1] + z * U[2]
}

// --- Słońce i Ziemia --------------------------------------------------------

export interface SkyPoint {
  latDeg: number
  lonDeg: number
  elevM: number
}

export interface SkyState {
  sunAz: number
  sunEl: number
  /** Jednostkowy kierunek Słońca w ENU (E, N, U). */
  sunEnu: [number, number, number]
  earthAz: number
  earthEl: number
  earthDiamDeg: number
  earthDistKm: number
  /** Kąt fazy Ziemi: 0° = pełnia, 90° = kwadra, 180° = nów. */
  earthPhaseDeg: number
  /** Kąt na ekranie (rad, 0 = w prawo, zgodnie z ruchem wskazówek) od środka Ziemi ku jasnemu limbowi. */
  earthLimbRad: number
  /** Obrót gwiazd (patrz starFrameDeltaDeg). */
  starDeltaDeg: number
}

export function skyState(
  point: SkyPoint,
  ephem: Float32Array,
  k: number,
  params: PhysicsParams,
  t0Utc: string,
  stepS: number,
  basis: EnuBasis = enuBasis(point.latDeg, point.lonDeg),
): SkyState {
  const o = k * EPHEM_COLS
  const s: [number, number, number] = [ephem[o]!, ephem[o + 1]!, ephem[o + 2]!]
  const e: [number, number, number] = [ephem[o + 3]!, ephem[o + 4]!, ephem[o + 5]!]
  const { E, N, U } = basis
  const r = observerRadiusKm(params.moonRadiusKm, point.elevM, params.observerHeightM)

  const sNorm = Math.hypot(s[0], s[1], s[2]) || 1
  const sE = dot(s, E) / sNorm, sN = dot(s, N) / sNorm, sU = dot(s, U) / sNorm
  const sunAz = azimuthDeg(sE, sN)
  const sunEl = elevationDeg(sU, 1)

  // Wektor obserwator → Ziemia: v = e − r·U; baza ENU jest ortonormalna, więc P·E = P·N = 0.
  const vE = dot(e, E), vN = dot(e, N), vU = dot(e, U) - r
  const vNorm = Math.hypot(vE, vN, vU) || 1
  const dE = vE / vNorm, dN = vN / vNorm, dU = vU / vNorm
  const earthAz = azimuthDeg(vE, vN)
  const earthEl = elevationDeg(vU, vNorm)

  // Faza: kąt Słońce–Ziemia–obserwator (Słońce traktujemy jak źródło równoległe).
  const cosPhase = Math.min(1, Math.max(-1, -(sE * dE + sN * dN + sU * dU)))
  const earthPhaseDeg = Math.acos(cosPhase) / DEG

  // Kierunek jasnego limbu: rzut kierunku Słońca na płaszczyznę nieba w miejscu Ziemi.
  const sd = sE * dE + sN * dN + sU * dU
  const pE = sE - sd * dE, pN = sN - sd * dN, pU = sU - sd * dU
  const az = earthAz * DEG, el = earthEl * DEG
  const rx = pE * Math.cos(az) - pN * Math.sin(az)
  const ry = pE * (-Math.sin(el) * Math.sin(az)) + pN * (-Math.sin(el) * Math.cos(az)) + pU * Math.cos(el)
  const earthLimbRad = Math.hypot(rx, ry) < 1e-9 ? 0 : Math.atan2(-ry, rx)

  const jd = julianDate(t0Utc, stepS, k)
  const starDeltaDeg = starFrameDeltaDeg(Math.atan2(s[1], s[0]) / DEG, sunEclipticLonDeg(jd))

  return {
    sunAz, sunEl, sunEnu: [sE, sN, sU],
    earthAz, earthEl,
    earthDiamDeg: (2 * Math.atan(EARTH_RADIUS_KM / vNorm)) / DEG,
    earthDistKm: vNorm,
    earthPhaseDeg, earthLimbRad, starDeltaDeg,
  }
}

/** Oświetlona część tarczy Ziemi, 0..1. */
export function earthLitFraction(phaseDeg: number): number {
  return (1 + Math.cos(phaseDeg * DEG)) / 2
}
