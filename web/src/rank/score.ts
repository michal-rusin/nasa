import { METRIC_KEYS, type MetricKey } from '../data/types'

/** score[i] = Σ w_k · norm_k[i] / Σ w_k. Wagi ujemne traktujemy jak 0; suma 0 → same zera. */
export function computeScore(
  norms: Record<MetricKey, Float32Array>,
  weights: Partial<Record<MetricKey, number>>,
  n: number,
): Float32Array {
  const out = new Float32Array(n)
  let wsum = 0
  for (const k of METRIC_KEYS) wsum += Math.max(0, weights[k] ?? 0)
  if (!(wsum > 0)) return out
  const acc = new Float64Array(n)
  for (const k of METRIC_KEYS) {
    const w = Math.max(0, weights[k] ?? 0)
    if (w === 0) continue
    const col = norms[k]
    for (let i = 0; i < n; i++) acc[i]! += w * col[i]!
  }
  for (let i = 0; i < n; i++) out[i] = acc[i]! / wsum
  return out
}
