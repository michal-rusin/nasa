// Czysta geometria samouczka: przycięcie celu do okna i położenie karty obok niego.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

export interface Rect { left: number; top: number; width: number; height: number }
export interface Size { w: number; h: number }
export interface Point { left: number; top: number }

/** Wysokość górnego paska: karta nie wchodzi pod niego. */
export const TOPBAR_H = 60
const GAP = 16
const EDGE = 12
const MOBILE_W = 720

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Część prostokąta widoczna w oknie; null, gdy cel jest w całości poza nim. */
export function clipRect(r: Rect, vp: Size): Rect | null {
  const left = Math.max(0, r.left)
  const top = Math.max(0, r.top)
  const right = Math.min(vp.w, r.left + r.width)
  const bottom = Math.min(vp.h, r.top + r.height)
  if (right - left < 1 || bottom - top < 1) return null
  return { left, top, width: right - left, height: bottom - top }
}

/**
 * Lewy górny róg karty. Kolejność prób: pod celem, nad nim, z prawej, z lewej; gdy nigdzie się
 * nie mieści (albo cel jest „duży”, `inside`), karta staje w dolnej części celu: na środku dla
 * `inside`, w prawym rogu w pozostałych przypadkach (mniej zasłania). `end` dosuwa kartę do
 * prawej krawędzi celu także wtedy, gdy stoi pod nim albo nad nim.
 * Na telefonie karta dokuje się do tej krawędzi ekranu, przy której nie zasłania celu.
 */
export function placeCard(
  target: Rect | null, card: Size, vp: Size, opts: { inside?: boolean; end?: boolean } = {},
): Point {
  const maxLeft = vp.w - card.w - EDGE
  const maxTop = vp.h - card.h - EDGE
  const minTop = TOPBAR_H + EDGE
  const centered = (vp.w - card.w) / 2
  if (!target) return { left: clamp(centered, EDGE, maxLeft), top: clamp(maxTop - 12, minTop, maxTop) }

  const cx = target.left + target.width / 2
  const cy = target.top + target.height / 2
  if (vp.w <= MOBILE_W) {
    return { left: clamp(centered, EDGE, maxLeft), top: cy > vp.h / 2 ? minTop : clamp(maxTop, minTop, maxTop) }
  }
  const endX = clamp(target.left + target.width - card.w - 24, EDGE, maxLeft)
  const insideTop = clamp(target.top + target.height - card.h - 28, minTop, maxTop)
  if (opts.inside) return { left: clamp(cx - card.w / 2, EDGE, maxLeft), top: insideTop }

  const alongX = opts.end ? endX : clamp(cx - card.w / 2, EDGE, maxLeft)
  const alongY = clamp(cy - card.h / 2, minTop, maxTop)
  const below = target.top + target.height + GAP
  if (below + card.h <= vp.h - EDGE) return { left: alongX, top: below }
  const above = target.top - GAP - card.h
  if (above >= minTop) return { left: alongX, top: above }
  const right = target.left + target.width + GAP
  if (right + card.w <= vp.w - EDGE) return { left: right, top: alongY }
  const left = target.left - GAP - card.w
  if (left >= EDGE) return { left, top: alongY }
  return { left: endX, top: insideTop }
}
