// Years in the data (contract 1.4 and 3.4): ephem.bin spans multiple years; candidates.bin and
// validation.json cover only `candidates_period`; metrics_by_year.bin contains metrics for each year.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import type { Candidates, Meta } from './types'

/** metrics_by_year.bin columns supported as candidate overrides (the first four are required). */
export const YEAR_COLUMNS = [
  'sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h',
  'power_track_wm2', 'power_fixed_wm2', 'power_fixed_az_deg',
] as const
export type YearColumn = (typeof YEAR_COLUMNS)[number]
const REQUIRED_YEAR_COLUMNS: readonly YearColumn[] = ['sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h']

export interface MetricsByYear {
  years: number[]
  /** cols[column][year] = values for all points (same row order as candidates.bin). Missing columns have no key. */
  cols: Partial<Record<YearColumn, Float32Array[]>>
}

/** Timeline segment: steps [start, start + len). */
export interface StepRange {
  start: number
  len: number
}

type TimeMeta = Pick<Meta, 't0_utc' | 'step_s' | 'n_steps'>

/** Step at January 1 of `year` (may fall outside the timeline). */
export function yearStartStep(t0Utc: string, stepS: number, year: number): number {
  return Math.round((Date.UTC(year, 0, 1) - Date.parse(t0Utc)) / (stepS * 1000))
}

/** Steps in `year`, clipped to [0, n_steps). Empty if the year is outside the timeline. */
export function yearRange(meta: TimeMeta, year: number): StepRange {
  const a = Math.max(0, yearStartStep(meta.t0_utc, meta.step_s, year))
  const b = Math.min(meta.n_steps, yearStartStep(meta.t0_utc, meta.step_s, year + 1))
  return { start: Math.min(a, meta.n_steps), len: Math.max(0, b - a) }
}

/** Year containing step k (UTC). */
export function yearOfStep(t0Utc: string, stepS: number, k: number): number {
  return new Date(Date.parse(t0Utc) + k * stepS * 1000).getUTCFullYear()
}

/** Calendar year length in hours (8760 or 8784). */
export function yearHours(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000
}

/**
 * Steps covered by candidates.bin and validation.json. Contract 1.4: `candidates_period`
 * (e.g. "2028"); if absent in older data, use the full ephemeris file.
 */
export function candidatesRange(meta: TimeMeta & Pick<Meta, 'candidates_period'>): StepRange {
  const y = Number(meta.candidates_period)
  if (meta.candidates_period !== undefined && Number.isInteger(y)) {
    const r = yearRange(meta, y)
    if (r.len > 0) return r
  }
  return { start: 0, len: meta.n_steps }
}

/** Unpacks metrics_by_year.bin: float32 LE, layout [n_points, n_years, n_columns]. */
export function parseMetricsByYear(buf: ArrayBuffer, meta: Pick<Meta, 'candidates' | 'metrics_by_year'>): MetricsByYear {
  const spec = meta.metrics_by_year
  if (!spec) throw new Error('meta.json: missing metrics_by_year')
  const n = meta.candidates.count
  const ny = spec.years.length
  const nc = spec.columns.length
  const expected = n * ny * nc * 4
  if (buf.byteLength !== expected) {
    throw new Error(`${spec.file}: size ${buf.byteLength} B, expected ${expected} B `
      + `(${n} points × ${ny} years × ${nc} columns × 4 B)`)
  }
  const missing = REQUIRED_YEAR_COLUMNS.filter((c) => !spec.columns.includes(c))
  if (missing.length > 0) throw new Error(`${spec.file}: missing columns ${missing.join(', ')}`)
  const dv = new DataView(buf)
  const cols: Partial<Record<YearColumn, Float32Array[]>> = {}
  for (const name of YEAR_COLUMNS) {
    const c = spec.columns.indexOf(name)
    if (c < 0) continue
    cols[name] = spec.years.map((_, y) => {
      const arr = new Float32Array(n)
      for (let r = 0; r < n; r++) arr[r] = dv.getFloat32(((r * ny + y) * nc + c) * 4, true)
      return arr
    })
  }
  return { years: [...spec.years], cols }
}

/** Candidates with metrics for the selected year (other columns unchanged). Years outside the file leave data unchanged. */
export function candidatesForYear(base: Candidates, mby: MetricsByYear | null, year: number | null): Candidates {
  if (!mby || year === null) return base
  const y = mby.years.indexOf(year)
  if (y < 0) return base
  const col = { ...base.col }
  for (const k of YEAR_COLUMNS) {
    const v = mby.cols[k]?.[y]
    if (v) col[k] = v
  }
  return { n: base.n, col }
}

/**
 * Permanent shadow in a given year: no sunlight or a night lasting the entire year
 * (the point receives a little light but never exits nighttime conditions).
 */
export function isEternalShadow(sunPct: number | undefined, nightH: number | undefined, yearH: number): boolean {
  if (sunPct === 0) return true
  return nightH !== undefined && Number.isFinite(nightH) && nightH >= yearH
}
