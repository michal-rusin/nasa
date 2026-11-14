import { create } from 'zustand'
import { buildIdToIndex, loadCandidates, loadMeta, loadSites } from './data/load'
import { METRIC_KEYS, type Candidates, type Meta, type MetricKey, type Site } from './data/types'
import { computeRange, type Range } from './map/colors'
import {
  computeScore, countPass, DEFAULT_WEIGHTS, normalizeAll, passMask as computePassMask, topN,
  type Bound, type Filters, type Norms, type RankedPoint, type Weights,
} from './rank'

import type { Lang } from './i18n'

export type LayerKey = 'points' | 'sites' | 'slope' | 'illumination' | 'psr'

const LANG_STORAGE_KEY = 'lunar-navigator.lang'

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY)
    if (v === 'en' || v === 'pl') return v
  } catch {
    // brak localStorage (tryb prywatny, testy w node): zostaje domyślny
  }
  return 'en'
}

export const TOP_N = 10
export const DEFAULT_NMS_RADIUS_KM = 5

export interface AppState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** Język interfejsu (i18n.ts). */
  lang: Lang
  setLang: (lang: Lang) => void
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

  // Ranking
  /** Metryki znormalizowane 0..1 (1 = najlepiej), liczone raz po wczytaniu. */
  norms: Norms | null
  filters: Filters
  weights: Weights
  nmsRadiusKm: number
  score: Float32Array | null
  passMask: Uint8Array | null
  passCount: number
  top: RankedPoint[]
  /** Prośba o wycentrowanie mapy; seq rośnie przy każdej prośbie. */
  focusRequest: { index: number; seq: number } | null

  load: () => Promise<void>
  setSelectedIndex: (i: number | null) => void
  selectById: (id: number | null) => void
  setColorBy: (k: MetricKey) => void
  setLayerVisible: (k: LayerKey, visible: boolean) => void
  setOverlayOpacity: (v: number) => void
  setFilter: (k: MetricKey, bound: Bound | undefined) => void
  clearFilters: () => void
  setWeight: (k: MetricKey, w: number) => void
  setNmsRadius: (km: number) => void
  /** Zaznacza punkt i centruje na nim mapę. */
  focusIndex: (i: number) => void
}

type RankInput = Pick<AppState, 'candidates' | 'norms' | 'filters' | 'weights' | 'nmsRadiusKm' | 'score' | 'passMask'>
type RankOutput = Pick<AppState, 'score' | 'passMask' | 'passCount' | 'top'>

/** Przelicza tylko to, co zależy od zmienionych wejść. */
function recompute(s: RankInput, what: { score?: boolean; mask?: boolean }): RankOutput {
  const c = s.candidates
  if (!c || !s.norms) return { score: null, passMask: null, passCount: 0, top: [] }
  const score = what.score || !s.score ? computeScore(s.norms, s.weights, c.n) : s.score
  const mask = what.mask || !s.passMask ? computePassMask(c, s.filters) : s.passMask
  const top = topN(score, mask, c.col.x_m, c.col.y_m, { n: TOP_N, radiusKm: s.nmsRadiusKm })
  return { score, passMask: mask, passCount: countPass(mask), top }
}

export const useStore = create<AppState>()((set, get) => ({
  status: 'loading',
  error: null,
  lang: readStoredLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang)
    } catch {
      // zapis opcjonalny
    }
    set({ lang })
  },
  meta: null,
  candidates: null,
  sites: [],
  idToIndex: new Map(),
  ranges: null,
  selectedIndex: null,
  colorBy: 'sun_pct',
  layers: { points: true, sites: true, slope: false, illumination: false, psr: false },
  overlayOpacity: 0.7,

  norms: null,
  filters: {},
  weights: { ...DEFAULT_WEIGHTS },
  nmsRadiusKm: DEFAULT_NMS_RADIUS_KM,
  score: null,
  passMask: null,
  passCount: 0,
  top: [],
  focusRequest: null,

  load: async () => {
    set({ status: 'loading', error: null })
    try {
      const meta = await loadMeta()
      const [candidates, sites] = await Promise.all([loadCandidates(meta), loadSites()])
      const ranges = {} as Record<MetricKey, Range>
      for (const k of METRIC_KEYS) ranges[k] = computeRange(candidates.col[k])
      const norms = normalizeAll(candidates)
      const rank = recompute({ ...get(), candidates, norms }, { score: true, mask: true })
      set({
        status: 'ready', meta, candidates, sites, ranges, norms, ...rank,
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

  setFilter: (k, bound) => {
    const filters: Filters = { ...get().filters }
    if (!bound || (bound.min === undefined && bound.max === undefined)) delete filters[k]
    else filters[k] = bound
    set({ filters, ...recompute({ ...get(), filters }, { mask: true }) })
  },
  clearFilters: () => {
    const filters: Filters = {}
    set({ filters, ...recompute({ ...get(), filters }, { mask: true }) })
  },
  setWeight: (k, w) => {
    const weights = { ...get().weights, [k]: Number.isFinite(w) ? Math.max(0, w) : 0 }
    set({ weights, ...recompute({ ...get(), weights }, { score: true }) })
  },
  setNmsRadius: (km) => {
    const nmsRadiusKm = Number.isFinite(km) ? Math.max(0, km) : 0
    set({ nmsRadiusKm, ...recompute({ ...get(), nmsRadiusKm }, {}) })
  },
  focusIndex: (i) => set((s) => ({
    selectedIndex: i,
    focusRequest: { index: i, seq: (s.focusRequest?.seq ?? 0) + 1 },
  })),
}))
