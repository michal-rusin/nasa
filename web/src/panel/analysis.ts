// Shared analysis state for locations A and B: mask, annual series, shared time cursor
// and independent panorama view directions. Read by PlaceBox, SkyPanorama, and Timeline.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useEffect } from 'react'
import { create } from 'zustand'
import { getMask, loadEphem, StaleRequestError } from '../data/masks'
import { yearRange, type StepRange } from '../data/years'
import { computeSeries, type Series } from '../physics'
import { useStore } from '../store'
import { longestRunOverlapping, type Span } from './timelineMath'

/** Series computed across all of ephem.bin (all years); timeline displays the selected year. */
export interface Analysis {
  mask: Int16Array
  series: Series
}

/** Steps for the selected year (store.year); entire timeline if data has no years. */
export function activeRange(s: { meta: { t0_utc: string; step_s: number; n_steps: number } | null; year: number | null }): StepRange {
  if (!s.meta) return { start: 0, len: 0 }
  if (s.year === null) return { start: 0, len: s.meta.n_steps }
  const r = yearRange(s.meta, s.year)
  return r.len > 0 ? r : { start: 0, len: s.meta.n_steps }
}

export function useActiveRange(): StepRange {
  const meta = useStore((s) => s.meta)
  const year = useStore((s) => s.year)
  return activeRange({ meta, year })
}

/**
 * Longest night and communication gap in a year, matching the engine (contract 3.4):
 * count an overlapping run in full, capped at the year duration.
 */
export function yearSpans(series: Series, range: StepRange, nightThreshold: number): { night: Span; commGap: Span } {
  const n = series.f.length
  const end = range.start + range.len
  return {
    night: longestRunOverlapping(n, (k) => series.f[k]! < nightThreshold, range.start, end),
    commGap: longestRunOverlapping(n, (k) => series.g[k] === 0, range.start, end),
  }
}

export type SlotKey = 'a' | 'b'

export interface SlotState {
  /** Row index of the candidate being analyzed. */
  index: number | null
  status: 'idle' | 'loading' | 'error' | 'ready'
  error: string | null
  data: Analysis | null
}

/** Panorama direction: az = view center, el = center elevation, fov = horizontal width. */
export interface SkyView {
  az: number
  el: number
  fov: number
}

export const FOV_MIN = 20
export const FOV_MAX = 150
const EL_MIN = -4
const EL_MAX = 70
const IDLE: SlotState = { index: null, status: 'idle', error: null, data: null }

interface AnalysisState {
  a: SlotState
  b: SlotState
  ephem: Float32Array | null
  /** Time step displayed in all panoramas. */
  cursor: number
  playing: boolean
  /** Independent panorama view directions (rotating one does not move the other). */
  views: Record<SlotKey, SkyView>
  setCursor: (k: number) => void
  setPlaying: (p: boolean) => void
  setView: (slot: SlotKey, v: Partial<SkyView>) => void
}

/** Narrower field of view on small screens so the Sun and Earth remain larger than dots. */
function initialView(): SkyView {
  return { az: 0, el: 6, fov: typeof window !== 'undefined' && window.innerWidth < 600 ? 65 : 100 }
}

export const useAnalysis = create<AnalysisState>()((set) => ({
  a: IDLE,
  b: IDLE,
  ephem: null,
  cursor: 0,
  playing: false,
  views: { a: initialView(), b: initialView() },
  setCursor: (k) => {
    // Keep the cursor within the selected year.
    const r = activeRange(useStore.getState())
    set({ cursor: Math.min(r.start + Math.max(0, r.len - 1), Math.max(r.start, Math.round(k))) })
  },
  setPlaying: (playing) => set({ playing }),
  setView: (slot, v) => set((s) => {
    const next = { ...s.views[slot], ...v }
    next.az = ((next.az % 360) + 360) % 360
    next.el = Math.min(EL_MAX, Math.max(EL_MIN, next.el))
    next.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, next.fov))
    return { views: { ...s.views, [slot]: next } }
  }),
}))

function setSlot(slot: SlotKey, value: SlotState): void {
  useAnalysis.setState(slot === 'a' ? { a: value } : { b: value })
}

/** Load the mask and ephemerides for one location and compute its series. */
function useSlotLoader(slot: SlotKey, index: number | null): void {
  const meta = useStore((s) => s.meta)
  const c = useStore((s) => s.candidates)

  useEffect(() => {
    if (!meta || !c || index === null) {
      setSlot(slot, IDLE)
      return
    }
    const id = c.col.id[index]!
    let alive = true
    setSlot(slot, { index, status: 'loading', error: null, data: null })
    Promise.all([getMask(id, slot), loadEphem(meta)]).then(([mask, ephem]) => {
      if (!alive) return
      const series = computeSeries(
        { latDeg: c.col.lat[index]!, lonDeg: c.col.lon[index]!, elevM: c.col.elev_m[index]! },
        mask, ephem, meta.n_steps,
        { moonRadiusKm: meta.moon_radius_km, observerHeightM: meta.observer_height_m, sunRadiusDeg: meta.sun_radius_deg },
      )
      const n = meta.n_steps
      const st = useAnalysis.getState()
      if (st.ephem !== ephem) useAnalysis.setState({ ephem })
      setSlot(slot, { index, status: 'ready', error: null, data: { mask, series } })
      // New location: start the panorama facing Earth (or the Sun if Earth is absent).
      const k = Math.min(n - 1, st.cursor)
      const az = series.earthEl[k]! > 0 || series.sunEl[k]! < -1 ? series.earthAz[k]! : series.sunAz[k]!
      useAnalysis.getState().setView(slot, { az, el: initialView().el })
    }).catch((e: unknown) => {
      if (!alive || e instanceof StaleRequestError) return
      setSlot(slot, { index, status: 'error', error: e instanceof Error ? e.message : String(e), data: null })
    })
    return () => { alive = false }
  }, [meta, c, index, slot])
}

/** Mount once (in the pole view): analyze locations A and B. */
export function useAnalysisLoader(): void {
  const a = useStore((s) => s.selectedIndex)
  const b = useStore((s) => s.compareIndex)
  useSlotLoader('a', a)
  useSlotLoader('b', b)
}

/** Time playback: one loop for the page, steps per frame ≈ 2.5 days/s at 60 fps; stop at year end. */
export function usePlayback(stepsPerFrame = 1): void {
  const playing = useAnalysis((s) => s.playing)
  const { start, len } = useActiveRange()
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const last = start + len - 1
    const tick = () => {
      const { cursor, setCursor, setPlaying } = useAnalysis.getState()
      if (cursor >= last) { setPlaying(false); return }
      setCursor(cursor + stepsPerFrame)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, start, len, stepsPerFrame])
}

// Year change: move the cursor to the same point in the year (same date and time).
useStore.subscribe((s, prev) => {
  if (s.year === prev.year || !s.meta) return
  const before = activeRange(prev.meta ? prev : s)
  const { cursor, setCursor } = useAnalysis.getState()
  setCursor(activeRange(s).start + (cursor - before.start))
})
