// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

/**
 * Index of the point (cx[i], cy[i]) nearest to (x, y), within maxDistM.
 * Returns −1 if no point is within the radius. Points containing NaN are skipped.
 * Optional mask: only points with mask[i] === 1 are considered.
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
