// Each ranking mode (combined score or single metric) has its own map color scale
// and accent color for Top 10 badges, list, and legend. Pure data, no DOM.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import type { ColorKey } from '../store'
import { RAMP_STOPS, type RGB } from './colors'

export interface ModeTheme {
  /** Scale control points: worst to best. */
  ramp: readonly RGB[]
  /** Color of Top 10 badges and UI highlights. */
  accent: string
  /** Badge text color (contrasting with the accent). */
  onAccent: string
}

/** Scale from a dark muted background to the accent color (best = brightest). */
function towards(accent: RGB, light: RGB): readonly RGB[] {
  const dark: RGB = [26, 28, 36]
  const mid = (a: RGB, b: RGB, t: number): RGB => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
  return [dark, mid(dark, accent, 0.35), mid(dark, accent, 0.7), accent, light]
}

export const MODE_THEMES: Record<ColorKey, ModeTheme> = {
  score: { ramp: RAMP_STOPS, accent: '#6be08a', onAccent: '#04110a' },
  sun_pct: { ramp: towards([255, 194, 58], [255, 244, 190]), accent: '#ffc23a', onAccent: '#1d1300' },
  earth_pct: { ramp: towards([74, 163, 255], [200, 228, 255]), accent: '#4aa3ff', onAccent: '#020c1a' },
  longest_night_h: { ramp: towards([167, 128, 255], [228, 214, 255]), accent: '#b48cff', onAccent: '#0e0620' },
  longest_comm_gap_h: { ramp: towards([52, 214, 196], [196, 250, 242]), accent: '#3fd6c6', onAccent: '#021412' },
  slope_deg: { ramp: towards([255, 138, 76], [255, 214, 186]), accent: '#ff8a4c', onAccent: '#1d0a00' },
  dist_psr_km: { ramp: towards([120, 220, 255], [220, 246, 255]), accent: '#8fe3ff', onAccent: '#02121a' },
  power_track_wm2: { ramp: towards([190, 236, 70], [236, 252, 196]), accent: '#c3ec46', onAccent: '#121a02' },
  power_fixed_wm2: { ramp: towards([255, 110, 180], [255, 214, 234]), accent: '#ff6fb4', onAccent: '#1d0410' },
}
