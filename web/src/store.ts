import { create } from 'zustand'
import { buildIdToIndex, loadCandidates, loadMeta, loadMetricsByYear, loadSites, probeImage } from './data/load'
import { METRIC_KEYS, type Candidates, type Meta, type MetricKey, type Site } from './data/types'
import { candidatesForYear, YEAR_COLUMNS, type MetricsByYear } from './data/years'
import { computeRange, type Range } from './map/colors'
import {
  computeScore, countPass, DEFAULT_WEIGHTS, normalizeAll, passMask as computePassMask, topN,
  type Bound, type Filters, type Norms, type RankedPoint, type Weights,
} from './rank'


export type LayerKey = 'points' | 'sites' | 'basemap' | 'slope' | 'illumination' | 'psr'
/** Raster layers from meta.layers.files; show only those whose files exist. */
export type RasterKey = 'basemap' | 'slope' | 'illumination' | 'psr'
export const RASTER_KEYS: readonly RasterKey[] = ['basemap', 'slope', 'illumination', 'psr']
/** Ranking mode (map colors and Top 10): combined score or a single metric. */
export type ColorKey = MetricKey | 'score'
export const COLOR_KEYS: readonly ColorKey[] = ['score', ...METRIC_KEYS]

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  points: true, sites: false, basemap: true, slope: false, illumination: false, psr: false,
}
const DEFAULT_COLOR_BY: ColorKey = 'score'
const DEFAULT_OVERLAY_OPACITY = 0.7
/** Translucent value field: terrain shows through. */
const DEFAULT_POINTS_OPACITY = 0.72

<<<<<<< HEAD
const LANG_STORAGE_KEY = 'lunar-navigator.lang'

function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY)
    if (v === 'en') return v
  } catch {
    // localStorage unavailable (private mode, Node tests): keep the default
  }
  return 'en'
}

=======
>>>>>>> dfed4845781ab7463b67f5bf6ff4317d84497b5d
export const TOP_N = 10
export const DEFAULT_NMS_RADIUS_KM = 5

export interface AppState {
  status: 'loading' | 'ready' | 'error'
  error: string | null
  meta: Meta | null
  /** Candidates with metrics for the selected `year`; used throughout the interface. */
  candidates: Candidates | null
  /** Unmodified candidates.bin (`candidates_period` year): validation and map positions. */
  baseCandidates: Candidates | null
  /** metrics_by_year.bin; null = single-year data, without a year selector. */
  byYear: MetricsByYear | null
  /** Metrics with data (power only from metrics_by_year Delivery 7+); other UI omits unavailable metrics. */
  metricKeys: readonly MetricKey[]
  /** Selected year (ranking, map, timeline); null = data without years. */
  year: number | null
  setYear: (year: number) => void
  sites: Site[]
  idToIndex: Map<number, number>
  /** Min/max for each metric, calculated once after loading. */
  ranges: Record<MetricKey, Range> | null
  /** Location A (first selected). */
  selectedIndex: number | null
  /** Location B for comparison; null = no comparison. */
  compareIndex: number | null
  /** Waiting for location B to be selected on the map. */
  picking: boolean
  /** Whether ranking colors are visible (initially terrain only; ranking appears after clicking). */
  rankingShown: boolean
  setRankingShown: (v: boolean) => void
  /** Point highlighted by hovering over Top 10; null = none. */
  hoverIndex: number | null
  setHoverIndex: (i: number | null) => void
  colorBy: ColorKey
  layers: Record<LayerKey, boolean>
  overlayOpacity: number
  pointsOpacity: number
  /** Raster files that exist (checked after loading metadata). */
  availableLayers: Record<RasterKey, boolean>

  // Ranking
  /** Metrics normalized to 0..1 (1 = best), calculated once after loading. */
  norms: Norms | null
  filters: Filters
  weights: Weights
  nmsRadiusKm: number
  score: Float32Array | null
  /** Score min/max (for the color scale when colorBy = 'score'). */
  scoreRange: Range | null
  passMask: Uint8Array | null
  passCount: number
  top: RankedPoint[]
  /** Map centering request; seq increases with each request. */
  focusRequest: { index: number; seq: number } | null

