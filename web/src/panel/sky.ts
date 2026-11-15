// Sky geometry from a lunar location: Sun, Earth (size, phase), stars.
// Pure functions without DOM. Input: the same ephemerides and mask as the rest of the app (physics/).

import {
  azimuthDeg, dot, elevationDeg, enuBasis, EPHEM_COLS, observerRadiusKm,
  type EnuBasis, type PhysicsParams,
} from '../physics'

const DEG = Math.PI / 180
export const EARTH_RADIUS_KM = 6371
const OBLIQUITY = 23.4393 * DEG

/** Angular difference wrapped to [−180, 180). */
export function wrapDeg(d: number): number {
  return ((((d + 540) % 360) + 360) % 360) - 180
}

/** Julian date at step k (t0 + k·stepS). */
export function julianDate(t0Utc: string, stepS: number, k: number): number {
  return (Date.parse(t0Utc) + k * stepS * 1000) / 86400000 + 2440587.5
}

/** Solar ecliptic longitude [deg], low-precision approximation (~0.01°). */
export function sunEclipticLonDeg(jd: number): number {
  const n = jd - 2451545.0
  const L = 280.46 + 0.9856474 * n
  const g = (357.528 + 0.9856003 * n) * DEG
  return (((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360) + 360) % 360
}

// --- Star catalog ---------------------------------------------------------

export interface StarCatalog {
  n: number
  /** Unit vectors in the ecliptic frame (x, y, z per star). */
  ecl: Float32Array
  mag: Float32Array
  bv: Float32Array
}

export const EMPTY_STARS: StarCatalog = {
  n: 0, ecl: new Float32Array(0), mag: new Float32Array(0), bv: new Float32Array(0),
}

/** RA/Dec (degrees, J2000) → unit ecliptic vector. */
export function equatorialToEcliptic(raDeg: number, decDeg: number): [number, number, number] {
  const ra = raDeg * DEG
  const dec = decDeg * DEG
  const x = Math.cos(dec) * Math.cos(ra)
  const y = Math.cos(dec) * Math.sin(ra)
  const z = Math.sin(dec)
  return [x, y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY), -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)]
}

/** public/assets/stars.json: { d: [ra, dec, mag, bv, ...] } (degrees, J2000). */
export function parseStarCatalog(json: unknown): StarCatalog {
  const d = typeof json === 'object' && json !== null ? (json as { d?: unknown }).d : undefined
  if (!Array.isArray(d) || d.length % 4 !== 0) throw new Error('stars.json: expected array d with length 4·n')
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
 * Rotate stars from the ecliptic frame to MOON_ME around Z by Δ, so the direction
 * of the ecliptic Sun matches its MOON_ME longitude (from ephemerides). The lunar axis
 * is treated as the ecliptic pole (1.5° difference), giving star orientations a 1–2° error.
 */
export function starFrameDeltaDeg(sunLonMeDeg: number, sunEclLonDeg: number): number {
  return wrapDeg(sunLonMeDeg - sunEclLonDeg)
}

/** Unit direction of star i in the local ENU basis after rotation by Δ (cd = cosΔ, sd = sinΔ). */
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

// --- Sun and Earth --------------------------------------------------------

export interface SkyPoint {
  latDeg: number
  lonDeg: number
  elevM: number
}

export interface SkyState {
  sunAz: number
  sunEl: number
  /** Unit solar direction in ENU (E, N, U). */
  sunEnu: [number, number, number]
  earthAz: number
  earthEl: number
  earthDiamDeg: number
  earthDistKm: number
  /** Earth phase angle: 0° = full, 90° = quarter, 180° = new. */
  earthPhaseDeg: number
  /** Screen angle (rad, 0 = right, clockwise) from Earth center toward the bright limb. */
  earthLimbRad: number
  /** Star rotation (see starFrameDeltaDeg). */
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

  // Observer → Earth vector: v = e − r·U; orthonormal ENU basis means P·E = P·N = 0.
  const vE = dot(e, E), vN = dot(e, N), vU = dot(e, U) - r
  const vNorm = Math.hypot(vE, vN, vU) || 1
  const dE = vE / vNorm, dN = vN / vNorm, dU = vU / vNorm
  const earthAz = azimuthDeg(vE, vN)
  const earthEl = elevationDeg(vU, vNorm)

  // Phase: Sun–Earth–observer angle (parallel rays assumed from the Sun).
  const cosPhase = Math.min(1, Math.max(-1, -(sE * dE + sN * dN + sU * dU)))
  const earthPhaseDeg = Math.acos(cosPhase) / DEG

  // Bright limb direction: solar direction projected onto the sky plane at Earth.
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

/** Illuminated Earth disk fraction, 0..1. */
export function earthLitFraction(phaseDeg: number): number {
  return (1 + Math.cos(phaseDeg * DEG)) / 2
}
