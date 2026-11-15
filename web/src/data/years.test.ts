import { describe, expect, it } from 'vitest'
import { longestRunOverlapping } from '../panel/timelineMath'
import type { Candidates } from './types'
import {
  candidatesForYear, candidatesRange, isEternalShadow, parseMetricsByYear, yearHours, yearOfStep, yearRange,
  yearStartStep, YEAR_COLUMNS,
} from './years'

const T0 = '2028-01-01T00:00:00Z'
const META = { t0_utc: T0, step_s: 3600, n_steps: 87672 }

describe('lata na osi czasu', () => {
  it('początki lat jak w kontrakcie 1.4 (2029 → 8784, 2030 → 17544)', () => {
    expect(yearStartStep(T0, 3600, 2028)).toBe(0)
    expect(yearStartStep(T0, 3600, 2029)).toBe(8784)
    expect(yearStartStep(T0, 3600, 2030)).toBe(17544)
    expect(yearRange(META, 2037)).toEqual({ start: 87672 - 8760, len: 8760 })
    expect(yearRange(META, 2038).len).toBe(0)
    expect(yearOfStep(T0, 3600, 8783)).toBe(2028)
    expect(yearOfStep(T0, 3600, 8784)).toBe(2029)
    expect(yearHours(2028)).toBe(8784)
    expect(yearHours(2029)).toBe(8760)
  })

  it('walidacja tylko na krokach candidates_period, nie na całym ephem.bin', () => {
    expect(candidatesRange({ ...META, candidates_period: '2028' })).toEqual({ start: 0, len: 8784 })
    expect(candidatesRange(META)).toEqual({ start: 0, len: 87672 })
  })
})

describe('metrics_by_year.bin', () => {
  // 2 punkty × 3 lata × 4 kolumny; wartość = punkt·100 + rok·10 + kolumna.
  const years = [2028, 2029, 2030]
  const columns = ['earth_pct', 'sun_pct', 'longest_comm_gap_h', 'longest_night_h']
  const buf = new ArrayBuffer(2 * 3 * 4 * 4)
  const dv = new DataView(buf)
  for (let p = 0; p < 2; p++) for (let y = 0; y < 3; y++) for (let c = 0; c < 4; c++) {
    dv.setFloat32(((p * 3 + y) * 4 + c) * 4, p * 100 + y * 10 + c, true)
  }
  const meta = {
    candidates: { count: 2, columns: [] },
    metrics_by_year: { file: 'metrics_by_year.bin', years, columns, dtype: 'float32', layout: '[n_points, n_years, n_columns]' },
  }

  it('kolumny z meta, nie z założonej kolejności; little-endian', () => {
    const m = parseMetricsByYear(buf, meta)
    expect(m.years).toEqual(years)
    expect(m.cols.sun_pct[1]![0]).toBe(11)
    expect(m.cols.longest_night_h[2]![1]).toBe(123)
    expect(() => parseMetricsByYear(buf.slice(4), meta)).toThrow(/rozmiar/)
  })

  it('podmienia tylko metryki roczne, reszta kolumn zostaje', () => {
    const m = parseMetricsByYear(buf, meta)
    const base = { n: 2, col: { slope_deg: Float32Array.from([5, 6]), sun_pct: Float32Array.from([1, 2]) } } as unknown as Candidates
    const c = candidatesForYear(base, m, 2030)
    for (const k of YEAR_COLUMNS) expect(c.col[k]).toBe(m.cols[k][2])
    expect(c.col.slope_deg).toBe(base.col.slope_deg)
    expect(candidatesForYear(base, m, 1999)).toBe(base)
    expect(candidatesForYear(base, null, 2030)).toBe(base)
  })
})

describe('wieczny cień i noce na przełomie lat', () => {
  it('zero słońca albo noc przez cały rok', () => {
    expect(isEternalShadow(0, 100, 8784)).toBe(true)
    expect(isEternalShadow(0.4, 8784, 8784)).toBe(true)
    expect(isEternalShadow(0.4, 8000, 8784)).toBe(false)
    expect(isEternalShadow(undefined, undefined, 8760)).toBe(false)
  })

  it('ciąg zaczęty przed oknem liczy się w całości', () => {
    //            0 1 2 3 4 5 6 7 8 9
    const night = [1, 1, 1, 1, 0, 1, 0, 1, 1, 0]
    const p = (i: number) => night[i] === 1
    expect(longestRunOverlapping(10, p, 2, 7)).toEqual({ start: 0, len: 4 })
    expect(longestRunOverlapping(10, p, 4, 7)).toEqual({ start: 5, len: 1 })
    expect(longestRunOverlapping(10, p, 4, 8)).toEqual({ start: 7, len: 2 })
    expect(longestRunOverlapping(10, p, 9, 10)).toEqual({ start: 0, len: 0 })
  })
})
