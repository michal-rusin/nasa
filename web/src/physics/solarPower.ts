// Solar irradiance incident on a panel (W/m², before cell efficiency), computed from time series
// for one point: P(t) = S0 · (1 AU / r)² · f(t) · max(0, n̂·ŝ).
// Near the pole the Sun is only a few degrees above the horizon, so we consider vertical panels:
//   - tracking the Sun (vertical axis): n̂·ŝ = cos(el),
//   - fixed, facing azimuth A: n̂·ŝ = cos(el) · max(0, cos(az − A)), A optimized for the point.
// A horizontal panel (sin el) yields ~2–7% of tracking-panel power near the pole, so it is omitted.

/** Solar constant (TSI) at 1 AU, W/m². No atmospheric correction on the Moon. */
export const SOLAR_CONSTANT_WM2 = 1361

const DEG = Math.PI / 180
const DAY_MS = 86_400_000
/** Earth orbital eccentricity and mean perihelion date (~January 3). */
const ECC = 0.0167
const YEAR_D = 365.256
/** Azimuth bins for finding the best fixed-panel orientation (every 5°). */
const AZ_BINS = 72

/**
 * (1 AU / r)² at time t: Earth–Sun distance from a first-order approximation
 * of the Keplerian orbit (±3.3% annually). The Moon is ±0.0026 AU from Earth; this is ignored (±0.5%).
 */
export function distanceFactor(tMs: number): number {
  const d = (tMs - Date.UTC(2000, 0, 3)) / DAY_MS
  const r = 1 - ECC * Math.cos((2 * Math.PI * d) / YEAR_D)
  return 1 / (r * r)
}

export interface SolarPower {
  /** Mean power of a vertical Sun-tracking panel, W/m². */
  trackingWm2: number
  /** Mean power of an optimally oriented fixed vertical panel, W/m². */
  fixedWm2: number
  /** Azimuth faced by the fixed panel (0 = N, 90 = E). */
  fixedAzDeg: number
}

interface Input {
  f: ArrayLike<number>
  sunEl: ArrayLike<number>
  sunAz: ArrayLike<number>
}

/** Averages over steps [start, start + len); t0Ms and stepS provide the Sun-distance correction. */
export function solarPower(s: Input, start: number, len: number, t0Ms: number, stepS: number): SolarPower {
  const hist = new Float64Array(AZ_BINS)
  let track = 0
  for (let k = start; k < start + len; k++) {
    const f = s.f[k]!
    if (!(f > 0)) continue
    const w = SOLAR_CONSTANT_WM2 * distanceFactor(t0Ms + k * stepS * 1000) * f * Math.cos(s.sunEl[k]! * DEG)
    track += w
    const az = ((s.sunAz[k]! % 360) + 360) % 360
    hist[Math.floor(az / (360 / AZ_BINS)) % AZ_BINS]! += w
  }
  // E(A) = Σ w · max(0, cos(az − A)) over azimuth bins (bin centers), A in 5° increments.
  let best = 0
  let bestAz = 0
  for (let a = 0; a < AZ_BINS; a++) {
    const A = (a + 0.5) * (360 / AZ_BINS)
    let e = 0
    for (let b = 0; b < AZ_BINS; b++) {
      const c = Math.cos(((b + 0.5) * (360 / AZ_BINS) - A) * DEG)
      if (c > 0) e += hist[b]! * c
    }
    if (e > best) { best = e; bestAz = A }
  }
  const n = Math.max(1, len)
  return { trackingWm2: track / n, fixedWm2: best / n, fixedAzDeg: bestAz }
}
