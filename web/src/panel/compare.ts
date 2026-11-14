import type { MetricKey } from '../data/types'
import { METRIC_META } from '../rank/metrics'

/** Czy wartość `a` jest ściśle lepsza od `b` dla metryki (kierunek z METRIC_META). Brak danych = nie. */
export function isBetter(k: MetricKey, a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return false
  return METRIC_META[k].direction === 'high' ? a > b : a < b
}
