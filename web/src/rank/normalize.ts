import { METRIC_KEYS, type Candidates, type MetricKey } from '../data/types'
import { METRIC_META, type Direction } from './metrics'

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
 * Normalizacja percentylowa (rankowa) metryki do 0..1: n_i = średni rank / (N - 1),
 * rank liczony po posortowanych wartościach liczbowych, remisy dostają średni rank.
 * Dla 'low' odwrócona (1 - n_i), żeby zawsze 1 = najlepiej. NaN → 0 (najgorzej).
 * Jedna wartość liczbowa (N = 1) → 1.
 */
export function normalizeMetric(values: ArrayLike<number>, direction: Direction): Float32Array {
  const n = values.length
  const out = new Float32Array(n) // NaN zostają 0
  let m = 0
  for (let i = 0; i < n; i++) if (!Number.isNaN(values[i]!)) m++
  if (m === 0) return out
  const idx = new Int32Array(m)
  m = 0
  for (let i = 0; i < n; i++) if (!Number.isNaN(values[i]!)) idx[m++] = i
  if (m === 1) { out[idx[0]!] = 1; return out }
  idx.sort((a, b) => values[a]! - values[b]!)
  const denom = m - 1
  for (let start = 0; start < m;) {
    const v = values[idx[start]!]!
    let end = start + 1
    while (end < m && values[idx[end]!]! === v) end++
    let t = (start + end - 1) / 2 / denom // średni rank grupy remisów
    if (direction === 'low') t = 1 - t
    for (let k = start; k < end; k++) out[idx[k]!] = t
    start = end
  }
  return out
}

export type Norms = Record<MetricKey, Float32Array>

export function normalizeAll(c: Candidates): Norms {
  const out = {} as Norms
  for (const k of METRIC_KEYS) out[k] = normalizeMetric(c.col[k], METRIC_META[k].direction)
  return out
}
