// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { METRIC_KEYS, type Candidates } from './data/types'
import { MODE_THEMES } from './map/themes'
import { normalizeAll } from './rank'
import { COLOR_KEYS, useStore } from './store'

/** Three distant points: the best for sunlight (0) is the worst for slope, and vice versa (2). */
function fixture(): Candidates {
  const f = (a: number[]) => Float32Array.from(a)
  const col: Record<string, Float32Array> = {
    id: f([10, 11, 12]), x_m: f([0, 50000, 100000]), y_m: f([0, 0, 0]),
    lat: f([-89, -88, -87]), lon: f([0, 0, 0]), elev_m: f([0, 0, 0]), level: f([0, 0, 0]),
    sun_pct: f([90, 50, 10]), earth_pct: f([50, 50, 50]), longest_night_h: f([100, 200, 300]),
    longest_comm_gap_h: f([10, 10, 10]), slope_deg: f([20, 10, 1]), dist_psr_km: f([1, 2, 3]),
    power_track_wm2: f([NaN, NaN, NaN]), power_fixed_wm2: f([NaN, NaN, NaN]), power_fixed_az_deg: f([NaN, NaN, NaN]),
  }
  return { n: 3, col } as unknown as Candidates
}

describe('wersje rankingu', () => {
  it('Top 10 uses the selected ranking mode rather than always using the combined score', () => {
    const candidates = fixture()
    useStore.setState({ candidates, norms: normalizeAll(candidates), filters: {}, score: null, passMask: null })
    const st = () => useStore.getState()
    st().setColorBy('sun_pct')
    expect(st().top[0]?.index).toBe(0)
    st().setColorBy('slope_deg')
    expect(st().top[0]?.index).toBe(2)
  })

  it('each mode has its own accent and dark-to-light scale', () => {
    expect(COLOR_KEYS).toEqual(['score', ...METRIC_KEYS])
    const accents = new Set(COLOR_KEYS.map((k) => MODE_THEMES[k].accent))
    expect(accents.size).toBe(COLOR_KEYS.length)
    const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    for (const k of METRIC_KEYS) {
      const r = MODE_THEMES[k].ramp
      expect(lum(r[r.length - 1]!)).toBeGreaterThan(lum(r[0]!))
    }
  })
})
