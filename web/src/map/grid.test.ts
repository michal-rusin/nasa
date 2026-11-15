// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { detectGrid } from './grid'

describe('detectGrid', () => {
  it('regular grid with gaps: spacing, dimensions, row 0 = max y', () => {
    const x = [-1000, 1000, 3000, -1000, 3000]
    const y = [500, 500, 500, -1500, -3500]
    const g = detectGrid(x, y)
    expect(g).not.toBeNull()
    expect(g!.step).toBe(2000)
    expect([g!.nx, g!.ny]).toEqual([3, 3])
    expect(Array.from(g!.col)).toEqual([0, 1, 2, 0, 2])
    expect(Array.from(g!.row)).toEqual([0, 0, 0, 1, 2])
  })

  it('off-grid points or unequal axis spacing → null', () => {
    expect(detectGrid([0, 10, 20, 35], [0, 0, 10, 10])).toBeNull()
    expect(detectGrid([0, 10, 20, 30], [0, 0, 50, 50])).toBeNull()
  })

  it('NaN or too few points → null', () => {
    expect(detectGrid([0, 1, NaN, 3], [0, 0, 0, 0])).toBeNull()
    expect(detectGrid([0, 1], [0, 0])).toBeNull()
  })
})
