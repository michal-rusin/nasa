import type { MetricKey } from '../data/types'

export function fmtNum(v: number): string {
  if (Number.isNaN(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  return Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)
}

/** Liczba do wyświetlenia; brak/NaN/±∞ → `na` (np. „n/a”), nigdy „NaN”. */
export function fmtVal(v: number | undefined | null, digits: number, na: string): string {
  return v === undefined || v === null || !Number.isFinite(v) ? na : v.toFixed(digits)
}

/** Liczba cyfr po przecinku sensowna dla jednostki metryki. */
export const METRIC_DIGITS: Record<MetricKey, number> = {
  sun_pct: 1, earth_pct: 1, longest_night_h: 0, longest_comm_gap_h: 0, slope_deg: 1, dist_psr_km: 2,
  power_track_wm2: 0, power_fixed_wm2: 0,
}
