import type { MetricKey } from '../data/types'
import { METRIC_META } from '../rank/metrics'
import { useStore } from '../store'
import { fmtNum } from './format'

const FILTER_DEFS: readonly { key: MetricKey; bound: 'min' | 'max' }[] = [
  { key: 'sun_pct', bound: 'min' },
  { key: 'longest_night_h', bound: 'max' },
  { key: 'earth_pct', bound: 'min' },
  { key: 'longest_comm_gap_h', bound: 'max' },
  { key: 'slope_deg', bound: 'max' },
  { key: 'dist_psr_km', bound: 'max' },
]
const SLIDER_STEPS = 200

function FilterSlider({ k, bound }: { k: MetricKey; bound: 'min' | 'max' }) {
  const range = useStore((s) => s.ranges?.[k])
  const value = useStore((s) => s.filters[k]?.[bound])
  const setFilter = useStore((s) => s.setFilter)
  if (!range) return null
  const meta = METRIC_META[k]
  const neutral = bound === 'min' ? range.min : range.max
  const step = range.max > range.min ? (range.max - range.min) / SLIDER_STEPS : 1
  const shown = value ?? neutral
  return (
    <label className="row filter">
      <span>{bound === 'min' ? 'min' : 'max'} {meta.label} [{meta.unit}]</span>
      <input type="range" min={range.min} max={range.max} step={step} value={shown}
        onChange={(e) => {
          const v = Number(e.target.value)
          // Suwak na skraju = filtr wyłączony (nie odrzuca też punktów bez danych).
          const atNeutral = bound === 'min' ? v <= range.min : v >= range.max
          setFilter(k, atNeutral ? undefined : { [bound]: v })
        }} />
      <span className={value === undefined ? 'muted' : ''}>{value === undefined ? 'wył.' : fmtNum(value)}</span>
    </label>
  )
}

export function FiltersPanel() {
  const passCount = useStore((s) => s.passCount)
  const n = useStore((s) => s.candidates?.n ?? 0)
  const clearFilters = useStore((s) => s.clearFilters)
  const active = useStore((s) => Object.keys(s.filters).length > 0)
  return (
    <section>
      <h2>Filtry</h2>
      {FILTER_DEFS.map((d) => <FilterSlider key={d.key} k={d.key} bound={d.bound} />)}
      <div className="row">
        <button type="button" onClick={clearFilters} disabled={!active}>Wyczyść</button>
        <span>{passCount} z {n} punktów spełnia</span>
      </div>
    </section>
  )
}
