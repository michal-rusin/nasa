/** Regular point grid in CRS meters: column/row of each point (row 0 = max y). */
export interface Grid {
  x0: number
  yTop: number
  step: number
  nx: number
  ny: number
  col: Int32Array
  row: Int32Array
}

/** Maximum field image size (one pixel per grid point). */
const MAX_CELLS = 2048 * 2048
const SNAP_TOL = 0.02

/** Smallest positive gap between consecutive unique values (rounded to millimeters). */
function minStep(values: ArrayLike<number>): number {
  const u = new Set<number>()
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if (Number.isFinite(v)) u.add(Math.round(v * 1000) / 1000)
  }
  const s = Float64Array.from(u).sort()
  let best = Infinity
  for (let i = 1; i < s.length; i++) {
    const d = s[i]! - s[i - 1]!
    if (d > 1e-3 && d < best) best = d
  }
  return best
}

/**
 * Detects whether (x, y) points lie on a regular grid with equal spacing on both axes.
 * Returns null otherwise (the layer then draws individual points), or if the grid would be too large.
 */
export function detectGrid(x: ArrayLike<number>, y: ArrayLike<number>): Grid | null {
  const n = Math.min(x.length, y.length)
  if (n < 4) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const xi = x[i]!, yi = y[i]!
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) return null
    if (xi < minX) minX = xi
    if (xi > maxX) maxX = xi
    if (yi < minY) minY = yi
    if (yi > maxY) maxY = yi
  }
  const sx = minStep(x)
  const sy = minStep(y)
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx - sy) > SNAP_TOL * sx) return null
  const step = sx
  const nx = Math.round((maxX - minX) / step) + 1
  const ny = Math.round((maxY - minY) / step) + 1
  if (nx * ny > MAX_CELLS) return null
  const col = new Int32Array(n)
  const row = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const c = (x[i]! - minX) / step
    const r = (maxY - y[i]!) / step
    const ci = Math.round(c)
    const ri = Math.round(r)
    if (Math.abs(c - ci) > SNAP_TOL || Math.abs(r - ri) > SNAP_TOL) return null
    col[i] = ci
    row[i] = ri
  }
  return { x0: minX, yTop: maxY, step, nx, ny, col, row }
}
