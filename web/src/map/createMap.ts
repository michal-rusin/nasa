// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import OlMap from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls } from 'ol/control/defaults'
import DragPan from 'ol/interaction/DragPan'
import { defaults as defaultInteractions } from 'ol/interaction/defaults'
import MouseWheelZoom from 'ol/interaction/MouseWheelZoom'
import type { Extent } from 'ol/extent'
import ImageLayer from 'ol/layer/Image'
import { get as getProjection, type Projection } from 'ol/proj'
import { register } from 'ol/proj/proj4'
import ImageStatic from 'ol/source/ImageStatic'
import { getRenderPixel } from 'ol/render'
import type RenderEvent from 'ol/render/Event'
import proj4 from 'proj4'
import { dataUrl, getProjString } from '../data/load'
import type { Candidates, Meta, Site } from '../data/types'
import { fmtCoord } from '../app/coords'
import { fill, t } from '../i18n'
import { METRIC_META } from '../rank/metrics'
import { useStore, type AppState, type RasterKey } from '../store'
import { nearestPoint } from './nearestPoint'
import { badgeRadiusPx, createPointsLayer } from './PointsLayer'
import { latitudeRadiusM } from './projection'
import { createSitesLayer, SITE_INDEX_PROP } from './sitesLayer'
import { MODE_THEMES } from './themes'
import { candidatesRange, isEternalShadow, yearHours } from '../data/years'

export const PROJ_CODE = 'MOON_SP'
/** Maximum zoom (m/px); basemap resolution is ~90 m/px, DEM close to 80 m/px. */
const MIN_RESOLUTION_M = 15
/** Jumping to a point zooms in to at least this resolution. */
const FOCUS_RESOLUTION_M = 180
const CLICK_RADIUS_PX = 10
const HOVER_RADIUS_PX = 8
const SITE_HIT_TOLERANCE_PX = 6
/** Top 10 badges capture the cursor slightly beyond their circle. */
const BADGE_HIT_PAD_PX = 3
/** At resolution ≥ maxResolution × this factor, the map is zoomed out and cannot be panned. */
const ZOOMED_OUT = 0.985
const OVERLAY_KEYS = ['slope', 'illumination', 'psr'] as const satisfies readonly RasterKey[]

/**
 * Registers the raster CRS in proj4 and OpenLayers. Data (x_m, y_m) are already
 * in meters in this CRS, so no lat/lon conversion is needed.
 */
export function registerMoonProjection(meta: Meta): Projection {
  proj4.defs(PROJ_CODE, getProjString(meta))
  register(proj4)
  const proj = getProjection(PROJ_CODE)
  if (!proj) throw new Error(`Failed to register coordinate system ${PROJ_CODE}`)
  proj.setExtent(boundsExtent(meta))
  return proj
}

export function boundsExtent(meta: Meta): Extent {
  const b = meta.layers.bounds_m
  return [b.min_x, b.min_y, b.max_x, b.max_y]
}

