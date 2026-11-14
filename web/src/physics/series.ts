// Szeregi godzinowe dla jednego punktu z maski i ephem.bin (kontrakt 2, 3.3).

import { azimuthDeg, elevationDeg, enuBasis } from './enu'
import { maskHeightDeg } from './mask'
import { earthVisible, observerRadiusKm, sunFraction } from './visibility'

export const EPHEM_COLS = 6

export interface SeriesPoint {
  latDeg: number
  lonDeg: number
  elevM: number
}

/** Parametry z meta.json (nie hardkodujemy). */
export interface PhysicsParams {
  moonRadiusKm: number
  observerHeightM: number
  sunRadiusDeg: number
}

export interface Series {
  sunEl: Float32Array
  sunAz: Float32Array
  earthEl: Float32Array
  earthAz: Float32Array
  f: Float32Array
  g: Uint8Array
}

/** ephem.bin → Float32Array (nSteps × 6), jawnie little-endian. */
export function ephemFromBuffer(buf: ArrayBuffer, nSteps: number): Float32Array {
  const expected = nSteps * EPHEM_COLS * 4
  if (buf.byteLength !== expected) {
    throw new Error(`ephem.bin: rozmiar ${buf.byteLength} B, oczekiwano ${expected} B (${nSteps} kroków × 6 × 4 B)`)
  }
  const dv = new DataView(buf)
  const out = new Float32Array(nSteps * EPHEM_COLS)
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true)
  return out
}

/**
 * Słońce: kierunek sun_dir ze środka Księżyca (bez paralaksy).
 * Ziemia: v = earth_xyz − P (z paralaksą); baza ENU jest ortonormalna, więc
 * P·E = P·N = 0, a P·U = |P|.
 */
export function computeSeries(
  point: SeriesPoint,
  mask: Int16Array,
  ephem: Float32Array,
  nSteps: number,
  params: PhysicsParams,
): Series {
  if (ephem.length < nSteps * EPHEM_COLS) throw new Error('ephem: za mało danych dla nSteps')
  const { U, E, N } = enuBasis(point.latDeg, point.lonDeg)
  const r = observerRadiusKm(params.moonRadiusKm, point.elevM, params.observerHeightM)
  const s: Series = {
    sunEl: new Float32Array(nSteps),
    sunAz: new Float32Array(nSteps),
    earthEl: new Float32Array(nSteps),
    earthAz: new Float32Array(nSteps),
    f: new Float32Array(nSteps),
    g: new Uint8Array(nSteps),
  }
  for (let k = 0; k < nSteps; k++) {
    const o = k * EPHEM_COLS
    const sx = ephem[o]!, sy = ephem[o + 1]!, sz = ephem[o + 2]!
    const ex = ephem[o + 3]!, ey = ephem[o + 4]!, ez = ephem[o + 5]!

    const sAz = azimuthDeg(sx * E[0] + sy * E[1] + sz * E[2], sx * N[0] + sy * N[1] + sz * N[2])
    const sEl = elevationDeg(sx * U[0] + sy * U[1] + sz * U[2], Math.hypot(sx, sy, sz))

    const eU = ex * U[0] + ey * U[1] + ez * U[2]
    const vU = eU - r
    const vNorm = Math.sqrt(Math.max(0, ex * ex + ey * ey + ez * ez - 2 * r * eU + r * r))
    const eAz = azimuthDeg(ex * E[0] + ey * E[1] + ez * E[2], ex * N[0] + ey * N[1] + ez * N[2])
    const eEl = elevationDeg(vU, vNorm)

    s.sunAz[k] = sAz
    s.sunEl[k] = sEl
    s.earthAz[k] = eAz
    s.earthEl[k] = eEl
    s.f[k] = sunFraction(sEl, maskHeightDeg(mask, sAz), params.sunRadiusDeg)
    s.g[k] = earthVisible(eEl, maskHeightDeg(mask, eAz))
  }
  return s
}
