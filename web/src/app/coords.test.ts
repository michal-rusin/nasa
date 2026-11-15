// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { fmtCoord } from './coords'

describe('fmtCoord', () => {
  it('S/N and E/W hemispheres', () => {
    expect(fmtCoord(-89.532, 129.894)).toBe('89.53°S 129.89°E')
    expect(fmtCoord(12.5, -45.256)).toBe('12.50°N 45.26°W')
  })
  it('digit count and missing data', () => {
    expect(fmtCoord(-84.6529, 25.127, 3)).toBe('84.653°S 25.127°E')
    expect(fmtCoord(NaN, 1)).toBe('n/a')
    expect(fmtCoord(undefined, undefined, 2, 'b.d.')).toBe('b.d.')
  })
})