  load: () => Promise<void>
  /** null closes everything (A, B, and selection mode). */
  setSelectedIndex: (i: number | null) => void
  /** Select a point on the map/list: sets B in `picking` mode, otherwise A. */
  pickPoint: (i: number) => void
  startCompare: () => void
  cancelCompare: () => void
  closeSlot: (slot: 'a' | 'b') => void
  selectById: (id: number | null) => void
  setColorBy: (k: ColorKey) => void
  setLayerVisible: (k: LayerKey, visible: boolean) => void
  setOverlayOpacity: (v: number) => void
  setPointsOpacity: (v: number) => void
  /** Restore default weights, filters, layers, coloring, and opacity. */
  resetAdvanced: () => void
  setFilter: (k: MetricKey, bound: Bound | undefined) => void
  clearFilters: () => void
  setWeight: (k: MetricKey, w: number) => void
  setNmsRadius: (km: number) => void
  /** Select a point and center the map on it. */
  focusIndex: (i: number) => void
}

type RankInput = Pick<AppState,
  'candidates' | 'norms' | 'filters' | 'weights' | 'nmsRadiusKm' | 'score' | 'scoreRange' | 'passMask' | 'colorBy'>
type RankOutput = Pick<AppState, 'score' | 'scoreRange' | 'passMask' | 'passCount' | 'top'>

/** Recalculate only values affected by changed inputs. */
function recompute(s: RankInput, what: { score?: boolean; mask?: boolean }): RankOutput {
  const c = s.candidates
  if (!c || !s.norms) return { score: null, scoreRange: null, passMask: null, passCount: 0, top: [] }
  const fresh = what.score || !s.score
  const score = fresh ? computeScore(s.norms, s.weights, c.n) : s.score!
  const mask = what.mask || !s.passMask ? computePassMask(c, s.filters) : s.passMask
  // Top 10 for the selected mode: combined score or a single metric (normalized, 1 = best).
  const rankBy = s.colorBy === 'score' ? score : s.norms[s.colorBy]
  const top = topN(rankBy, mask, c.col.x_m, c.col.y_m, { n: TOP_N, radiusKm: s.nmsRadiusKm })
  const scoreRange = fresh || !s.scoreRange ? computeRange(score) : s.scoreRange
  return { score, scoreRange, passMask: mask, passCount: countPass(mask), top }
}

/** Metric min/max; annual metrics span all years so colors remain comparable across years. */
function metricRanges(c: Candidates, mby: MetricsByYear | null): Record<MetricKey, Range> {
  const ranges = {} as Record<MetricKey, Range>
  for (const k of METRIC_KEYS) ranges[k] = computeRange(c.col[k])
  if (mby) {
    for (const k of YEAR_COLUMNS) {
      if (k === 'power_fixed_az_deg') continue
      const cols = mby.cols[k]
      if (!cols) continue
      ranges[k] = cols.map(computeRange).reduce((a, b) => ({ min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) }))
    }
  }
  return ranges
}

/** Selected point destination: B in selection mode (never identical to A), otherwise A. */
function pickInto(s: Pick<AppState, 'picking' | 'selectedIndex'>, i: number): Partial<AppState> {
  if (!s.picking) return { selectedIndex: i }
  return i === s.selectedIndex ? { picking: false } : { compareIndex: i, picking: false }
}

