import OlMap from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls } from 'ol/control/defaults'
import { buffer, getHeight, getWidth, type Extent } from 'ol/extent'
import ImageLayer from 'ol/layer/Image'
import { get as getProjection, type Projection } from 'ol/proj'
import { register } from 'ol/proj/proj4'
import ImageStatic from 'ol/source/ImageStatic'
import proj4 from 'proj4'
import { dataUrl, getProjString } from '../data/load'
import type { Candidates, Meta, Site } from '../data/types'
import { useStore, type AppState, type LayerKey } from '../store'
import { nearestPoint } from './nearestPoint'
import { createPointsLayer } from './PointsLayer'
import { createSitesLayer, SITE_INDEX_PROP } from './sitesLayer'

export const PROJ_CODE = 'MOON_SP'
const MIN_RESOLUTION_M = 5
const CLICK_RADIUS_PX = 10
const SITE_HIT_TOLERANCE_PX = 6
const OVERLAY_KEYS = ['slope', 'illumination', 'psr'] as const satisfies readonly LayerKey[]

/**
 * Rejestruje CRS rastrów w proj4 i OpenLayers. Dane (x_m, y_m) są już
 * w metrach tego CRS, więc niczego nie przeliczamy z lat/lon.
 */
export function registerMoonProjection(meta: Meta): Projection {
  proj4.defs(PROJ_CODE, getProjString(meta))
  register(proj4)
  const proj = getProjection(PROJ_CODE)
  if (!proj) throw new Error(`Nie udało się zarejestrować układu ${PROJ_CODE}`)
  proj.setExtent(boundsExtent(meta))
  return proj
}

export function boundsExtent(meta: Meta): Extent {
  const b = meta.layers.bounds_m
  return [b.min_x, b.min_y, b.max_x, b.max_y]
}

/** Tworzy mapę w kontenerze i podpina ją pod store. Zwraca funkcję sprzątającą. */
export function createMap(
  target: HTMLElement,
  meta: Meta,
  candidates: Candidates,
  sites: Site[],
): () => void {
  const projection = registerMoonProjection(meta)
  const extent = boundsExtent(meta)
  const W = getWidth(extent)
  const H = getHeight(extent)

  // Cały region mieści się w widoku z ~10% zapasem.
  const cw = Math.max(1, target.clientWidth)
  const ch = Math.max(1, target.clientHeight)
  const maxResolution = Math.max(W / cw, H / ch) * 1.1

  const view = new View({
    projection,
    center: [(extent[0]! + extent[2]!) / 2, (extent[1]! + extent[3]!) / 2],
    resolution: maxResolution,
    maxResolution,
    minResolution: MIN_RESOLUTION_M,
    extent: buffer(extent, Math.max(W, H) * 0.1),
    showFullExtent: true,
  })

  const imageLayer = (file: string, zIndex: number, visible: boolean, opacity = 1) =>
    new ImageLayer({
      source: new ImageStatic({ url: dataUrl(file), imageExtent: extent, projection }),
      zIndex,
      visible,
      opacity,
    })

  const s0 = useStore.getState()
  const files = meta.layers.files
  const basemap = imageLayer(files.basemap, 0, true)
  const overlays = {
    slope: imageLayer(files.slope, 10, s0.layers.slope, s0.overlayOpacity),
    illumination: imageLayer(files.illumination, 11, s0.layers.illumination, s0.overlayOpacity),
    psr: imageLayer(files.psr, 12, s0.layers.psr, s0.overlayOpacity),
  }

  const cx = candidates.col.x_m
  const cy = candidates.col.y_m
  const points = createPointsLayer(cx, cy)
  points.layer.setVisible(s0.layers.points)
  const sitesLayer = createSitesLayer(sites)
  sitesLayer.setVisible(s0.layers.sites)

  const map = new OlMap({
    target,
    view,
    layers: [basemap, overlays.slope, overlays.illumination, overlays.psr, points.layer, sitesLayer],
    controls: defaultControls({ attribution: false, rotate: false }),
  })

  function applyStyle(s: AppState): void {
    const range = s.ranges?.[s.colorBy]
    if (!range) return
    points.setStyle({ values: candidates.col[s.colorBy], range, selectedIndex: s.selectedIndex })
  }
  function applyLayers(s: AppState): void {
    for (const k of OVERLAY_KEYS) {
      const layer = overlays[k]
      layer.setVisible(s.layers[k])
      layer.setOpacity(s.overlayOpacity)
    }
    points.layer.setVisible(s.layers.points)
    sitesLayer.setVisible(s.layers.sites)
  }
  applyStyle(s0)
  applyLayers(s0)

  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.colorBy !== prev.colorBy || s.selectedIndex !== prev.selectedIndex || s.ranges !== prev.ranges) {
      applyStyle(s)
    }
    if (s.layers !== prev.layers || s.overlayOpacity !== prev.overlayOpacity) applyLayers(s)
  })

  map.on('singleclick', (evt) => {
    const store = useStore.getState()
    // 1) Miejsca (markery) mają pierwszeństwo.
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
      const site = store.sites[siteIndex]
      if (site && site.nearest_candidate_id !== null) store.selectById(site.nearest_candidate_id)
      return
    }
    // 2) Najbliższy punkt siatki w promieniu 10 px.
    if (!store.layers.points) return
    const res = view.getResolution() ?? maxResolution
    const [x, y] = evt.coordinate
    const i = nearestPoint(x!, y!, cx, cy, CLICK_RADIUS_PX * res)
    store.setSelectedIndex(i >= 0 ? i : null)
  })

  return () => {
    unsubscribe()
    map.setTarget(undefined)
    map.dispose()
  }
}
