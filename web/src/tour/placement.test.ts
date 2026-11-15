import { describe, expect, it } from 'vitest'
import { clipRect, placeCard, TOPBAR_H } from './placement'

const vp = { w: 1440, h: 900 }
const card = { w: 360, h: 200 }

describe('clipRect', () => {
  it('przycina cel wystający poza okno', () => {
    expect(clipRect({ left: -50, top: 800, width: 200, height: 400 }, vp))
      .toEqual({ left: 0, top: 800, width: 150, height: 100 })
  })

  it('cel poza oknem daje null', () => {
    expect(clipRect({ left: 100, top: 1200, width: 200, height: 100 }, vp)).toBeNull()
  })
})

describe('placeCard', () => {
  it('stawia kartę pod celem, wyśrodkowaną', () => {
    const p = placeCard({ left: 600, top: 100, width: 200, height: 50 }, card, vp)
    expect(p).toEqual({ left: 700 - 180, top: 166 })
  })

  it('gdy pod celem nie ma miejsca, stawia ją nad nim', () => {
    const p = placeCard({ left: 600, top: 780, width: 200, height: 80 }, card, vp)
    expect(p.top).toBe(780 - 16 - 200)
  })

  it('wysoki cel przy lewej krawędzi: karta z prawej', () => {
    const p = placeCard({ left: 20, top: 80, width: 300, height: 800 }, card, vp)
    expect(p.left).toBe(336)
  })

  it('cel na cały ekran: karta w jego dolnej części, w oknie', () => {
    const p = placeCard({ left: 0, top: 60, width: 1440, height: 840 }, card, vp, { inside: true })
    expect(p.top + card.h).toBeLessThanOrEqual(vp.h)
    expect(p.top).toBeGreaterThanOrEqual(TOPBAR_H)
    expect(p.left).toBe(540)
  })

  it('duży cel bez `inside`: karta w jego prawym dolnym rogu', () => {
    const p = placeCard({ left: 30, top: 170, width: 1380, height: 700 }, card, vp)
    expect(p).toEqual({ left: 30 + 1380 - 360 - 24, top: 170 + 700 - 200 - 28 })
  })

  it('`end`: karta nad celem dosunięta do jego prawej krawędzi', () => {
    const p = placeCard({ left: 30, top: 700, width: 1380, height: 60 }, card, vp, { end: true })
    expect(p).toEqual({ left: 1026, top: 700 - 16 - 200 })
  })

  it('nie wychodzi poza okno przy celu w rogu', () => {
    const p = placeCard({ left: 1400, top: 10, width: 30, height: 30 }, card, vp)
    expect(p.left + card.w).toBeLessThanOrEqual(vp.w)
  })

  it('telefon: karta po przeciwnej stronie niż cel', () => {
    const phone = { w: 390, h: 800 }
    const small = { w: 366, h: 180 }
    expect(placeCard({ left: 0, top: 600, width: 390, height: 200 }, small, phone).top).toBe(TOPBAR_H + 12)
    expect(placeCard({ left: 0, top: 80, width: 390, height: 100 }, small, phone).top).toBe(800 - 180 - 12)
  })

  it('brak celu: karta na dole, na środku', () => {
    const p = placeCard(null, card, vp)
    expect(p.left).toBe(540)
    expect(p.top + card.h).toBeLessThanOrEqual(vp.h)
  })
})
