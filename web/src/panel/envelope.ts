// Annual solar envelope in the panorama: min/max elevation per azimuth bin.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

export interface Envelope {
  binDeg: number
  /** NaN = no samples in the bin. */
  min: Float32Array
  max: Float32Array
}

/** Azimuth bin (cyclic, correctly handles 360° and -0.1°). */
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
