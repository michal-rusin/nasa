import { METRIC_KEYS, type Candidates, type MetricKey } from '../data/types'

export interface Bound {
  min?: number
  max?: number
}
export type Filters = Partial<Record<MetricKey, Bound>>

/** 1 = point passes all active filters. NaN fails active filters. */
export function passMask(candidates: Candidates, filters: Filters): Uint8Array {
  const n = candidates.n
  const mask = new Uint8Array(n).fill(1)
  for (const k of METRIC_KEYS) {
    const f = filters[k]
    if (!f) continue
    const hasMin = f.min !== undefined
    const hasMax = f.max !== undefined
    if (!hasMin && !hasMax) continue
    const min = f.min ?? -Infinity
    const max = f.max ?? Infinity
    const col = candidates.col[k]
    for (let i = 0; i < n; i++) {
      if (mask[i] === 0) continue
      const v = col[i]!
      // NaN: both comparisons are false → rejected.
      if (!(v >= min && v <= max)) mask[i] = 0
    }
  }
  return mask
}

export function countPass(mask: Uint8Array): number {
  let c = 0
  for (let i = 0; i < mask.length; i++) c += mask[i]!
  return c
}
