import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { Circle, Fill, Stroke, Style, Text } from 'ol/style'
import type { Site } from '../data/types'

export const CATEGORY_COLORS: Record<string, string> = {
  artemis: '#ff7a3d',
  clps: '#3dc7ff',
  international: '#7cff6b',
  apollo: '#f5f5f5',
  reference: '#ff5fd2',
}
const FALLBACK_COLOR = '#bbbbbb'

export function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? FALLBACK_COLOR
}

/** Klucz właściwości Feature z indeksem miejsca w tablicy sites. */
export const SITE_INDEX_PROP = 'siteIndex'

const styleCache = new Map<string, Style>()

function siteStyle(site: Site): Style {
  const key = `${site.category}|${site.name}`
  let s = styleCache.get(key)
  if (!s) {
    s = new Style({
      image: new Circle({
        radius: 6,
        fill: new Fill({ color: categoryColor(site.category) }),
        stroke: new Stroke({ color: '#000000', width: 1.5 }),
      }),
      text: new Text({
        text: site.name,
        font: '12px system-ui, sans-serif',
        offsetY: -14,
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: '#000000', width: 3 }),
      }),
    })
    styleCache.set(key, s)
  }
  return s
}

/**
 * Jedna Feature na miejsce, tylko dla miejsc z pozycją (x_m, y_m).
 * Współrzędne biorę wprost z pliku: są już w metrach CRS rastrów.
 */
export function createSitesLayer(sites: Site[]): VectorLayer<VectorSource> {
  const features: Feature[] = []
  sites.forEach((site, i) => {
    if (site.x_m === null || site.y_m === null) return
    const f = new Feature({ geometry: new Point([site.x_m, site.y_m]) })
    f.set(SITE_INDEX_PROP, i)
    f.setStyle(siteStyle(site))
    features.push(f)
  })
  return new VectorLayer({ source: new VectorSource({ features }), zIndex: 30 })
}
