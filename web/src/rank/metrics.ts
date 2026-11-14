import type { MetricKey } from '../data/types'

export type Direction = 'high' | 'low'

export interface MetricMeta {
  label: string
  unit: string
  /** 'high': więcej = lepiej, 'low': mniej = lepiej. */
  direction: Direction
}

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  sun_pct: { label: 'Nasłonecznienie', unit: '%', direction: 'high' },
  earth_pct: { label: 'Widoczność Ziemi', unit: '%', direction: 'high' },
  longest_night_h: { label: 'Najdłuższa noc', unit: 'h', direction: 'low' },
  longest_comm_gap_h: { label: 'Najdłuższa przerwa łączności', unit: 'h', direction: 'low' },
  slope_deg: { label: 'Nachylenie', unit: '°', direction: 'low' },
  dist_psr_km: { label: 'Odległość do PSR', unit: 'km', direction: 'low' },
}

export type Weights = Record<MetricKey, number>

export const DEFAULT_WEIGHTS: Weights = {
  sun_pct: 3,
  earth_pct: 2,
  longest_night_h: 2,
  longest_comm_gap_h: 1,
  slope_deg: 2,
  dist_psr_km: 1,
}
