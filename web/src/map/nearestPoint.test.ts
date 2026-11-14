import { describe, expect, it } from 'vitest'
import { nearestPoint } from './nearestPoint'

describe('nearestPoint', () => {
  const cx = new Float32Array([0, 2000, 4000, NaN])
  const cy = new Float32Array([0, 0, 2000, 0])

  it('znajduje najbliższy punkt w promieniu', () => {
    expect(nearestPoint(1900, 100, cx, cy, 500)).toBe(1)
    expect(nearestPoint(3900, 1800, cx, cy, 500)).toBe(2)
  })

  it('zwraca −1, gdy nic nie ma w promieniu', () => {
    expect(nearestPoint(1000, 1000, cx, cy, 500)).toBe(-1)
  })

  it('pomija NaN i radzi sobie z pustymi danymi', () => {
    expect(nearestPoint(0, 0, [NaN], [0], 1e9)).toBe(-1)
    expect(nearestPoint(0, 0, [], [], 1e9)).toBe(-1)
  })
})
