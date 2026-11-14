// Maski horyzontu (kontrakt 3.2) i efemerydy (3.3): ładowanie z cache.

import { ephemFromBuffer, MASK_RECORD_BYTES, MASK_SAMPLES, maskFromBuffer } from '../physics'
import { fetchOk } from './load'
import type { Meta } from './types'

export interface MaskIndex {
  samples: number
  step_deg: number
  scale: number
  dtype: string
  records: Record<string, readonly [string, number]>
}

/** Pobieranie plików danych; podmienialne w testach. */
export type DataFetcher = (path: string) => Promise<Response>
let fetcher: DataFetcher = fetchOk

let indexPromise: Promise<MaskIndex> | null = null
const tileCache = new Map<string, Promise<ArrayBuffer>>()
let ephemPromise: Promise<Float32Array> | null = null
/** Osobny licznik wyprzedzania na kanał (np. miejsce A i B w porównaniu), żeby się nie anulowały. */
const maskSeq = new Map<string, number>()

/** Tylko do testów: własny fetcher + wyczyszczenie cache. */
export function _resetMasksForTests(f: DataFetcher = fetchOk): void {
  fetcher = f
  indexPromise = null
  tileCache.clear()
  ephemPromise = null
  maskSeq.clear()
}

/** Wynik getMask został wyprzedzony przez nowsze żądanie; ignorować, nie pokazywać. */
export class StaleRequestError extends Error {
  constructor() {
    super('nieaktualne żądanie maski')
    this.name = 'StaleRequestError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseMaskIndex(json: unknown): MaskIndex {
  if (!isRecord(json) || !isRecord(json.records)) throw new Error('masks/index.json: brak pola records')
  if (json.samples !== MASK_SAMPLES) {
    throw new Error(`masks/index.json: samples = ${String(json.samples)}, front obsługuje ${MASK_SAMPLES}`)
  }
  if (json.dtype !== undefined && json.dtype !== 'int16') {
    throw new Error(`masks/index.json: dtype = ${String(json.dtype)}, oczekiwano int16`)
  }
  return json as unknown as MaskIndex
}

/** Cache'uje obietnicę; po błędzie czyści wpis, żeby dało się ponowić. */
function cached<T>(get: () => Promise<T> | null, put: (p: Promise<T> | null) => void, make: () => Promise<T>): Promise<T> {
  const hit = get()
  if (hit) return hit
  const p = make()
  put(p)
  p.catch(() => { if (get() === p) put(null) })
  return p
}

export function loadMaskIndex(): Promise<MaskIndex> {
  return cached(() => indexPromise, (p) => { indexPromise = p }, async () => {
    const res = await fetcher('masks/index.json')
    return parseMaskIndex(await res.json())
  })
}

export function loadMaskTile(file: string): Promise<ArrayBuffer> {
  return cached(() => tileCache.get(file) ?? null, (p) => {
    if (p) tileCache.set(file, p)
    else tileCache.delete(file)
  }, async () => {
    const buf = await (await fetcher(`masks/${file}`)).arrayBuffer()
    if (buf.byteLength % MASK_RECORD_BYTES !== 0) {
      throw new Error(`masks/${file}: rozmiar ${buf.byteLength} B nie jest wielokrotnością ${MASK_RECORD_BYTES} B`)
    }
    return buf
  })
}

/**
 * Maska punktu o danym id (720 × int16, setne stopnia).
 * Na każdym kanale rozwiązuje się tylko najnowsze wywołanie; starsze kończą się StaleRequestError,
 * więc szybka zmiana zaznaczenia nie nadpisze nowszego wyniku starym.
 */
export async function getMask(id: number, channel = 'default'): Promise<Int16Array> {
  const seq = (maskSeq.get(channel) ?? 0) + 1
  maskSeq.set(channel, seq)
  const index = await loadMaskIndex()
  const rec = index.records[String(id)]
  if (!rec) {
    if (seq !== maskSeq.get(channel)) throw new StaleRequestError()
    throw new Error(`Brak maski dla punktu ${id} w masks/index.json`)
  }
  const [file, record] = rec
  const buf = await loadMaskTile(file)
  if (seq !== maskSeq.get(channel)) throw new StaleRequestError()
  return maskFromBuffer(buf, record)
}

/** ephem.bin; liczba kroków wyłącznie z meta.n_steps. */
export function loadEphem(meta: Pick<Meta, 'n_steps'>): Promise<Float32Array> {
  return cached(() => ephemPromise, (p) => { ephemPromise = p }, async () => {
    const buf = await (await fetcher('ephem.bin')).arrayBuffer()
    return ephemFromBuffer(buf, meta.n_steps)
  })
}
