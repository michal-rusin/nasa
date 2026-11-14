import type { MetricKey } from '../data/types'
import { METRIC_META } from '../rank/metrics'
import { useStore } from '../store'
import { fmtNum } from './format'

const KEY_METRICS: readonly MetricKey[] = ['sun_pct', 'longest_night_h', 'slope_deg']

export function TopList() {
  const top = useStore((s) => s.top)
  const candidates = useStore((s) => s.candidates)
  const selected = useStore((s) => s.selectedIndex)
  const focusIndex = useStore((s) => s.focusIndex)
  if (!candidates) return null
  return (
    <section>
      <h2>Top {top.length}</h2>
      {top.length === 0 ? <p className="muted">Żaden punkt nie spełnia filtrów.</p> : (
        <ol className="top-list">
          {top.map((p, rank) => (
            <li key={p.index}>
              <button type="button" className={p.index === selected ? 'active' : ''}
                onClick={() => focusIndex(p.index)}>
                <strong>#{rank + 1}</strong>{' '}
                id {candidates.col.id[p.index]} · score {p.score.toFixed(3)}
                <span className="muted">
                  {KEY_METRICS.map((k) =>
                    ` · ${METRIC_META[k].label} ${fmtNum(candidates.col[k][p.index] ?? NaN)} ${METRIC_META[k].unit}`)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
