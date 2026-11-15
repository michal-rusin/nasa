// Horizon masks (contract 3.2) and ephemerides (3.3): cached loading.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

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

/** Data file fetching; replaceable in tests. */
export type DataFetcher = (path: string) => Promise<Response>
let fetcher: DataFetcher = fetchOk

let indexPromise: Promise<MaskIndex> | null = null
const tileCache = new Map<string, Promise<ArrayBuffer>>()
let ephemPromise: Promise<Float32Array> | null = null
/** Separate request counter per channel (e.g. locations A and B) to avoid cross-cancellation. */
const maskSeq = new Map<string, number>()

/** Tests only: custom fetcher and cache reset. */
export function _resetMasksForTests(f: DataFetcher = fetchOk): void {
  fetcher = f
  indexPromise = null
  tileCache.clear()
  ephemPromise = null
  maskSeq.clear()
}

/** A newer request superseded getMask; ignore rather than display the result. */
export class StaleRequestError extends Error {
  constructor() {
    super('stale mask request')
    this.name = 'StaleRequestError'
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseMaskIndex(json: unknown): MaskIndex {
  if (!isRecord(json) || !isRecord(json.records)) throw new Error('masks/index.json: missing records field')
  if (json.samples !== MASK_SAMPLES) {
    throw new Error(`masks/index.json: samples = ${String(json.samples)}, frontend supports ${MASK_SAMPLES}`)
  }
  if (json.dtype !== undefined && json.dtype !== 'int16') {
    throw new Error(`masks/index.json: dtype = ${String(json.dtype)}, expected int16`)
  }
  return json as unknown as MaskIndex
}

/** Cache the promise; clear failed entries to allow retries. */
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
      throw new Error(`masks/${file}: size ${buf.byteLength} B is not a multiple of ${MASK_RECORD_BYTES} B`)
    }
    return buf
  })
}

/**
 * Mask for the given point ID (720 × int16, hundredths of a degree).
 * Only the latest call per channel resolves; older calls throw StaleRequestError,
 * so rapid selection changes cannot overwrite newer results with older ones.
 */
export async function getMask(id: number, channel = 'default'): Promise<Int16Array> {
  const seq = (maskSeq.get(channel) ?? 0) + 1
  maskSeq.set(channel, seq)
  const index = await loadMaskIndex()
  const rec = index.records[String(id)]
  if (!rec) {
    if (seq !== maskSeq.get(channel)) throw new StaleRequestError()
    throw new Error(`Missing mask for point ${id} in masks/index.json`)
  }
  const [file, record] = rec
  const buf = await loadMaskTile(file)
  if (seq !== maskSeq.get(channel)) throw new StaleRequestError()
  return maskFromBuffer(buf, record)
}

/** ephem.bin; read the step count exclusively from meta.n_steps. */
export function loadEphem(meta: Pick<Meta, 'n_steps'>): Promise<Float32Array> {
  return cached(() => ephemPromise, (p) => { ephemPromise = p }, async () => {
    const buf = await (await fetcher('ephem.bin')).arrayBuffer()
    return ephemFromBuffer(buf, meta.n_steps)
  })
}
