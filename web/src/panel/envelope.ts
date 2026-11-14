// Roczna obwiednia Słońca w panoramie: min/max elewacji w przedziałach azymutu.

export interface Envelope {
  binDeg: number
  /** NaN = brak próbek w przedziale. */
  min: Float32Array
  max: Float32Array
}

/** Przedział azymutu (cyklicznie, 360° i -0.1° wpadają poprawnie). */
export function azBin(azDeg: number, binDeg: number, nBins: number): number {
  const a = ((azDeg % 360) + 360) % 360
  return Math.min(nBins - 1, Math.floor(a / binDeg))
}

export function sunEnvelope(az: ArrayLike<number>, el: ArrayLike<number>, binDeg = 5): Envelope {
  const nBins = Math.round(360 / binDeg)
  const min = new Float32Array(nBins).fill(NaN)
  const max = new Float32Array(nBins).fill(NaN)
  const n = Math.min(az.length, el.length)
  for (let i = 0; i < n; i++) {
    const a = az[i]!, e = el[i]!
    if (!Number.isFinite(a) || !Number.isFinite(e)) continue
    const b = azBin(a, binDeg, nBins)
    const lo = min[b]!, hi = max[b]!
    if (Number.isNaN(lo) || e < lo) min[b] = e
    if (Number.isNaN(hi) || e > hi) max[b] = e
  }
  return { binDeg, min, max }
}
