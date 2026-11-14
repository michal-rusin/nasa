// Metryki z szeregów (kontrakt 2.3). Ciągi liczone jako odcinki, bez zawijania.

export const DEFAULT_NIGHT_THRESHOLD = 0.01

function mean(a: ArrayLike<number>): number {
  if (a.length === 0) return NaN
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]!
  return s / a.length
}

/** Najdłuższy ciąg kolejnych indeksów spełniających warunek (w krokach). */
export function longestRun(n: number, pred: (i: number) => boolean): number {
  let best = 0
  let cur = 0
  for (let i = 0; i < n; i++) {
    if (pred(i)) {
      cur++
      if (cur > best) best = cur
    } else {
      cur = 0
    }
  }
  return best
}

export function sunPct(f: ArrayLike<number>): number {
  return 100 * mean(f)
}

export function earthPct(g: ArrayLike<number>): number {
  return 100 * mean(g)
}

/** Najdłuższy ciąg f < próg × krok w godzinach. */
export function longestNightH(f: ArrayLike<number>, stepS: number, threshold = DEFAULT_NIGHT_THRESHOLD): number {
  return longestRun(f.length, (i) => f[i]! < threshold) * (stepS / 3600)
}

/** Najdłuższy ciąg g = 0 × krok w godzinach. */
export function longestCommGapH(g: ArrayLike<number>, stepS: number): number {
  return longestRun(g.length, (i) => g[i] === 0) * (stepS / 3600)
}
