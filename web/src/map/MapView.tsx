import 'ol/ol.css'
import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { createMap } from './createMap'

export function MapView() {
  const ref = useRef<HTMLDivElement>(null)
  const meta = useStore((s) => s.meta)
  const candidates = useStore((s) => s.candidates)
  const sites = useStore((s) => s.sites)

  useEffect(() => {
    if (!ref.current || !meta || !candidates) return
    try {
      return createMap(ref.current, meta, candidates, sites)
    } catch (e) {
      useStore.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      return undefined
    }
  }, [meta, candidates, sites])

  return <div ref={ref} className="map" />
}
