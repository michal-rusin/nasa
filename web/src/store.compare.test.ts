import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store'

const st = () => useStore.getState()

beforeEach(() => st().setSelectedIndex(null))

describe('selecting locations A/B', () => {
  it('first point is A, without comparison', () => {
    st().pickPoint(5)
    expect([st().selectedIndex, st().compareIndex, st().picking]).toEqual([5, null, false])
  })

  it('startCompare without A does nothing', () => {
    st().startCompare()
    expect(st().picking).toBe(false)
  })

  it('in selection mode the next point becomes B and selection ends', () => {
    st().pickPoint(5)
    st().startCompare()
    expect(st().picking).toBe(true)
    st().pickPoint(9)
    expect([st().selectedIndex, st().compareIndex, st().picking]).toEqual([5, 9, false])
  })

  it('ignores A as B but exits selection mode', () => {
    st().pickPoint(5)
    st().startCompare()
    st().pickPoint(5)
    expect([st().selectedIndex, st().compareIndex, st().picking]).toEqual([5, null, false])
  })

  it('focusIndex (ranking, search) acts like pickPoint and requests centering', () => {
    st().pickPoint(1)
    st().startCompare()
    st().focusIndex(7)
    expect([st().selectedIndex, st().compareIndex]).toEqual([1, 7])
    expect(st().focusRequest?.index).toBe(7)
  })

  it('closing A moves B to A; closing B preserves A', () => {
    st().pickPoint(1)
    st().startCompare()
    st().pickPoint(2)
    st().closeSlot('a')
    expect([st().selectedIndex, st().compareIndex]).toEqual([2, null])
    st().startCompare()
    st().pickPoint(3)
    st().closeSlot('b')
    expect([st().selectedIndex, st().compareIndex]).toEqual([2, null])
  })

  it('setSelectedIndex(null) closes everything; cancelCompare only exits selection mode', () => {
    st().pickPoint(1)
    st().startCompare()
    st().cancelCompare()
    expect([st().selectedIndex, st().picking]).toEqual([1, false])
    st().startCompare()
    st().pickPoint(4)
    st().setSelectedIndex(null)
    expect([st().selectedIndex, st().compareIndex, st().picking]).toEqual([null, null, false])
  })
})
