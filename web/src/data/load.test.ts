import { describe, expect, it } from 'vitest'
import { buildIdToIndex, getProjString, parseCandidates, parseSites } from './load'
import { COLUMN_NAMES } from './types'

/** Bufor float32 LE z wierszy (każdy wiersz w kolejności `columns`). */
function makeBuf(rows: number[][]): ArrayBuffer {
  const nc = rows[0]?.length ?? 0
  const buf = new ArrayBuffer(rows.length * nc * 4)
  const dv = new DataView(buf)
  rows.forEach((row, r) => row.forEach((v, c) => dv.setFloat32((r * nc + c) * 4, v, true)))
  return buf
}

/** Wiersz, w którym wartość kolumny = id*100 + pozycja kolumny w COLUMN_NAMES. */
function rowFor(id: number, columns: readonly string[]): number[] {
  return columns.map((c) => (c === 'id' ? id : id * 100 + (COLUMN_NAMES as readonly string[]).indexOf(c)))
}

describe('parseCandidates', () => {
  const columns = [...COLUMN_NAMES]

  it('rozpakowuje wiersze do kolumn', () => {
    const ids = [7, 3, 11]
    const c = parseCandidates(makeBuf(ids.map((id) => rowFor(id, columns))),
      { candidates: { count: 3, columns } })
    expect(c.n).toBe(3)
    expect(Array.from(c.col.id)).toEqual(ids)
    expect(c.col.sun_pct[1]).toBe(3 * 100 + COLUMN_NAMES.indexOf('sun_pct'))
    expect(c.col.dist_psr_km[2]).toBe(11 * 100 + COLUMN_NAMES.indexOf('dist_psr_km'))
  })

  it('id nie musi równać się indeksowi: mapa id → indeks', () => {
    const c = parseCandidates(makeBuf([rowFor(7, columns), rowFor(3, columns)]),
      { candidates: { count: 2, columns } })
    const m = buildIdToIndex(c)
    expect(m.get(7)).toBe(0)
    expect(m.get(3)).toBe(1)
  })

  it('zły rozmiar pliku rzuca błąd', () => {
    const buf = makeBuf([rowFor(1, columns)])
    expect(() => parseCandidates(buf, { candidates: { count: 2, columns } })).toThrow(/rozmiar/)
  })

  it('brakująca kolumna rzuca błąd', () => {
    const cols = columns.filter((c) => c !== 'earth_pct')
    const buf = makeBuf([rowFor(1, cols)])
    expect(() => parseCandidates(buf, { candidates: { count: 1, columns: cols } })).toThrow(/earth_pct/)
  })

  it('respektuje zmienioną kolejność kolumn w meta', () => {
    const cols = [...columns].reverse()
    const c = parseCandidates(makeBuf([rowFor(5, cols)]), { candidates: { count: 1, columns: cols } })
    expect(c.col.id[0]).toBe(5)
    expect(c.col.lat[0]).toBe(5 * 100 + COLUMN_NAMES.indexOf('lat'))
    expect(c.col.slope_deg[0]).toBe(5 * 100 + COLUMN_NAMES.indexOf('slope_deg'))
  })
})

describe('getProjString', () => {
  const proj = '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m'

  it('bierze raster_proj4', () => {
    expect(getProjString({ raster_proj4: proj, raster_crs_wkt: 'PROJCS["x"]' })).toBe(proj)
  })

  it('bez raster_proj4 bierze raster_crs_wkt, jeśli to ciąg PROJ', () => {
    expect(getProjString({ raster_crs_wkt: proj })).toBe(proj)
  })

  it('bez raster_proj4 i z WKT rzuca błąd', () => {
    expect(() => getProjString({ raster_crs_wkt: 'PROJCS["x"]' })).toThrow('brak raster_proj4 w meta.json')
  })
})

describe('parseSites', () => {
  it('brak pola traktuje jak null', () => {
    const [s] = parseSites([{ id: 'a', name: 'A', category: 'apollo', lat: -20, lon: 30 }])
    expect(s?.x_m).toBeNull()
    expect(s?.y_m).toBeNull()
    expect(s?.nearest_candidate_id).toBeNull()
    expect(s?.nearest_candidate_dist_km).toBeNull()
  })
})
