// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { buildIdToIndex, getProjString, parseCandidates, parseSites } from './load'
import { COLUMN_NAMES } from './types'

/** Float32 LE buffer from rows (each row ordered by `columns`). */
function makeBuf(rows: number[][]): ArrayBuffer {
  const nc = rows[0]?.length ?? 0
  const buf = new ArrayBuffer(rows.length * nc * 4)
  const dv = new DataView(buf)
  rows.forEach((row, r) => row.forEach((v, c) => dv.setFloat32((r * nc + c) * 4, v, true)))
  return buf
}

/** Row with each column value = id*100 + the column position in COLUMN_NAMES. */
function rowFor(id: number, columns: readonly string[]): number[] {
  return columns.map((c) => (c === 'id' ? id : id * 100 + (COLUMN_NAMES as readonly string[]).indexOf(c)))
}

describe('parseCandidates', () => {
  const columns = [...COLUMN_NAMES]

  it('unpacks rows into columns', () => {
    const ids = [7, 3, 11]
    const c = parseCandidates(makeBuf(ids.map((id) => rowFor(id, columns))),
      { candidates: { count: 3, columns } })
    expect(c.n).toBe(3)
    expect(Array.from(c.col.id)).toEqual(ids)
    expect(c.col.sun_pct[1]).toBe(3 * 100 + COLUMN_NAMES.indexOf('sun_pct'))
    expect(c.col.dist_psr_km[2]).toBe(11 * 100 + COLUMN_NAMES.indexOf('dist_psr_km'))
  })

  it('IDs need not equal indices: ID → index map', () => {
    const c = parseCandidates(makeBuf([rowFor(7, columns), rowFor(3, columns)]),
      { candidates: { count: 2, columns } })
    const m = buildIdToIndex(c)
    expect(m.get(7)).toBe(0)
    expect(m.get(3)).toBe(1)
  })

  it('throws for incorrect file size', () => {
    const buf = makeBuf([rowFor(1, columns)])
    expect(() => parseCandidates(buf, { candidates: { count: 2, columns } })).toThrow(/size/)
  })

  it('throws for a missing column', () => {
    const cols = columns.filter((c) => c !== 'earth_pct')
    const buf = makeBuf([rowFor(1, cols)])
    expect(() => parseCandidates(buf, { candidates: { count: 1, columns: cols } })).toThrow(/earth_pct/)
  })

  it('respects reordered metadata columns', () => {
    const cols = [...columns].reverse()
    const c = parseCandidates(makeBuf([rowFor(5, cols)]), { candidates: { count: 1, columns: cols } })
    expect(c.col.id[0]).toBe(5)
    expect(c.col.lat[0]).toBe(5 * 100 + COLUMN_NAMES.indexOf('lat'))
    expect(c.col.slope_deg[0]).toBe(5 * 100 + COLUMN_NAMES.indexOf('slope_deg'))
  })
})

describe('getProjString', () => {
  const proj = '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m'

  it('uses raster_proj4', () => {
    expect(getProjString({ raster_proj4: proj, raster_crs_wkt: 'PROJCS["x"]' })).toBe(proj)
  })

  it('uses raster_crs_wkt containing PROJ syntax when raster_proj4 is absent', () => {
    expect(getProjString({ raster_crs_wkt: proj })).toBe(proj)
  })

  it('throws for WKT without raster_proj4', () => {
    expect(() => getProjString({ raster_crs_wkt: 'PROJCS["x"]' })).toThrow('missing raster_proj4 in meta.json')
  })
})

describe('parseSites', () => {
  it('treats missing fields as null', () => {
    const [s] = parseSites([{ id: 'a', name: 'A', category: 'apollo', lat: -20, lon: 30 }])
    expect(s?.x_m).toBeNull()
    expect(s?.y_m).toBeNull()
    expect(s?.nearest_candidate_id).toBeNull()
    expect(s?.nearest_candidate_dist_km).toBeNull()
  })
})
