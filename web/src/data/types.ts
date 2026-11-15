// Data types from docs/contracts.md (v1). Field names match the contract exactly.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

/** candidates.bin columns (contract 3.1). Read FILE order from metadata, not here. */
export const COLUMN_NAMES = [
  'id', 'lat', 'lon', 'x_m', 'y_m', 'elev_m', 'level',
  'sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h',
  'slope_deg', 'dist_psr_km',
] as const
export type ColumnName = (typeof COLUMN_NAMES)[number]

/**
 * Columns available only in metrics_by_year.bin (contract 3.4, Delivery 7): panel power.
 * They are NaN in candidates until replaced with the selected year.
 */
export const YEAR_ONLY_COLUMNS = ['power_track_wm2', 'power_fixed_wm2', 'power_fixed_az_deg'] as const
export type YearOnlyColumn = (typeof YEAR_ONLY_COLUMNS)[number]

/** Metrics available for coloring, filtering, and ranking points. */
export const METRIC_KEYS = [
  'sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h', 'slope_deg', 'dist_psr_km',
  'power_track_wm2', 'power_fixed_wm2',
] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export interface BoundsM {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

/** meta.json (contract 4). */
export interface Meta {
  contract_version: number
  generated_utc: string
  mock?: boolean
  moon_radius_km: number
  frame: string
  ephem_source: string
  abcorr: string
  t0_utc: string
  step_s: number
  n_steps: number
  sun_radius_deg: number
  night_threshold: number
  observer_height_m: number
  mask_min_dist_m: number
  slope_basis: string
  dem_near: string
  dem_far: string
  psr_source: string
  region: { lat_min: number; lat_max: number }
  candidates: { count: number; columns: string[] }
  /** Year covered by candidates.bin and validation.json (e.g. "2028"); contract 1.4. */
  candidates_period?: string
  /** metrics_by_year.bin (contract 3.4); absent in older data. */
  metrics_by_year?: {
    file: string
    years: number[]
    columns: string[]
    dtype: string
    layout: string
  }
  raster_crs_wkt: string
  /** Required by contract 1.3; older files may omit it (see getProjString). */
  raster_proj4?: string
  layers: {
    bounds_m: BoundsM
    files: { basemap: string; slope: string; illumination: string; psr: string }
  }
}

/** sites.json (contract 5.3). Missing numeric field = null. */
export interface Site {
  id: string
  name: string
  category: string
  lat: number | null
  lon: number | null
  x_m: number | null
  y_m: number | null
  note: string
  nearest_candidate_id: number | null
  nearest_candidate_dist_km: number | null
}

/** candidates.bin unpacked into column arrays (struct of arrays). */
export interface Candidates {
  n: number
  col: Record<ColumnName | YearOnlyColumn, Float32Array>
}
