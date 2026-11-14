import { create } from 'zustand'
import { buildIdToIndex, loadCandidates, loadMeta, loadSites } from './data/load'
import { METRIC_KEYS, type Candidates, type Meta, type MetricKey, type Site } from './data/types'
import { computeRange, type Range } from './map/colors'

export type LayerKey = 'points' | 'sites' | 'slope' | 'illumination' | 'psr'

export interface AppState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  meta: Meta | null
  candidates: Candidates | null
  sites: Site[]
  idToIndex: Map<number, number>
  /** min/max każdej metryki, liczone raz po wczytaniu. */
  ranges: Record<MetricKey, Range> | null
  selectedIndex: number | null
  colorBy: MetricKey
  layers: Record<LayerKey, boolean>
  overlayOpacity: number

  load: () => Promise<void>
  setSelectedIndex: (i: number | null) => void
  selectById: (id: number | null) => void
  setColorBy: (k: MetricKey) => void
  setLayerVisible: (k: LayerKey, visible: boolean) => void
  setOverlayOpacity: (v: number) => void
}

export const useStore = create<AppState>()((set, get) => ({
  status: 'loading',
  error: null,
  meta: null,
  candidates: null,
  sites: [],
  idToIndex: new Map(),
  ranges: null,
  selectedIndex: null,
  colorBy: 'sun_pct',
  layers: { points: true, sites: true, slope: false, illumination: false, psr: false },
  overlayOpacity: 0.7,

  load: async () => {
    set({ status: 'loading', error: null })
    try {
      const meta = await loadMeta()
      const [candidates, sites] = await Promise.all([loadCandidates(meta), loadSites()])
      const ranges = {} as Record<MetricKey, Range>
      for (const k of METRIC_KEYS) ranges[k] = computeRange(candidates.col[k])
      set({
        status: 'ready', meta, candidates, sites, ranges,
        idToIndex: buildIdToIndex(candidates), selectedIndex: null,
      })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
  setSelectedIndex: (i) => set({ selectedIndex: i }),
  selectById: (id) => {
    if (id === null) return set({ selectedIndex: null })
    const i = get().idToIndex.get(id)
    set({ selectedIndex: i ?? null })
  },
  setColorBy: (k) => set({ colorBy: k }),
  setLayerVisible: (k, visible) => set((s) => ({ layers: { ...s.layers, [k]: visible } })),
  setOverlayOpacity: (v) => set({ overlayOpacity: Math.min(1, Math.max(0, v)) }),
}))
