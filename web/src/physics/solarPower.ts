// Moc promieniowania słonecznego padającego na panel (W/m², przed sprawnością ogniw) z szeregów
// jednego punktu: P(t) = S0 · (1 AU / r)² · f(t) · max(0, n̂·ŝ).
// Przy biegunie Słońce stoi kilka stopni nad horyzontem, więc liczą się panele pionowe:
//   - obracany za Słońcem (oś pionowa): n̂·ŝ = cos(el),
//   - nieruchomy, zwrócony na azymut A: n̂·ŝ = cos(el) · max(0, cos(az − A)), A najlepsze dla punktu.
// Panel poziomy (sin el) daje przy biegunie ~2–7% mocy obracanego, więc go nie liczymy.

/** Stała słoneczna (TSI) w 1 AU, W/m². Na Księżycu bez poprawki na atmosferę. */
export const SOLAR_CONSTANT_WM2 = 1361

const DEG = Math.PI / 180
const DAY_MS = 86_400_000
/** Mimośród orbity Ziemi i średnia data peryhelium (~3 stycznia). */
const ECC = 0.0167
const YEAR_D = 365.256
/** Binów azymutu przy szukaniu najlepszego kierunku nieruchomego panelu (co 5°). */
const AZ_BINS = 72

/**
 * (1 AU / r)² dla chwili t: odległość Ziemia–Słońce z orbity Keplera w przybliżeniu pierwszego
 * rzędu (±3,3% w ciągu roku). Księżyc jest o ±0,0026 AU od Ziemi, to pomijamy (±0,5%).
 */
export function distanceFactor(tMs: number): number {
  const d = (tMs - Date.UTC(2000, 0, 3)) / DAY_MS
  const r = 1 - ECC * Math.cos((2 * Math.PI * d) / YEAR_D)
  return 1 / (r * r)
}

export interface SolarPower {
  /** Średnia moc panelu pionowego obracanego za Słońcem, W/m². */
  trackingWm2: number
  /** Średnia moc najlepiej ustawionego nieruchomego panelu pionowego, W/m². */
  fixedWm2: number
  /** Azymut, na który patrzy ten nieruchomy panel (0 = N, 90 = E). */
  fixedAzDeg: number
}

interface Input {
  f: ArrayLike<number>
  sunEl: ArrayLike<number>
  sunAz: ArrayLike<number>
}

/** Średnie po krokach [start, start + len); t0Ms i stepS do poprawki na odległość od Słońca. */
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
  // E(A) = Σ w · max(0, cos(az − A)) po binach azymutu (środki binów), A co 5°.
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
