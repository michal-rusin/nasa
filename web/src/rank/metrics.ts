import type { MetricKey } from '../data/types'

export type Direction = 'high' | 'low'

export interface MetricMeta {
  label: string
  unit: string
  /** 'high': higher is better, 'low': lower is better. */
  direction: Direction
}

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  sun_pct: { label: 'Sunlight', unit: '%', direction: 'high' },
  earth_pct: { label: 'Earth visibility', unit: '%', direction: 'high' },
  longest_night_h: { label: 'Longest night', unit: 'h', direction: 'low' },
  longest_comm_gap_h: { label: 'Longest communication gap', unit: 'h', direction: 'low' },
  slope_deg: { label: 'Slope', unit: '°', direction: 'low' },
  dist_psr_km: { label: 'Distance to PSR', unit: 'km', direction: 'low' },
  power_track_wm2: { label: 'Power, tracking panel', unit: 'W/m²', direction: 'high' },
  power_fixed_wm2: { label: 'Power, fixed panel', unit: 'W/m²', direction: 'high' },
}

export type Weights = Record<MetricKey, number>

export const DEFAULT_WEIGHTS: Weights = {
  sun_pct: 3,
  earth_pct: 2,
  longest_night_h: 2,
  longest_comm_gap_h: 1,
  slope_deg: 2,
  dist_psr_km: 1,
  // Power is effectively sun_pct in W/m²; excluded from the default combined score to avoid counting sunlight twice.
  power_track_wm2: 0,
  power_fixed_wm2: 0,
}