/** Fast start, long smooth deceleration (like iOS scrolling). */
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5)
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Creates a map in the container and connects it to the store. Returns a cleanup function. */
export function createMap(
  target: HTMLElement,
  meta: Meta,
  candidates: Candidates,
  sites: Site[],
): () => void {
  const projection = registerMoonProjection(meta)
  const extent = boundsExtent(meta)
  const regionR = latitudeRadiusM(getProjString(meta), meta.moon_radius_km * 1000, meta.region.lat_max)

  // The entire region circle fits in the view with a small margin.
  const pad = regionR * 0.08
  const fitResolution = () => {
    const cw = Math.max(1, target.clientWidth)
    const ch = Math.max(1, target.clientHeight)
    return ((2 * regionR) / Math.min(cw, ch)) * 1.08
  }
  let maxResolution = fitResolution()
  // Constrain the entire viewport (not just its center) to the square around the circle:
  // the fully zoomed-out map stays fixed; panning becomes available after zooming in.
  const makeView = (maxRes: number, center: number[], resolution: number) => new View({
    projection,
    center,
    resolution: Math.min(maxRes, resolution),
    maxResolution: maxRes,
    minResolution: MIN_RESOLUTION_M,
    extent: [-regionR - pad, -regionR - pad, regionR + pad, regionR + pad],
    showFullExtent: true,
    constrainOnlyCenter: false,
    smoothExtentConstraint: true,
  })
  let view = makeView(maxResolution, [0, 0], maxResolution)

  const s0 = useStore.getState()
  const avail = s0.availableLayers
  const files = meta.layers.files
  const imageLayer = (file: string, zIndex: number, visible: boolean, opacity = 1) =>
    new ImageLayer({
      source: new ImageStatic({ url: dataUrl(file), imageExtent: extent, projection }),
      zIndex,
      visible,
      opacity,
    })

  // Clip rasters to the region circle on the canvas (clip in prerender, restore in postrender).
  // Previously a vector polygon with a hole masked them, but the vector layer does not redraw
  // during animations, exposing a strip of basemap outside the circle when panning.
  const clipToRegion = (e: RenderEvent) => {
    const c = e.context
    if (!(c instanceof CanvasRenderingContext2D)) return
    // getRenderPixel takes a viewport CSS pixel, not a map coordinate.
    const po = map.getPixelFromCoordinate([0, 0])
    const pe = map.getPixelFromCoordinate([regionR, 0])
    c.save() // always save so postrender has a state to restore
    if (!po || !pe) return
    const o = getRenderPixel(e, po)
    const edge = getRenderPixel(e, pe)
    c.beginPath()
    c.arc(o[0]!, o[1]!, Math.hypot(edge[0]! - o[0]!, edge[1]! - o[1]!), 0, 2 * Math.PI)
    c.clip()
  }
  const restoreClip = (e: RenderEvent) => {
    if (e.context instanceof CanvasRenderingContext2D) e.context.restore()
  }
  const clipped = (layer: ImageLayer<ImageStatic>) => {
    layer.on('prerender', clipToRegion)
    layer.on('postrender', restoreClip)
    return layer
  }

  // Missing file (e.g. dev server returns HTML): do not create the layer.
  const basemap = avail.basemap ? clipped(imageLayer(files.basemap, 0, s0.layers.basemap)) : null
  const overlays: Partial<Record<(typeof OVERLAY_KEYS)[number], ImageLayer<ImageStatic>>> = {}
  OVERLAY_KEYS.forEach((k, i) => {
    if (avail[k]) overlays[k] = clipped(imageLayer(files[k], 10 + i, s0.layers[k], s0.overlayOpacity))
  })

  const cx = candidates.col.x_m
  const cy = candidates.col.y_m
  const points = createPointsLayer(cx, cy, regionR, candidates.col.level)
  const sitesLayer = createSitesLayer(sites)

  // Mouse wheel zooms the map, but when fully zoomed out (or the page is
  // scrolled down), it scrolls the page instead of getting trapped on the map.
  const page = target.closest<HTMLElement>('.sp-page')
  const isZoomedOut = () => (map.getView().getResolution() ?? maxResolution) >= maxResolution * ZOOMED_OUT
  const wheelZoom = new MouseWheelZoom({
    condition: (e) => {
      const we = e.originalEvent
      if (!(we instanceof WheelEvent)) return true
      if (we.ctrlKey || we.metaKey) return true // touchpad pinch gesture
      if (page && page.scrollTop > 4) return false
      return !(we.deltaY > 0 && isZoomedOut())
    },
  })
  const dragPan = new DragPan()
  const interactions = defaultInteractions({ mouseWheelZoom: false, dragPan: false })
  interactions.push(dragPan)
  interactions.push(wheelZoom)

  const map = new OlMap({
    target,
    view,
    layers: [
      ...(basemap ? [basemap] : []),
      ...Object.values(overlays),
      points.layer, sitesLayer,
    ],
    controls: defaultControls({ attribution: false, rotate: false }),
    interactions,
  })

  // Point tooltip (HTML rather than canvas: readable text, does not capture pointer events).
  const tooltip = document.createElement('div')
  tooltip.className = 'map-tooltip'
  tooltip.setAttribute('aria-hidden', 'true')
  tooltip.hidden = true
  const vp = map.getViewport()
  if (!vp) throw new Error('OpenLayers did not create a viewport')
  const viewport: HTMLElement = vp
  viewport.appendChild(tooltip)

  // Zoomed-out map: no dragging; touch gestures scroll the page instead of panning the map.
  function syncPan(): void {
    const out = isZoomedOut()
    dragPan.setActive(!out)
    viewport.style.touchAction = out ? 'pan-y' : 'none'
    target.classList.toggle('zoomed-out', out)
  }
  map.on('moveend', syncPan)
  syncPan()

  function applyStyle(s: AppState): void {
    const k = s.colorBy
    const values = k === 'score' ? s.score : (s.candidates ?? candidates).col[k]
    const range = k === 'score' ? s.scoreRange : s.ranges?.[k]
    if (!values || !range) return
    points.setStyle({
      values,
      range,
      invert: k !== 'score' && METRIC_META[k].direction === 'low',
      mask: s.passMask,
      top: s.top.map((p) => p.index),
      selectedIndex: s.selectedIndex,
      compareIndex: s.compareIndex,
      theme: MODE_THEMES[k],
    })
  }
  function focus(i: number): void {
    const x = cx[i]
    const y = cy[i]
    if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return
    view = map.getView()
    const res = view.getResolution() ?? maxResolution
    const resolution = Math.min(res, FOCUS_RESOLUTION_M)
    if (prefersReducedMotion()) {
      view.setCenter([x, y])
      view.setResolution(resolution)
    } else {
      view.animate({ center: [x, y], resolution, duration: 700, easing: easeOutQuint })
    }
  }
  function applyLayers(s: AppState): void {
    basemap?.setVisible(s.layers.basemap)
    for (const k of OVERLAY_KEYS) {
      overlays[k]?.setVisible(s.layers[k])
      overlays[k]?.setOpacity(s.overlayOpacity)
    }
    points.layer.setVisible(s.layers.points)
    points.setOpacity(s.pointsOpacity)
    sitesLayer.setVisible(s.layers.sites)
  }
  applyStyle(s0)
  applyLayers(s0)
  points.setRevealed(s0.rankingShown)

  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.colorBy !== prev.colorBy || s.selectedIndex !== prev.selectedIndex || s.compareIndex !== prev.compareIndex || s.ranges !== prev.ranges
      || s.candidates !== prev.candidates
      || s.passMask !== prev.passMask || s.top !== prev.top || s.score !== prev.score) {
      applyStyle(s)
    }
    if (s.focusRequest && s.focusRequest !== prev.focusRequest) focus(s.focusRequest.index)
    if (s.layers !== prev.layers || s.overlayOpacity !== prev.overlayOpacity
      || s.pointsOpacity !== prev.pointsOpacity) applyLayers(s)
    if (s.picking !== prev.picking) target.classList.toggle('picking', s.picking)
    if (s.rankingShown !== prev.rankingShown) points.setRevealed(s.rankingShown)
    if (s.hoverIndex !== prev.hoverIndex) points.setHighlight(s.hoverIndex)
    // A filtered-out point under the cursor disappears, so hide its tooltip too.
    if (s.passMask !== prev.passMask) setHover(null)
  })

  /** Index of a visible point passing filters within radiusPx of the pixel. */
  function pick(coordinate: number[], radiusPx: number, pixel?: number[]): number {
    const store = useStore.getState()
    if (!store.layers.points) return -1
    const res = map.getView().getResolution() ?? maxResolution
    // Top 10 badges are larger than grid cells: test badge hits first.
    if (pixel && store.rankingShown) {
      let best = -1
      let bestD = Infinity
      store.top.forEach((p, rank) => {
        const q = map.getPixelFromCoordinate([cx[p.index]!, cy[p.index]!])
        if (!q) return
        const d = Math.hypot(q[0]! - pixel[0]!, q[1]! - pixel[1]!)
        if (d <= badgeRadiusPx(rank, res) + BADGE_HIT_PAD_PX && d < bestD) {
          best = p.index
          bestD = d
        }
      })
      if (best >= 0) return best
    }
    return nearestPoint(coordinate[0]!, coordinate[1]!, cx, cy, radiusPx * res, store.passMask)
  }

  function setHover(i: number | null, pixel?: number[]): void {
    points.setHover(i)
    viewport.style.cursor = i === null ? '' : 'pointer'
    if (i === null || !pixel) {
      tooltip.hidden = true
      return
    }
    const st = useStore.getState()
    const score = st.score?.[i]
    const rank = st.rankingShown ? st.top.findIndex((p) => p.index === i) : -1
    const coord = fmtCoord(candidates.col.lat[i], candidates.col.lon[i], 2, t('na'))
    const sc = score === undefined || Number.isNaN(score) ? t('na') : score.toFixed(3)
    const curC = st.candidates ?? candidates
    const yearH = st.year !== null ? yearHours(st.year) : (candidatesRange(meta).len * meta.step_s) / 3600
    const shadow = isEternalShadow(curC.col.sun_pct[i], curC.col.longest_night_h[i], yearH)
      ? ` · ${t('shadow.short')}` : ''
    tooltip.replaceChildren()
    tooltip.classList.toggle('rich', rank >= 0)
    if (rank >= 0) {
      // Top locations: a card with rank and key figures.
      const head = document.createElement('div')
      head.className = 'tt-head'
      const r = document.createElement('span')
      r.className = 'tt-rank'
      r.style.color = MODE_THEMES[st.colorBy].accent
      r.textContent = `#${rank + 1}`
      const c = document.createElement('span')
      c.textContent = coord
      head.append(r, c)
      const body = document.createElement('div')
      body.className = 'tt-body'
      const cur = st.candidates ?? candidates
      const sun = cur.col.sun_pct[i]
      const night = cur.col.longest_night_h[i]
      body.textContent = fill(t('tooltip.top'), {
        s: sc,
        sun: sun === undefined || Number.isNaN(sun) ? t('na') : sun.toFixed(0),
        night: night === undefined || Number.isNaN(night) ? t('na') : night.toFixed(0),
      }) + shadow
      const hint = document.createElement('div')
      hint.className = 'tt-hint'
      hint.textContent = t('tooltip.open')
      tooltip.append(head, body, hint)
    } else {
      tooltip.textContent = (st.rankingShown ? fill(t('tooltip'), { c: coord, s: sc }) : coord) + shadow
    }
    tooltip.style.transform = `translate(${Math.round(pixel[0]!)}px, ${Math.round(pixel[1]!)}px)`
    tooltip.hidden = false
  }

  let hoverRaf = 0
  map.on('pointermove', (evt) => {
    const oe = evt.originalEvent
    if (evt.dragging || ('pointerType' in oe && oe.pointerType === 'touch')) {
      // While dragging, the tooltip must not remain attached to the old point.
      cancelAnimationFrame(hoverRaf)
      setHover(null)
      return
    }
    cancelAnimationFrame(hoverRaf)
    const { coordinate, pixel } = evt
    hoverRaf = requestAnimationFrame(() => {
      const i = pick(coordinate, HOVER_RADIUS_PX, pixel)
      setHover(i >= 0 ? i : null, pixel)
    })
  })
  const onLeave = () => {
    cancelAnimationFrame(hoverRaf)
    setHover(null)
  }
  viewport.addEventListener('pointerleave', onLeave)

  map.on('singleclick', (evt) => {
    const store = useStore.getState()
    // 1) Sites (markers) take priority.
    let siteIndex: number | null = null
    map.forEachFeatureAtPixel(evt.pixel, (f) => {
      const v: unknown = f.get(SITE_INDEX_PROP)
      if (typeof v === 'number') {
        siteIndex = v
        return true
      }
      return undefined
    }, { hitTolerance: SITE_HIT_TOLERANCE_PX, layerFilter: (l) => l === sitesLayer })
    if (siteIndex !== null) {
      const site = sites[siteIndex]
      if (site && site.nearest_candidate_id !== null) store.selectById(site.nearest_candidate_id)
      return
    }
    // 2) Nearest visible grid point (10 px, or any distance when zoomed in). Clicking empty space closes nothing:
    // site cards sit below the map and are closed with the X button or Esc.
    // When zoomed in, grid points are far apart on screen, so a click anywhere snaps to the
    // nearest visible point (unlimited distance). Fully zoomed out, the 10 px limit stays,
    // so clicking the dark space around the circle does nothing.
    let i = pick(evt.coordinate, CLICK_RADIUS_PX, evt.pixel)
    if (i < 0 && !isZoomedOut()) i = pick(evt.coordinate, Infinity)
    if (i >= 0) {
      setHover(null)
      store.pickPoint(i)
    }
  })

  // Window resize: update the zoom-out limit so the entire circle always fits in view.
  const resizeObserver = new ResizeObserver(() => {
    map.updateSize()
    const next = fitResolution()
    if (Math.abs(next - maxResolution) / maxResolution < 0.01) return
    const old = map.getView()
    const wasOut = isZoomedOut()
    maxResolution = next
    view = makeView(next, wasOut ? [0, 0] : (old.getCenter() ?? [0, 0]), wasOut ? next : (old.getResolution() ?? next))
    map.setView(view)
    syncPan()
  })
  resizeObserver.observe(target)

  return () => {
    points.dispose()
    resizeObserver.disconnect()
    target.classList.remove('picking')
    cancelAnimationFrame(hoverRaf)
    unsubscribe()
    viewport.removeEventListener('pointerleave', onLeave)
    tooltip.remove()
    map.setTarget(undefined)
    map.dispose()
  }
}
