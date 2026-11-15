import { COLUMN_NAMES, type Candidates, type ColumnName, type Meta, type Site } from './types'
import { parseMetricsByYear, type MetricsByYear } from './years'

export const DATA_BASE = import.meta.env.BASE_URL + 'data/'

/** URL pliku danych względem katalogu data/ (np. 'layers/basemap.png'). */
export function dataUrl(path: string): string {
  return DATA_BASE + path
}

export async function fetchOk(path: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(dataUrl(path))
  } catch (e) {
    throw new Error(`Nie udało się pobrać ${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (res.status === 404) throw new MissingDataFileError(path)
  if (!res.ok) throw new Error(`Nie udało się pobrać ${path} (HTTP ${res.status})`)
  // Serwer dev Vite na brakujący plik odpowiada 200 + index.html (fallback SPA).
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new MissingDataFileError(path)
  return res
}

export class MissingDataFileError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`Brak pliku danych public/data/${path} (sprawdź npm run sync-data)`)
    this.name = 'MissingDataFileError'
    this.path = path
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Sprawdza kluczowe pola meta.json. Reszta jest przyjmowana zgodnie z kontraktem. */
export function parseMeta(json: unknown): Meta {
  if (!isRecord(json)) throw new Error('meta.json: oczekiwano obiektu JSON')
  if (json.contract_version !== 1) {
    throw new Error(`meta.json: nieobsługiwana wersja kontraktu ${String(json.contract_version)} (front obsługuje 1)`)
  }
  const cand = json.candidates
  if (!isRecord(cand) || typeof cand.count !== 'number' || !Array.isArray(cand.columns)
    || !cand.columns.every((c) => typeof c === 'string')) {
    throw new Error('meta.json: brak lub błędne pole candidates (count, columns)')
  }
  const layers = json.layers
  if (!isRecord(layers) || !isRecord(layers.bounds_m) || !isRecord(layers.files)) {
    throw new Error('meta.json: brak lub błędne pole layers (bounds_m, files)')
  }
  for (const k of ['min_x', 'min_y', 'max_x', 'max_y']) {
    if (typeof layers.bounds_m[k] !== 'number') throw new Error(`meta.json: brak layers.bounds_m.${k}`)
  }
  return json as unknown as Meta
}

/** Ciąg PROJ rastrów: raster_proj4, a awaryjnie raster_crs_wkt, jeśli to ciąg PROJ. */
export function getProjString(meta: Pick<Meta, 'raster_proj4' | 'raster_crs_wkt'>): string {
  if (typeof meta.raster_proj4 === 'string' && meta.raster_proj4.trim() !== '') return meta.raster_proj4
  if (typeof meta.raster_crs_wkt === 'string' && meta.raster_crs_wkt.trim().startsWith('+proj')) {
    return meta.raster_crs_wkt.trim()
  }
  throw new Error('brak raster_proj4 w meta.json')
}

/**
 * Rozpakowuje candidates.bin (float32 LE, wiersze × kolumny) do tablic na kolumnę.
 * Kolejność kolumn wyłącznie z meta.candidates.columns.
 */
export function parseCandidates(buf: ArrayBuffer, meta: Pick<Meta, 'candidates'>): Candidates {
  const columns = meta.candidates.columns
  const n = meta.candidates.count
  const nc = columns.length
  const missing = COLUMN_NAMES.filter((c) => !columns.includes(c))
  if (missing.length > 0) {
    throw new Error(`candidates: w meta.candidates.columns brakuje kolumn: ${missing.join(', ')}`)
  }
  const expected = n * nc * 4
  if (buf.byteLength !== expected) {
    throw new Error(`candidates.bin: rozmiar ${buf.byteLength} B, oczekiwano ${expected} B `
      + `(${n} punktów × ${nc} kolumn × 4 B)`)
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

/** Mapa id → indeks wiersza (id nie musi być równe indeksowi). */
export function buildIdToIndex(c: Candidates): Map<number, number> {
  const m = new Map<number, number>()
  const ids = c.col.id
  for (let i = 0; i < c.n; i++) m.set(ids[i]!, i)
  return m
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Normalizuje sites.json: brak pola liczbowego traktujemy jak null. */
export function parseSites(json: unknown): Site[] {
  if (!Array.isArray(json)) throw new Error('sites.json: oczekiwano tablicy')
  return json.map((raw, i): Site => {
    if (!isRecord(raw)) throw new Error(`sites.json: pozycja ${i} nie jest obiektem`)
    return {
      id: typeof raw.id === 'string' ? raw.id : String(i),
      name: typeof raw.name === 'string' ? raw.name : `miejsce ${i}`,
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

/** metrics_by_year.bin (kontrakt 3.4); starsze dane bez tego pliku = null (jeden rok). */
export async function loadMetricsByYear(meta: Meta): Promise<MetricsByYear | null> {
  const spec = meta.metrics_by_year
  if (!spec) return null
  try {
    const res = await fetchOk(spec.file)
    return parseMetricsByYear(await res.arrayBuffer(), meta)
  } catch (e) {
    if (e instanceof MissingDataFileError) {
      console.warn(`${e.message}; selektor roku będzie niedostępny.`)
      return null
    }
    throw e
  }
}

/**
 * Czy plik obrazu istnieje (HEAD). Serwer dev Vite na brakujący plik zwraca 200 + index.html,
 * więc sprawdzamy też content-type. Błąd sieci = brak (warstwę pomijamy bez błędu).
 */
export async function probeImage(path: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl(path), { method: 'HEAD' })
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')
  } catch {
    return false
  }
}

/** sites.json dostarcza zespół danych osobno; jego brak nie blokuje mapy (pusta lista + ostrzeżenie). */
export async function loadSites(): Promise<Site[]> {
  try {
    const res = await fetchOk('sites.json')
    return parseSites(await res.json())
  } catch (e) {
    if (e instanceof MissingDataFileError) {
      console.warn(`${e.message}; lista miejsc będzie pusta.`)
      return []
    }
    throw e
  }
}
