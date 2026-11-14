// Liczniki „ile do zmiany stanu” na szeregach godzinowych z physics/series (bez nowej fizyki).

export interface Transition {
  /** Stan w kroku `from`. */
  on: boolean
  /** Ile kroków do pierwszej zmiany stanu; null, gdy stan trwa do końca efemeryd. */
  steps: number | null
}

/** Stan w kroku `from` i liczba kroków do jego zmiany (szukamy tylko do przodu, w [from, n)). */
export function nextTransition(n: number, from: number, isOn: (k: number) => boolean): Transition {
  if (n <= 0) return { on: false, steps: null }
  const k0 = Math.min(n - 1, Math.max(0, Math.floor(from)))
  const on = isOn(k0)
  for (let k = k0 + 1; k < n; k++) if (isOn(k) !== on) return { on, steps: k - k0 }
  return { on, steps: null }
}

/** Słońce „nad horyzontem” = ułamek tarczy ≥ progu nocy (ta sama definicja co longest_night_h). */
export function sunTransition(f: ArrayLike<number>, from: number, nightThreshold: number): Transition {
  return nextTransition(f.length, from, (k) => f[k]! >= nightThreshold)
}

/** Ziemia „widoczna” = g = 1 (ta sama definicja co longest_comm_gap_h). */
export function earthTransition(g: ArrayLike<number>, from: number): Transition {
  return nextTransition(g.length, from, (k) => g[k] === 1)
}

/** Czas w godzinach → { d, h } (zaokrąglenie do pełnych godzin). */
export function splitHours(hours: number): { d: number; h: number } {
  const total = Math.max(0, Math.round(hours))
  return { d: Math.floor(total / 24), h: total % 24 }
}
