/**
 * Indeks punktu (cx[i], cy[i]) najbliższego do (x, y), nie dalej niż maxDistM.
 * Zwraca −1, gdy w promieniu nie ma żadnego punktu. Punkty z NaN są pomijane.
 * mask (opcjonalnie): rozważane są tylko punkty z mask[i] === 1.
 */
export function nearestPoint(
  x: number,
  y: number,
  cx: ArrayLike<number>,
  cy: ArrayLike<number>,
  maxDistM: number,
  mask?: ArrayLike<number> | null,
): number {
  let best = -1
  let bestD2 = maxDistM * maxDistM
  const n = Math.min(cx.length, cy.length)
  for (let i = 0; i < n; i++) {
    if (mask && mask[i] !== 1) continue
    const dx = cx[i]! - x
    const dy = cy[i]! - y
    const d2 = dx * dx + dy * dy
    if (d2 <= bestD2) {
      bestD2 = d2
      best = i
    }
  }
  return best
}
