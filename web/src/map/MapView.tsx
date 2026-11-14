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
  const candidates = useStore((s) => s.candidates)
  const allSites = useStore((s) => s.sites)
  // Wpisy testowe „[MOCK]” nie trafiają na mapę produktu.
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

  // tabIndex: OpenLayers nasłuchuje klawiszy (strzałki, +/-) na elemencie docelowym mapy.
  return <div ref={ref} className="map starfield" tabIndex={0} role="application" aria-label={t('sp.mapAria')} />
}
