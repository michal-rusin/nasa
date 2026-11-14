// Czyste pomocniki osi czasu.

/** Średnia w kubełkach: n próbek ściśniętych do `width` kolumn (agregacja, nie próbkowanie). */
export function bucketMean(a: ArrayLike<number>, width: number): Float32Array {
  const n = a.length
  const out = new Float32Array(Math.max(0, width)).fill(NaN)
  if (n === 0) return out
  for (let c = 0; c < width; c++) {
    const i0 = Math.floor((c * n) / width)
    const i1 = Math.max(i0 + 1, Math.floor(((c + 1) * n) / width))
    let s = 0
    for (let i = i0; i < i1 && i < n; i++) s += a[i]!
    out[c] = s / (Math.min(i1, n) - i0)
  }
  return out
}

export interface Span {
  start: number
  len: number
}

/** Najdłuższy ciąg indeksów spełniających warunek (pierwszy przy remisie); len = 0 gdy brak. */
export function longestRunSpan(n: number, pred: (i: number) => boolean): Span {
  let best: Span = { start: 0, len: 0 }
  let start = -1
  for (let i = 0; i <= n; i++) {
    const ok = i < n && pred(i)
    if (ok && start < 0) start = i
    if (!ok && start >= 0) {
      if (i - start > best.len) best = { start, len: i - start }
      start = -1
    }
  }
  return best
}

const MONTHS_PL = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

export interface MonthTick {
  /** Ułamek osi 0..1. */
  pos: number
  label: string
}

/** Granice miesięcy (UTC) w okresie [t0, t0 + nSteps·stepS). */
export function monthTicks(
  t0Utc: string, stepS: number, nSteps: number, names: readonly string[] = MONTHS_PL,
): MonthTick[] {
  const t0 = Date.parse(t0Utc)
  const span = nSteps * stepS * 1000
  if (!Number.isFinite(t0) || span <= 0) return []
  const d0 = new Date(t0)
  const ticks: MonthTick[] = []
  let y = d0.getUTCFullYear(), m = d0.getUTCMonth()
  for (let guard = 0; guard < 1000; guard++) {
    const t = Date.UTC(y, m, 1)
    if (t >= t0 + span) break
    if (t >= t0) ticks.push({ pos: (t - t0) / span, label: names[m] ?? MONTHS_PL[m]! })
    m++
    if (m === 12) { m = 0; y++ }
  }
  return ticks
}

/** Krok k osi czasu jako tekst UTC: „2028-01-01 05:00” (z godziną) albo „2028-01-01”. */
export function stepToUtc(t0Utc: string, stepS: number, k: number, withTime = true): string {
  const t = Date.parse(t0Utc) + k * stepS * 1000
  if (!Number.isFinite(t)) return `#${k}`
  const iso = new Date(t).toISOString()
  return withTime ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10)
}
