// Maski horyzontu (kontrakt 3.2): 720 × int16 LE, setne stopnia, azymut k·0.5°.

export const MASK_SAMPLES = 720
export const MASK_STEP_DEG = 0.5
export const MASK_SCALE = 0.01
export const MASK_RECORD_BYTES = MASK_SAMPLES * 2

/**
 * Wysokość horyzontu [deg] przy azymucie azDeg: interpolacja liniowa między
 * próbkami co 0.5°, cyklicznie (359.9° interpoluje między próbką 719 a 0).
 * Wartości mogą być ujemne.
 */
export function maskHeightDeg(mask: Int16Array, azDeg: number): number {
  const pos = (((azDeg % 360) + 360) % 360) / MASK_STEP_DEG
  const fl = Math.floor(pos)
  const frac = pos - fl
  const i0 = fl % MASK_SAMPLES
  const i1 = (i0 + 1) % MASK_SAMPLES
  return (mask[i0]! * (1 - frac) + mask[i1]! * frac) * MASK_SCALE
}

/** Rekord maski z bufora kafelka (jawnie little-endian). */
export function maskFromBuffer(buf: ArrayBuffer, record: number): Int16Array {
  const dv = new DataView(buf)
  const base = record * MASK_RECORD_BYTES
  if (base + MASK_RECORD_BYTES > buf.byteLength) {
    throw new Error(`maska: rekord ${record} poza plikiem (${buf.byteLength} B)`)
  }
  const out = new Int16Array(MASK_SAMPLES)
  for (let k = 0; k < MASK_SAMPLES; k++) out[k] = dv.getInt16(base + 2 * k, true)
  return out
}
