// Wspólny stan analizy dwóch miejsc (A i B): maska, szeregi roczne, wspólny kursor czasu
// i wspólny kierunek patrzenia panoram. Czytają go PlaceBox, SkyPanorama i Timeline.

import { useEffect } from 'react'
import { create } from 'zustand'
import { getMask, loadEphem, StaleRequestError } from '../data/masks'
import { computeSeries, type Series } from '../physics'
import { useStore } from '../store'
import { longestRunSpan, type Span } from './timelineMath'

export interface Analysis {
  mask: Int16Array
  series: Series
  night: Span
  commGap: Span
}

export type SlotKey = 'a' | 'b'

export interface SlotState {
  /** Indeks wiersza kandydata, którego dotyczy analiza. */
  index: number | null
  status: 'idle' | 'loading' | 'error' | 'ready'
  error: string | null
  data: Analysis | null
}

/** Kierunek patrzenia panoramy: az = środek widoku, el = elewacja środka, fov = szerokość poziomo. */
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
  /** Krok czasu pokazywany we wszystkich panoramach. */
  cursor: number
  playing: boolean
  view: SkyView
  /** Czy użytkownik już sam ustawił widok (wtedy nie centrujemy automatycznie). */
  viewTouched: boolean
  setCursor: (k: number) => void
  setPlaying: (p: boolean) => void
  setView: (v: Partial<SkyView>, byUser?: boolean) => void
}

export const useAnalysis = create<AnalysisState>()((set) => ({
  a: IDLE,
  b: IDLE,
  ephem: null,
  cursor: 0,
  playing: false,
  // Na wąskim ekranie węższe pole widzenia, żeby Słońce i Ziemia nie były punktami.
  view: { az: 0, el: 6, fov: typeof window !== 'undefined' && window.innerWidth < 600 ? 65 : 100 },
  viewTouched: false,
  setCursor: (k) => {
    const n = useStore.getState().meta?.n_steps ?? 0
    set({ cursor: Math.min(Math.max(0, n - 1), Math.max(0, Math.round(k))) })
  },
  setPlaying: (playing) => set({ playing }),
  setView: (v, byUser = true) => set((s) => {
    const next = { ...s.view, ...v }
    next.az = ((next.az % 360) + 360) % 360
    next.el = Math.min(EL_MAX, Math.max(EL_MIN, next.el))
    next.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, next.fov))
    return { view: next, viewTouched: s.viewTouched || byUser }
  }),
}))

function setSlot(slot: SlotKey, value: SlotState): void {
  useAnalysis.setState(slot === 'a' ? { a: value } : { b: value })
}

/** Ładuje maskę i efemerydy dla jednego miejsca i liczy szeregi. */
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
      setSlot(slot, {
        index,
        status: 'ready',
        error: null,
        data: {
          mask,
          series,
          night: longestRunSpan(n, (k) => series.f[k]! < meta.night_threshold),
          commGap: longestRunSpan(n, (k) => series.g[k] === 0),
        },
      })
      // Pierwszy widok: patrzymy na Ziemię (a gdy jej nie ma, na Słońce), dopóki użytkownik nie ruszy kamery.
      if (slot === 'a' && !st.viewTouched) {
        const k = Math.min(n - 1, st.cursor)
        const az = series.earthEl[k]! > 0 || series.sunEl[k]! < -1 ? series.earthAz[k]! : series.sunAz[k]!
        useAnalysis.getState().setView({ az }, false)
      }
    }).catch((e: unknown) => {
      if (!alive || e instanceof StaleRequestError) return
      setSlot(slot, { index, status: 'error', error: e instanceof Error ? e.message : String(e), data: null })
    })
    return () => { alive = false }
  }, [meta, c, index, slot])
}

/** Montować raz (w widoku bieguna): analiza miejsc A i B. */
export function useAnalysisLoader(): void {
  const a = useStore((s) => s.selectedIndex)
  const b = useStore((s) => s.compareIndex)
  useSlotLoader('a', a)
  useSlotLoader('b', b)
}

/** Odtwarzanie czasu: jedna pętla na całą stronę, kroków na klatkę ≈ 2,5 doby/s przy 60 fps. */
export function usePlayback(stepsPerFrame = 1): void {
  const playing = useAnalysis((s) => s.playing)
  const n = useStore((s) => s.meta?.n_steps ?? 0)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const { cursor, setCursor, setPlaying } = useAnalysis.getState()
      if (cursor >= n - 1) { setPlaying(false); return }
      setCursor(cursor + stepsPerFrame)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, n, stepsPerFrame])
}
