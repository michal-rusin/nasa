// Series metrics (contract 2.3). Runs are intervals without wraparound.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

export const DEFAULT_NIGHT_THRESHOLD = 0.01

function mean(a: ArrayLike<number>): number {
  if (a.length === 0) return NaN
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]!
  return s / a.length
}

/** Longest run of consecutive indices satisfying the condition (in steps). */
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

/** Longest run of f < threshold × step size in hours. */
export function longestNightH(f: ArrayLike<number>, stepS: number, threshold = DEFAULT_NIGHT_THRESHOLD): number {
  return longestRun(f.length, (i) => f[i]! < threshold) * (stepS / 3600)
}

/** Longest run of g = 0 × step size in hours. */
export function longestCommGapH(g: ArrayLike<number>, stepS: number): number {
  return longestRun(g.length, (i) => g[i] === 0) * (stepS / 3600)
}
