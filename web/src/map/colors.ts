// Skala kolorów punktów: ciemny → fiołkowy → żółty. Czyste funkcje, bez DOM.

export type RGB = readonly [number, number, number]

export const RAMP_STOPS: readonly RGB[] = [
  [20, 16, 60],    // ciemny granat
  [150, 55, 160],  // fiołkowy
  [255, 230, 90],  // żółty
]

/** Kolor dla wartości spoza danych (NaN). */
export const NO_DATA_RGB: RGB = [128, 128, 128]

export interface Range {
  min: number
  max: number
}

/** min/max z pominięciem NaN. Same NaN → {min: 0, max: 0}. */
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

/** Skala 3-punktowa, t w [0, 1] (przycinane). */
export function rampRgb(t: number): RGB {
  const tc = Math.min(1, Math.max(0, t))
  const seg = tc <= 0.5 ? 0 : 1
  const local = seg === 0 ? tc / 0.5 : (tc - 0.5) / 0.5
  const a = RAMP_STOPS[seg]!
  const b = RAMP_STOPS[seg + 1]!
  return [
    Math.round(a[0] + (b[0] - a[0]) * local),
    Math.round(a[1] + (b[1] - a[1]) * local),
    Math.round(a[2] + (b[2] - a[2]) * local),
  ]
}

/** Pozycja wartości w zakresie, t w [0, 1]; NaN dla NaN; zakres zerowy → 0. */
export function normalize(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return NaN
  if (!(max > min)) return 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

export function rgbCss(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** Kolor CSS dla wartości metryki w zakresie [min, max]. */
export function valueToColor(value: number, min: number, max: number): string {
  const t = normalize(value, min, max)
  return rgbCss(Number.isNaN(t) ? NO_DATA_RGB : rampRgb(t))
}

/** linear-gradient do legendy. */
export function rampCssGradient(): string {
  return `linear-gradient(to right, ${RAMP_STOPS.map((s, i) =>
    `${rgbCss(s)} ${(i / (RAMP_STOPS.length - 1)) * 100}%`).join(', ')})`
}
