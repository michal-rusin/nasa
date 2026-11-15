// Horizon masks (contract 3.2): 720 × int16 LE, hundredths of a degree, azimuth k·0.5°.

export const MASK_SAMPLES = 720
export const MASK_STEP_DEG = 0.5
export const MASK_SCALE = 0.01
export const MASK_RECORD_BYTES = MASK_SAMPLES * 2

/**
 * Horizon elevation [deg] at azimuth azDeg: linear interpolation between
 * samples spaced 0.5° apart, wrapping around (359.9° interpolates between samples 719 and 0).
 * Values may be negative.
 */
export function maskHeightDeg(mask: Int16Array, azDeg: number): number {
  const pos = (((azDeg % 360) + 360) % 360) / MASK_STEP_DEG
  const fl = Math.floor(pos)
  const frac = pos - fl
  const i0 = fl % MASK_SAMPLES
  const i1 = (i0 + 1) % MASK_SAMPLES
  return (mask[i0]! * (1 - frac) + mask[i1]! * frac) * MASK_SCALE
}

/** Read a mask record from a tile buffer (explicit little-endian). */
export function maskFromBuffer(buf: ArrayBuffer, record: number): Int16Array {
  const dv = new DataView(buf)
  const base = record * MASK_RECORD_BYTES
  if (base + MASK_RECORD_BYTES > buf.byteLength) {
    throw new Error(`mask: record ${record} outside file bounds (${buf.byteLength} B)`)
  }
  const out = new Int16Array(MASK_SAMPLES)
  for (let k = 0; k < MASK_SAMPLES; k++) out[k] = dv.getInt16(base + 2 * k, true)
  return out
}
