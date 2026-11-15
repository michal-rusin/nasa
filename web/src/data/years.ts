// Lata w danych (kontrakt 1.4 i 3.4): ephem.bin obejmuje kilka lat, candidates.bin i
// validation.json tylko `candidates_period`, metrics_by_year.bin ma metryki osobno dla każdego roku.

import type { Candidates, Meta } from './types'

/** Kolumny metrics_by_year.bin, które front umie podmienić w candidates (pierwsze 4 obowiązkowe). */
export const YEAR_COLUMNS = [
  'sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h',
  'power_track_wm2', 'power_fixed_wm2', 'power_fixed_az_deg',
] as const
export type YearColumn = (typeof YEAR_COLUMNS)[number]
const REQUIRED_YEAR_COLUMNS: readonly YearColumn[] = ['sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h']

export interface MetricsByYear {
  years: number[]
  /** cols[kolumna][rok] = wartości dla wszystkich punktów (kolejność wierszy jak w candidates.bin). Brak kolumny w pliku = brak klucza. */
  cols: Partial<Record<YearColumn, Float32Array[]>>
}

/** Fragment osi czasu: kroki [start, start + len). */
export interface StepRange {
  start: number
  len: number
}

type TimeMeta = Pick<Meta, 't0_utc' | 'step_s' | 'n_steps'>

/** Krok, od którego zaczyna się 1 stycznia roku `year` (może wypaść poza oś). */
export function yearStartStep(t0Utc: string, stepS: number, year: number): number {
  return Math.round((Date.UTC(year, 0, 1) - Date.parse(t0Utc)) / (stepS * 1000))
}

/** Kroki roku `year`, przycięte do osi [0, n_steps). Pusty zakres, gdy rok jest poza osią. */
export function yearRange(meta: TimeMeta, year: number): StepRange {
  const a = Math.max(0, yearStartStep(meta.t0_utc, meta.step_s, year))
  const b = Math.min(meta.n_steps, yearStartStep(meta.t0_utc, meta.step_s, year + 1))
  return { start: Math.min(a, meta.n_steps), len: Math.max(0, b - a) }
}

/** Rok, w którym leży krok k (UTC). */
export function yearOfStep(t0Utc: string, stepS: number, k: number): number {
  return new Date(Date.parse(t0Utc) + k * stepS * 1000).getUTCFullYear()
}

/** Długość roku kalendarzowego w godzinach (8760 albo 8784). */
export function yearHours(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000
}

/**
 * Kroki, których dotyczą candidates.bin i validation.json. Kontrakt 1.4: `candidates_period`
 * (np. "2028"); bez niego (starsze dane) cały plik efemeryd.
 */
export function candidatesRange(meta: TimeMeta & Pick<Meta, 'candidates_period'>): StepRange {
  const y = Number(meta.candidates_period)
  if (meta.candidates_period !== undefined && Number.isInteger(y)) {
    const r = yearRange(meta, y)
    if (r.len > 0) return r
  }
  return { start: 0, len: meta.n_steps }
}

/** Rozpakowuje metrics_by_year.bin: float32 LE, układ [n_points, n_years, n_columns]. */
export function parseMetricsByYear(buf: ArrayBuffer, meta: Pick<Meta, 'candidates' | 'metrics_by_year'>): MetricsByYear {
  const spec = meta.metrics_by_year
  if (!spec) throw new Error('meta.json: brak metrics_by_year')
  const n = meta.candidates.count
  const ny = spec.years.length
  const nc = spec.columns.length
  const expected = n * ny * nc * 4
  if (buf.byteLength !== expected) {
    throw new Error(`${spec.file}: rozmiar ${buf.byteLength} B, oczekiwano ${expected} B `
      + `(${n} punktów × ${ny} lat × ${nc} kolumn × 4 B)`)
  }
  const missing = REQUIRED_YEAR_COLUMNS.filter((c) => !spec.columns.includes(c))
  if (missing.length > 0) throw new Error(`${spec.file}: brakuje kolumn ${missing.join(', ')}`)
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

/** Kandydaci z metrykami wybranego roku (reszta kolumn bez zmian). Rok spoza pliku = bez zmian. */
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
 * Wieczny cień w danym roku: zero słońca albo noc trwająca cały rok
 * (punkt łapie odrobinę światła, ale nigdy nie wychodzi z nocy).
 */
export function isEternalShadow(sunPct: number | undefined, nightH: number | undefined, yearH: number): boolean {
  if (sunPct === 0) return true
  return nightH !== undefined && Number.isFinite(nightH) && nightH >= yearH
}
