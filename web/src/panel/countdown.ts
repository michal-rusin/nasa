// Time-to-state-change counters on hourly physics/series data (no additional physics).

export interface Transition {
  /** State at step `from`. */
  on: boolean
  /** Steps until the first state change; null if unchanged through the ephemeris end. */
  steps: number | null
}

/** State at `from` and steps until it changes (search forward only, in [from, n)). */
export function nextTransition(n: number, from: number, isOn: (k: number) => boolean): Transition {
  if (n <= 0) return { on: false, steps: null }
  const k0 = Math.min(n - 1, Math.max(0, Math.floor(from)))
  const on = isOn(k0)
  for (let k = k0 + 1; k < n; k++) if (isOn(k) !== on) return { on, steps: k - k0 }
  return { on, steps: null }
}

/** Sun “above horizon” = disk fraction ≥ night threshold (same definition as longest_night_h). */
export function sunTransition(f: ArrayLike<number>, from: number, nightThreshold: number): Transition {
  return nextTransition(f.length, from, (k) => f[k]! >= nightThreshold)
}

/** Earth “visible” = g = 1 (same definition as longest_comm_gap_h). */
export function earthTransition(g: ArrayLike<number>, from: number): Transition {
  return nextTransition(g.length, from, (k) => g[k] === 1)
}

/** Time in hours → { d, h } (rounded to whole hours). */
export function splitHours(hours: number): { d: number; h: number } {
  const total = Math.max(0, Math.round(hours))
  return { d: Math.floor(total / 24), h: total % 24 }
}
