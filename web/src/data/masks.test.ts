import { afterEach, describe, expect, it } from 'vitest'
import { MASK_RECORD_BYTES, MASK_SAMPLES, maskFromBuffer } from '../physics'
import { _resetMasksForTests, getMask, StaleRequestError } from './masks'

/** Kafelek z `n` rekordami; wartość próbki = r·1000 + k − 300 (są też ujemne). */
function tile(n: number): ArrayBuffer {
  const buf = new ArrayBuffer(n * MASK_RECORD_BYTES)
  const dv = new DataView(buf)
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < MASK_SAMPLES; k++) dv.setInt16(r * MASK_RECORD_BYTES + 2 * k, r * 1000 + k - 300, true)
  }
  return buf
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const INDEX = {
  samples: 720, step_deg: 0.5, scale: 0.01, dtype: 'int16',
  records: { '10': ['tile_a.bin', 0], '11': ['tile_a.bin', 2], '20': ['tile_b.bin', 1] },
}

afterEach(() => _resetMasksForTests())

describe('wycinanie rekordu z kafelka', () => {
  it('rekord 0 i ostatni, little-endian, ze znakiem', () => {
    const buf = tile(3)
    const first = maskFromBuffer(buf, 0)
    const last = maskFromBuffer(buf, 2)
    expect(first.length).toBe(720)
    expect(first[0]).toBe(-300)
    expect(first[719]).toBe(419)
    expect(last[0]).toBe(1700)
    expect(last[719]).toBe(2419)
    expect(() => maskFromBuffer(buf, 3)).toThrow()
  })

  it('getMask bierze plik i rekord z index.json', async () => {
    _resetMasksForTests(async (path) => {
      if (path === 'masks/index.json') return new Response(JSON.stringify(INDEX))
      if (path === 'masks/tile_a.bin') return new Response(tile(3))
      throw new Error(`nieoczekiwany ${path}`)
    })
    expect((await getMask(10))[0]).toBe(-300)
    expect((await getMask(11))[0]).toBe(1700)
    await expect(getMask(999)).rejects.toThrow(/Brak maski dla punktu 999/)
  })
})

describe('wyścig getMask', () => {
  it('starszy wynik jest odrzucony, gdy nowszy już przyszedł', async () => {
    const a = deferred<Response>()
    const b = deferred<Response>()
    _resetMasksForTests(async (path) => {
      if (path === 'masks/index.json') return new Response(JSON.stringify(INDEX))
      if (path === 'masks/tile_a.bin') return a.promise
      if (path === 'masks/tile_b.bin') return b.promise
      throw new Error(`nieoczekiwany ${path}`)
    })
    const older = getMask(10)
    const newer = getMask(20)
    b.resolve(new Response(tile(2)))
    expect((await newer)[0]).toBe(700)
    a.resolve(new Response(tile(3)))
    await expect(older).rejects.toBeInstanceOf(StaleRequestError)
  })
})
