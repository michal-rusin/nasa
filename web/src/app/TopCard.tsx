import { useState, type CSSProperties } from 'react'
import { MODE_THEMES } from '../map/themes'
import type { MetricKey } from '../data/types'
import { fill, useT } from '../i18n'
import { METRIC_META } from '../rank/metrics'
import { useStore } from '../store'
import { fmtCoord } from './coords'
import { fmtVal, METRIC_DIGITS } from './format'

const KEY_METRICS: readonly MetricKey[] = ['sun_pct', 'longest_night_h', 'slope_deg']
const MOBILE_QUERY = '(max-width: 720px)'

/** Karta „Top 10”: zwijana; klik w pozycję centruje mapę i otwiera panel punktu. */
export function TopCard() {
  const t = useT()
  const top = useStore((s) => s.top)
  const colorBy = useStore((s) => s.colorBy)
  const year = useStore((s) => s.year)
  const candidates = useStore((s) => s.candidates)
  const selected = useStore((s) => s.selectedIndex)
  const focusIndex = useStore((s) => s.focusIndex)
  const setHoverIndex = useStore((s) => s.setHoverIndex)
  const clearFilters = useStore((s) => s.clearFilters)
  const setRankingShown = useStore((s) => s.setRankingShown)
  const passCount = useStore((s) => s.passCount)
  const filtered = useStore((s) => Object.keys(s.filters).length > 0)
  // Na telefonie karta startuje zwinięta, żeby nie zasłaniać mapy.
  const [open, setOpen] = useState(() => typeof matchMedia !== 'function' || !matchMedia(MOBILE_QUERY).matches)
  if (!candidates) return null
  const na = t('na')

  return (
    <section className={`top-card glass${open ? ' open' : ''}`} data-tour="top" aria-labelledby="top-card-title"
      style={{ '--mode': MODE_THEMES[colorBy].accent } as CSSProperties}>
      <div className="top-headrow">
        <button type="button" className="top-head" aria-expanded={open} aria-controls="top-card-body"
          title={t('top.toggle')} onClick={() => setOpen(!open)}>
          <h2 id="top-card-title">{t('top.title')} <span className="top-mode">{t(`modeFull.${colorBy}`)}{year !== null && ` · ${year}`}</span></h2>
          <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        {/* Zamyka ranking: mapa wraca do samej rzeźby terenu, wraca karta „Gdzie wylądować?”. */}
        <button type="button" className="icon-btn top-close" aria-label={t('top.close')} title={t('top.close')}
          onClick={() => setRankingShown(false)}>×</button>
      </div>
      <div id="top-card-body" className="top-body" hidden={!open}>
        {filtered && <p className="top-pass">{fill(t('top.pass'), { n: passCount, total: candidates.n })}</p>}
        {top.length === 0 ? (
          <div className="empty">
            <p>{t('top.empty')}</p>
            <button type="button" className="btn" onClick={clearFilters}>{t('top.reset')}</button>
          </div>
        ) : (
          <ol className="top-list">
            {top.map((p, rank) => (
              <li key={p.index} style={{ '--i': rank } as React.CSSProperties}>
                <button type="button" aria-current={p.index === selected || undefined}
                  onMouseEnter={() => setHoverIndex(p.index)} onMouseLeave={() => setHoverIndex(null)}
                  onFocus={() => setHoverIndex(p.index)} onBlur={() => setHoverIndex(null)}
                  onClick={() => { setHoverIndex(null); focusIndex(p.index) }}>
                  <span className="top-rank">{rank + 1}</span>
                  <span className="top-main">
                    <span className="top-id">{fmtCoord(candidates.col.lat[p.index], candidates.col.lon[p.index], 2, na)}</span>
                    <span className="top-score">{colorBy === 'score'
                      ? `${t('top.score')} ${p.score.toFixed(3)}`
                      : `${fmtVal(candidates.col[colorBy][p.index], METRIC_DIGITS[colorBy], na)} ${METRIC_META[colorBy].unit}`}</span>
                  </span>
                  <span className="top-details">
                    {KEY_METRICS.map((k) =>
                      `${t(`metric.${k}`)} ${fmtVal(candidates.col[k][p.index], METRIC_DIGITS[k], na)} ${METRIC_META[k].unit}`,
                    ).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
