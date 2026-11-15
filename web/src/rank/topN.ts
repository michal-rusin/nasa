export interface RankedPoint {
  index: number
  score: number
}

export interface TopNOptions {
  n?: number
  /** NMS radius in km; <= 0 disables NMS. */
  radiusKm?: number
}

/**
 * Top N among points with mask=1, descending score (ties: lower index).
 * NMS: skip points within radiusKm of a selected point (hash grid over x_m, y_m in meters).
 */
export function topN(
  score: ArrayLike<number>,
  mask: ArrayLike<number>,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: TopNOptions = {},
): RankedPoint[] {
  const nTop = opts.n ?? 10
  const radiusM = (opts.radiusKm ?? 5) * 1000
  if (nTop <= 0) return []

  const total = Math.min(score.length, mask.length, x.length, y.length)
  let m = 0
  for (let i = 0; i < total; i++) if (mask[i] === 1 && !Number.isNaN(score[i]!)) m++
  const order = new Int32Array(m)
  m = 0
  for (let i = 0; i < total; i++) if (mask[i] === 1 && !Number.isNaN(score[i]!)) order[m++] = i
  order.sort((a, b) => (score[b]! - score[a]!) || (a - b))

  const useNms = radiusM > 0
  const r2 = radiusM * radiusM
  const grid = new Map<string, number[]>()
  const out: RankedPoint[] = []

  for (let k = 0; k < order.length && out.length < nTop; k++) {
    const i = order[k]!
    const xi = x[i]!
    const yi = y[i]!
    if (useNms) {
      if (Number.isNaN(xi) || Number.isNaN(yi)) continue
      const gx = Math.floor(xi / radiusM)
      const gy = Math.floor(yi / radiusM)
      let suppressed = false
      for (let dx = -1; dx <= 1 && !suppressed; dx++) {
        for (let dy = -1; dy <= 1 && !suppressed; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`)
          if (!cell) continue
          for (const j of cell) {
            const ex = x[j]! - xi
            const ey = y[j]! - yi
            if (ex * ex + ey * ey <= r2) { suppressed = true; break }
          }
        }
      }
      if (suppressed) continue
      const key = `${gx},${gy}`
      const cell = grid.get(key)
      if (cell) cell.push(i)
      else grid.set(key, [i])
    }
    out.push({ index: i, score: score[i]! })
  }
  return out
}
