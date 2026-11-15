// Point color scale: like a hypsometric map, from red (worst) through orange
// and yellow to green (best). Pure functions, no DOM.

export type RGB = readonly [number, number, number]

/** Control points every 1/8: start = worst (red), end = best (green). */
export const RAMP_STOPS: readonly RGB[] = [
  [176, 32, 38],
  [214, 64, 40],
  [238, 112, 44],
  [247, 160, 58],
  [244, 202, 84],
  [202, 214, 92],
  [146, 202, 96],
  [84, 178, 92],
  [30, 150, 86],
]

/** Color for missing values (NaN). */
export const NO_DATA_RGB: RGB = [128, 128, 128]

export interface Range {
  min: number
  max: number
}

/** min/max ignoring NaN. All NaN → {min: 0, max: 0}. */
export function computeRange(values: ArrayLike<number>): Range {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!
    if (Number.isNaN(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max }
}

/** Linear interpolation between evenly spaced scale points, t clamped to [0, 1]. */
export function rampRgb(t: number, stops: readonly RGB[] = RAMP_STOPS): RGB {
  const tc = Math.min(1, Math.max(0, t))
  const nSeg = stops.length - 1
  const seg = Math.min(nSeg - 1, Math.floor(tc * nSeg))
  const local = tc * nSeg - seg
  const a = stops[seg]!
  const b = stops[seg + 1]!
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local),
  ]
}

/** Value position in the range, t in [0, 1]; NaN for NaN; zero range → 0. */
export function normalize(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return NaN
  if (!(max > min)) return 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

export function rgbCss(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** CSS color for a metric value in [min, max]. */
export function valueToColor(value: number, min: number, max: number): string {
  const t = normalize(value, min, max)
  return rgbCss(Number.isNaN(t) ? NO_DATA_RGB : rampRgb(t))
}

/** linear-gradient for the legend. */
export function rampCssGradient(stops: readonly RGB[] = RAMP_STOPS): string {
  return `linear-gradient(to right, ${stops.map((s, i) =>
    `${rgbCss(s)} ${(i / (stops.length - 1)) * 100}%`).join(', ')})`
}
