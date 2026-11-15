import { COLUMN_NAMES, type Candidates, type ColumnName, type Meta, type Site } from './types'

export const DATA_BASE = import.meta.env.BASE_URL + 'data/'

/** Data file URL relative to data/ (e.g. 'layers/basemap.png'). */
export function dataUrl(path: string): string {
  return DATA_BASE + path
}

export async function fetchOk(path: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(dataUrl(path))
  } catch (e) {
    throw new Error(`Failed to fetch ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (res.status === 404) throw new MissingDataFileError(path)
  if (!res.ok) throw new Error(`Failed to fetch ${path} (HTTP ${res.status})`)
  // Vite returns 200 + index.html for missing files (SPA fallback).
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new MissingDataFileError(path)
  return res
}

export class MissingDataFileError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`Missing data file public/data/${path} (run npm run sync-data)`)
    this.name = 'MissingDataFileError'
    this.path = path
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validate core meta.json fields; assume remaining fields follow the contract. */
export function parseMeta(json: unknown): Meta {
  if (!isRecord(json)) throw new Error('meta.json: expected a JSON object')
  if (json.contract_version !== 1) {
    throw new Error(`meta.json: unsupported contract version ${String(json.contract_version)} (frontend supports 1)`)
  }
  const cand = json.candidates
  if (!isRecord(cand) || typeof cand.count !== 'number' || !Array.isArray(cand.columns)
    || !cand.columns.every((c) => typeof c === 'string')) {
    throw new Error('meta.json: missing or invalid field candidates (count, columns)')
  }
  const layers = json.layers
  if (!isRecord(layers) || !isRecord(layers.bounds_m) || !isRecord(layers.files)) {
    throw new Error('meta.json: missing or invalid field layers (bounds_m, files)')
  }
  for (const k of ['min_x', 'min_y', 'max_x', 'max_y']) {
    if (typeof layers.bounds_m[k] !== 'number') throw new Error(`meta.json: missing layers.bounds_m.${k}`)
  }
  return json as unknown as Meta
}

/** Raster PROJ string: raster_proj4, falling back to raster_crs_wkt if it contains PROJ syntax. */
export function getProjString(meta: Pick<Meta, 'raster_proj4' | 'raster_crs_wkt'>): string {
  if (typeof meta.raster_proj4 === 'string' && meta.raster_proj4.trim() !== '') return meta.raster_proj4
  if (typeof meta.raster_crs_wkt === 'string' && meta.raster_crs_wkt.trim().startsWith('+proj')) {
    return meta.raster_crs_wkt.trim()
  }
  throw new Error('missing raster_proj4 in meta.json')
}

/**
 * Unpack candidates.bin (float32 LE, rows × columns) into column arrays.
 * Read column order exclusively from meta.candidates.columns.
 */
export function parseCandidates(buf: ArrayBuffer, meta: Pick<Meta, 'candidates'>): Candidates {
  const columns = meta.candidates.columns
  const n = meta.candidates.count
  const nc = columns.length
  const missing = COLUMN_NAMES.filter((c) => !columns.includes(c))
  if (missing.length > 0) {
    throw new Error(`candidates: missing columns in meta.candidates.columns: ${missing.join(', ')}`)
  }
  const expected = n * nc * 4
  if (buf.byteLength !== expected) {
    throw new Error(`candidates.bin: size ${buf.byteLength} B, expected ${expected} B `
      + `(${n} points × ${nc} columns × 4 B)`)
  }
  const dv = new DataView(buf)
  const col = {} as Record<ColumnName, Float32Array>
  for (const name of COLUMN_NAMES) {
    const c = columns.indexOf(name)
    const arr = new Float32Array(n)
    for (let r = 0; r < n; r++) arr[r] = dv.getFloat32((r * nc + c) * 4, true)
    col[name] = arr
  }
  return { n, col }
}

/** Map ID → row index (IDs need not equal indices). */
export function buildIdToIndex(c: Candidates): Map<number, number> {
  const m = new Map<number, number>()
  const ids = c.col.id
  for (let i = 0; i < c.n; i++) m.set(ids[i]!, i)
  return m
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Normalize sites.json: treat missing numeric fields as null. */
export function parseSites(json: unknown): Site[] {
  if (!Array.isArray(json)) throw new Error('sites.json: expected an array')
  return json.map((raw, i): Site => {
    if (!isRecord(raw)) throw new Error(`sites.json: item ${i} is not an object`)
    return {
      id: typeof raw.id === 'string' ? raw.id : String(i),
      name: typeof raw.name === 'string' ? raw.name : `location ${i}`,
      category: typeof raw.category === 'string' ? raw.category : 'reference',
      lat: numOrNull(raw.lat),
      lon: numOrNull(raw.lon),
      x_m: numOrNull(raw.x_m),
      y_m: numOrNull(raw.y_m),
      note: typeof raw.note === 'string' ? raw.note : '',
      nearest_candidate_id: numOrNull(raw.nearest_candidate_id),
      nearest_candidate_dist_km: numOrNull(raw.nearest_candidate_dist_km),
    }
  })
}

export async function loadMeta(): Promise<Meta> {
  const res = await fetchOk('meta.json')
  return parseMeta(await res.json())
}

export async function loadCandidates(meta: Meta): Promise<Candidates> {
  const res = await fetchOk('candidates.bin')
  return parseCandidates(await res.arrayBuffer(), meta)
}

/**
 * Check image existence (HEAD). Vite returns 200 + index.html for missing files,
 * so also check content-type. Treat network errors as missing layers and skip them.
 */
export async function probeImage(path: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl(path), { method: 'HEAD' })
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')
  } catch {
    return false
  }
}

/** The data team supplies sites.json separately; if missing, use an empty list and warn. */
export async function loadSites(): Promise<Site[]> {
  try {
    const res = await fetchOk('sites.json')
    return parseSites(await res.json())
  } catch (e) {
    if (e instanceof MissingDataFileError) {
      console.warn(`${e.message}; the location list will be empty.`)
      return []
    }
    throw e
  }
}
