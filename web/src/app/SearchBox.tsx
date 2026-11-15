import { useId, useMemo, useState } from 'react'
import { getProjString } from '../data/load'
import { fill, useT } from '../i18n'
import { nearestPoint } from '../map/nearestPoint'
import { latLonToXY } from '../map/projection'
import { useStore } from '../store'
import { fmtCoord } from './coords'
import { parseLatLon } from './latlon'
import { isMockSite } from './sites'

type Msg = { kind: 'ok' | 'error'; text: string } | null

/** “Jump to lat, lon”: center on the nearest visible candidate and open its panel. */
export function SearchBox() {
  const t = useT()
  const meta = useStore((s) => s.meta)
  const candidates = useStore((s) => s.candidates)
  const sites = useStore((s) => s.sites)
  const focusIndex = useStore((s) => s.focusIndex)
  // Named-site shortcuts are available only when their layer is enabled.
  const sitesShown = useStore((s) => s.layers.sites)
  const [value, setValue] = useState('')
  const [msg, setMsg] = useState<Msg>(null)
  const inputId = useId()
  const msgId = useId()
  const shortcuts = useMemo(
    () => sites.filter((s) => !isMockSite(s) && s.nearest_candidate_id !== null),
    [sites],
  )

  if (!meta || !candidates) return null
  const latMax = meta.region.lat_max

  function submit(): void {
    if (!meta || !candidates) return
    const p = parseLatLon(value)
    if (!p.ok) {
      setMsg({ kind: 'error', text: t(p.reason === 'range' ? 'search.errRange' : 'search.errFormat') })
      return
    }
    if (p.lat > latMax) {
      setMsg({ kind: 'error', text: fill(t('search.outside'), { min: Math.abs(latMax) }) })
      return
    }
    const [x, y] = latLonToXY(getProjString(meta), meta.moon_radius_km * 1000, p.lat, p.lon)
    const mask = useStore.getState().passMask
    const i = nearestPoint(x, y, candidates.col.x_m, candidates.col.y_m, Infinity, mask)
    if (i < 0) {
      setMsg({ kind: 'error', text: t('search.none') })
      return
    }
    const km = Math.hypot(candidates.col.x_m[i]! - x, candidates.col.y_m[i]! - y) / 1000
    focusIndex(i)
    setMsg({ kind: 'ok', text: fill(t('search.found'), { c: fmtCoord(candidates.col.lat[i], candidates.col.lon[i], 2, t('na')), km: km.toFixed(2) }) })
  }

  return (
    <div className="search glass">
      <form className="search-form" role="search" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <label htmlFor={inputId} className="search-label">{t('search.label')}</label>
        <div className="search-row">
          <input id={inputId} type="text" autoComplete="off" spellCheck={false}
            placeholder={t('search.placeholder')} value={value}
            aria-describedby={msgId}
            aria-invalid={msg?.kind === 'error' || undefined}
            onChange={(e) => { setValue(e.target.value); setMsg(null) }} />
          <button type="submit" className="btn">{t('search.go')}</button>
        </div>
      </form>
      <p id={msgId} className={`search-msg ${msg?.kind ?? ''}`} role="status" aria-live="polite" hidden={!msg}>
        {msg?.text ?? ''}
      </p>
      {sitesShown && shortcuts.length > 0 && (
        <div className="search-shortcuts" role="group" aria-label={t('search.shortcuts')}>
          {shortcuts.map((s) => (
            <button key={s.id} type="button" className="chip"
              onClick={() => {
                const i = useStore.getState().idToIndex.get(s.nearest_candidate_id!)
                if (i !== undefined) focusIndex(i)
              }}>{s.name}</button>
          ))}
        </div>
      )}
    </div>
  )
}
