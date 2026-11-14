import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './store'

const st = () => useStore.getState()

beforeEach(() => st().setSelectedIndex(null))

describe('wybór miejsc A/B', () => {
  it('pierwszy punkt to A, bez porównania', () => {
    st().pickPoint(5)
    expect([st().selectedIndex, st().compareIndex, st().picking]).toEqual([5, null, false])
  })

  it('startCompare bez A nic nie robi', () => {
    st().startCompare()
    expect(st().picking).toBe(false)
  })

  it('w trybie wyboru kolejny punkt to B i tryb się kończy', () => {
    st().pickPoint(5)
    st().startCompare()
    expect(st().picking).toBe(true)
    st().pickPoint(9)
    expect([st().selectedIndex, st().compareIndex, st().picking]).toEqual([5, 9, false])
  })

  it('ten sam punkt jako B jest ignorowany, ale tryb wyboru się kończy', () => {
    st().pickPoint(5)
    st().startCompare()
    st().pickPoint(5)
    expect([st().selectedIndex, st().compareIndex, st().picking]).toEqual([5, null, false])
  })

  it('focusIndex (ranking, wyszukiwarka) działa jak pickPoint i prosi o wycentrowanie', () => {
    st().pickPoint(1)
    st().startCompare()
    st().focusIndex(7)
    expect([st().selectedIndex, st().compareIndex]).toEqual([1, 7])
    expect(st().focusRequest?.index).toBe(7)
  })

  it('zamknięcie A przesuwa B na miejsce A; zamknięcie B zostawia A', () => {
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

  it('setSelectedIndex(null) zamyka wszystko, cancelCompare tylko tryb wyboru', () => {
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
