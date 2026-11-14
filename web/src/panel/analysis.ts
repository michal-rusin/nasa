// Wspólny stan analizy zaznaczonego punktu: maska, szeregi roczne, kursor czasu.
// Czyta go panel w sidebarze (kontrola zgodności) i dolny panel (panorama, oś czasu).

import { useEffect } from 'react'
import { create } from 'zustand'
import { getMask, loadEphem, StaleRequestError } from '../data/masks'
import { computeSeries, type Series } from '../physics'
import { useStore } from '../store'
import { sunEnvelope, type Envelope } from './envelope'
import { longestRunSpan, type Span } from './timelineMath'

export interface Analysis {
  mask: Int16Array
  series: Series
  envelope: Envelope
  night: Span
  commGap: Span
}

interface AnalysisState {
  id: number | null
  status: 'idle' | 'loading' | 'error' | 'ready'
  error: string | null
  data: Analysis | null
  /** Krok czasu pokazywany w panoramie (wspólny dla osi czasu i suwaka). */
  cursor: number
  playing: boolean
  setCursor: (k: number) => void
  setPlaying: (p: boolean) => void
}

export const useAnalysis = create<AnalysisState>()((set) => ({
  id: null,
  status: 'idle',
  error: null,
  data: null,
  cursor: 0,
  playing: false,
  setCursor: (k) => {
    const n = useStore.getState().meta?.n_steps ?? 0
    set({ cursor: Math.min(Math.max(0, n - 1), Math.max(0, Math.round(k))) })
  },
  setPlaying: (playing) => set({ playing }),
}))

/** Montować raz: ładuje maskę i efemerydy dla zaznaczonego punktu i liczy szeregi. */
export function useAnalysisLoader(): void {
  const meta = useStore((s) => s.meta)
  const c = useStore((s) => s.candidates)
  const sel = useStore((s) => s.selectedIndex)

  useEffect(() => {
    if (!meta || !c || sel === null) {
      useAnalysis.setState({ id: null, status: 'idle', error: null, data: null })
      return
    }
    const id = c.col.id[sel]!
    let alive = true
    useAnalysis.setState({ id, status: 'loading', error: null, data: null })
    Promise.all([getMask(id), loadEphem(meta)]).then(([mask, ephem]) => {
      if (!alive) return
      const series = computeSeries(
        { latDeg: c.col.lat[sel]!, lonDeg: c.col.lon[sel]!, elevM: c.col.elev_m[sel]! },
        mask, ephem, meta.n_steps,
        { moonRadiusKm: meta.moon_radius_km, observerHeightM: meta.observer_height_m, sunRadiusDeg: meta.sun_radius_deg },
      )
      const n = meta.n_steps
      useAnalysis.setState({
        status: 'ready',
        data: {
          mask,
          series,
          envelope: sunEnvelope(series.sunAz, series.sunEl, 5),
          night: longestRunSpan(n, (k) => series.f[k]! < meta.night_threshold),
          commGap: longestRunSpan(n, (k) => series.g[k] === 0),
        },
      })
    }).catch((e: unknown) => {
      if (!alive || e instanceof StaleRequestError) return
      useAnalysis.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    })
    return () => { alive = false }
  }, [meta, c, sel])
}
