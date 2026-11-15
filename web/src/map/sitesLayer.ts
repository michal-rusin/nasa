// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

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

/** Feature property key holding the site index in the sites array. */
export const SITE_INDEX_PROP = 'siteIndex'

const styleCache = new Map<string, Style>()

function siteStyle(site: Site): Style {
  const key = `${site.category}|${site.name}`
  let s = styleCache.get(key)
  if (!s) {
    s = new Style({
      image: new Circle({
        radius: 4.5,
        fill: new Fill({ color: categoryColor(site.category) }),
        stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.85)', width: 1.5 }),
      }),
      text: new Text({
        text: site.name,
        font: '500 11.5px "Inter Variable", system-ui, sans-serif',
        offsetY: -12,
        fill: new Fill({ color: 'rgba(255, 255, 255, 0.92)' }),
        stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.85)', width: 3 }),
        // OL hides overlapping labels (they reappear when zooming in).
        overflow: false,
      }),
    })
    styleCache.set(key, s)
  }
  return s
}

/**
 * One Feature per site, only for sites with an (x_m, y_m) position.
 * Coordinates come directly from the file: already in raster CRS meters.
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
  return new VectorLayer({ source: new VectorSource({ features }), zIndex: 30, declutter: true })
}
