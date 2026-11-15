import 'ol/ol.css'
import { useEffect, useMemo, useRef } from 'react'
import { isMockSite } from '../app/sites'
import { useT } from '../i18n'
import { useStore } from '../store'
import { createMap } from './createMap'

export function MapView() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const meta = useStore((s) => s.meta)
  // Point positions do not depend on the year: changing years does not recreate the map.
  const candidates = useStore((s) => s.baseCandidates)
  const allSites = useStore((s) => s.sites)
  // Test entries marked [MOCK] are excluded from the product map.
  const sites = useMemo(() => allSites.filter((s) => !isMockSite(s)), [allSites])

  useEffect(() => {
    if (!ref.current || !meta || !candidates) return
    try {
      return createMap(ref.current, meta, candidates, sites)
    } catch (e) {
      useStore.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      return undefined
    }
  }, [meta, candidates, sites])

  // tabIndex: OpenLayers listens for keys (arrows, +/-) on the map target element.
  return <div ref={ref} className="map starfield" tabIndex={0} role="application" aria-label={t('sp.mapAria')} />
}