export const useStore = create<AppState>()((set, get) => ({
  status: 'loading',
  error: null,
  meta: null,
  candidates: null,
  baseCandidates: null,
  byYear: null,
  metricKeys: METRIC_KEYS.filter((k) => !k.startsWith('power_')),
  year: null,
  setYear: (year) => {
    const s = get()
    if (!s.baseCandidates || !s.byYear || !s.byYear.years.includes(year) || year === s.year) return
    const candidates = candidatesForYear(s.baseCandidates, s.byYear, year)
    const norms = normalizeAll(candidates)
    set({ year, candidates, norms, ...recompute({ ...s, candidates, norms }, { score: true, mask: true }) })
  },
  sites: [],
  idToIndex: new Map(),
  ranges: null,
  selectedIndex: null,
  compareIndex: null,
  picking: false,
  rankingShown: false,
  setRankingShown: (rankingShown) => set({ rankingShown }),
  hoverIndex: null,
  setHoverIndex: (hoverIndex) => set({ hoverIndex }),
  colorBy: DEFAULT_COLOR_BY,
  layers: { ...DEFAULT_LAYERS },
  overlayOpacity: DEFAULT_OVERLAY_OPACITY,
  pointsOpacity: DEFAULT_POINTS_OPACITY,
  availableLayers: { basemap: false, slope: false, illumination: false, psr: false },

  norms: null,
  filters: {},
  weights: { ...DEFAULT_WEIGHTS },
  nmsRadiusKm: DEFAULT_NMS_RADIUS_KM,
  score: null,
  scoreRange: null,
  passMask: null,
  passCount: 0,
  top: [],
  focusRequest: null,

  load: async () => {
    set({ status: 'loading', error: null })
    try {
      const meta = await loadMeta()
      const files = meta.layers.files
      const [baseCandidates, byYear, sites, ...avail] = await Promise.all([
        loadCandidates(meta), loadMetricsByYear(meta), loadSites(), ...RASTER_KEYS.map((k) => probeImage(files[k])),
      ])
      // Start with the first metrics_by_year year (the one covered by candidates.bin).
      const year = byYear?.years[0] ?? null
      const candidates = candidatesForYear(baseCandidates, byYear, year)
      const availableLayers = {} as Record<RasterKey, boolean>
      RASTER_KEYS.forEach((k, i) => { availableLayers[k] = avail[i] === true })
      const ranges = metricRanges(candidates, byYear)
      const metricKeys = METRIC_KEYS.filter((k) => (k !== 'power_track_wm2' && k !== 'power_fixed_wm2') || byYear?.cols[k] !== undefined)
      const norms = normalizeAll(candidates)
      const rank = recompute({ ...get(), candidates, norms }, { score: true, mask: true })
      set({
        status: 'ready', meta, candidates, baseCandidates, byYear, metricKeys, year, sites, ranges, norms, availableLayers, ...rank,
        idToIndex: buildIdToIndex(baseCandidates), selectedIndex: null, compareIndex: null, picking: false,
      })
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
  setSelectedIndex: (i) => set(i === null
    ? { selectedIndex: null, compareIndex: null, picking: false }
    : { selectedIndex: i }),
  pickPoint: (i) => set((s) => pickInto(s, i)),
  startCompare: () => set((s) => (s.selectedIndex === null ? {} : { picking: true })),
  cancelCompare: () => set({ picking: false }),
  closeSlot: (slot) => set((s) => (slot === 'a'
    ? { selectedIndex: s.compareIndex, compareIndex: null, picking: false }
    : { compareIndex: null, picking: false })),
  selectById: (id) => {
    if (id === null) return get().setSelectedIndex(null)
    const i = get().idToIndex.get(id)
    if (i !== undefined) get().pickPoint(i)
  },
  setColorBy: (k) => set({ colorBy: k, ...recompute({ ...get(), colorBy: k }, {}) }),
  setLayerVisible: (k, visible) => set((s) => ({ layers: { ...s.layers, [k]: visible } })),
  setOverlayOpacity: (v) => set({ overlayOpacity: Math.min(1, Math.max(0, v)) }),
  setPointsOpacity: (v) => set({ pointsOpacity: Math.min(1, Math.max(0.1, v)) }),
  resetAdvanced: () => {
    const reset = {
      filters: {}, weights: { ...DEFAULT_WEIGHTS }, nmsRadiusKm: DEFAULT_NMS_RADIUS_KM,
    }
    set({
      ...reset,
      layers: { ...DEFAULT_LAYERS },
      overlayOpacity: DEFAULT_OVERLAY_OPACITY,
      pointsOpacity: DEFAULT_POINTS_OPACITY,
      colorBy: DEFAULT_COLOR_BY,
      ...recompute({ ...get(), ...reset, colorBy: DEFAULT_COLOR_BY }, { score: true, mask: true }),
    })
  },

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
    ...pickInto(s, i),
    focusRequest: { index: i, seq: (s.focusRequest?.seq ?? 0) + 1 },
  })),
}))
