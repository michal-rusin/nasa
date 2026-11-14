import { METRIC_KEYS, type Candidates, type MetricKey } from '../data/types'
import { METRIC_META, type Direction } from './metrics'

export const P_LO = 0.02
export const P_HI = 0.98

/** Percentyl p w [0, 1] z posortowanej rosnąco tablicy (interpolacja liniowa). Pusta → NaN. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  const pos = Math.min(1, Math.max(0, p)) * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(n - 1, lo + 1)
  const a = sorted[lo]!
  const b = sorted[hi]!
  return a + (b - a) * (pos - lo)
}

/**
 * Normalizacja metryki do 0..1 między p2 a p98 (z przycięciem).
 * Dla 'low' odwrócona, żeby zawsze 1 = najlepiej. NaN → 0 (najgorzej).
 * Zakres zerowy (p2 == p98) → 1 dla wszystkich wartości liczbowych.
 */
export function normalizeMetric(values: ArrayLike<number>, direction: Direction): Float32Array {
  const n = values.length
  const finite: number[] = []
  for (let i = 0; i < n; i++) {
    const v = values[i]!
    if (!Number.isNaN(v)) finite.push(v)
  }
  const sorted = Float64Array.from(finite).sort()
  const lo = percentile(sorted, P_LO)
  const hi = percentile(sorted, P_HI)
  const span = hi - lo
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = values[i]!
    if (Number.isNaN(v)) { out[i] = 0; continue }
    let t = span > 0 ? Math.min(1, Math.max(0, (v - lo) / span)) : 1
    if (direction === 'low' && span > 0) t = 1 - t
    out[i] = t
  }
  return out
}

export type Norms = Record<MetricKey, Float32Array>

export function normalizeAll(c: Candidates): Norms {
  const out = {} as Norms
  for (const k of METRIC_KEYS) out[k] = normalizeMetric(c.col[k], METRIC_META[k].direction)
  return out
}
