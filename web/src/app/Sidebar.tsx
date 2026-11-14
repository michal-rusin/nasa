import { COLUMN_NAMES, METRIC_KEYS, type MetricKey } from '../data/types'
import { rampCssGradient } from '../map/colors'
import { categoryColor } from '../map/sitesLayer'
import { METRIC_META } from '../rank/metrics'
import { useStore, type LayerKey } from '../store'
import { FiltersPanel } from './FiltersPanel'
import { TopList } from './TopList'
import { WeightsPanel } from './WeightsPanel'

const METRIC_LABELS: Record<MetricKey, string> = {
  sun_pct: 'Nasłonecznienie [%]',
  longest_night_h: 'Najdłuższa noc [h]',
  earth_pct: 'Widoczność Ziemi [%]',
  longest_comm_gap_h: 'Najdłuższa przerwa łączności [h]',
  slope_deg: 'Nachylenie [°]',
  dist_psr_km: 'Odległość do PSR [km]',
}

const LAYER_LABELS: Record<LayerKey, string> = {
  points: 'Punkty siatki',
  sites: 'Miejsca',
  slope: 'Nachylenie (raster)',
  illumination: 'Oświetlenie (raster)',
  psr: 'PSR (raster)',
}
const LAYER_ORDER: readonly LayerKey[] = ['points', 'sites', 'slope', 'illumination', 'psr']

function fmt(v: number): string {
  if (Number.isNaN(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3)
}

function ColorBy() {
  const colorBy = useStore((s) => s.colorBy)
  const setColorBy = useStore((s) => s.setColorBy)
  const range = useStore((s) => s.ranges?.[s.colorBy])
  const low = METRIC_META[colorBy].direction === 'low'
  return (
    <section>
      <h2>Koloruj wg</h2>
      <select value={colorBy} onChange={(e) => {
        const k = METRIC_KEYS.find((m) => m === e.target.value)
        if (k) setColorBy(k)
      }}>
        {METRIC_KEYS.map((k) => <option key={k} value={k}>{METRIC_LABELS[k]}</option>)}
      </select>
      <div className="legend-bar" style={{ background: rampCssGradient() }} />
      {/* Jasny = dobry: dla „mniej = lepiej” etykiety odwrócone (max po lewej). */}
      <div className="legend-labels">
        <span>{range ? fmt(low ? range.max : range.min) : '—'}</span>
        <span>{range ? fmt(low ? range.min : range.max) : '—'}</span>
      </div>
      <div className="muted">{low ? '(mniej = lepiej)' : '(więcej = lepiej)'}</div>
    </section>
  )
}

function Layers() {
  const layers = useStore((s) => s.layers)
  const setLayerVisible = useStore((s) => s.setLayerVisible)
  const opacity = useStore((s) => s.overlayOpacity)
  const setOpacity = useStore((s) => s.setOverlayOpacity)
  return (
    <section>
      <h2>Warstwy</h2>
      {LAYER_ORDER.map((k) => (
        <label key={k} className="row">
          <input type="checkbox" checked={layers[k]} onChange={(e) => setLayerVisible(k, e.target.checked)} />
          {LAYER_LABELS[k]}
        </label>
      ))}
      <label className="row">
        Przezroczystość nakładek
        <input type="range" min={0} max={1} step={0.05} value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))} />
        <span>{Math.round(opacity * 100)}%</span>
      </label>
    </section>
  )
}

function SelectedPoint() {
  const meta = useStore((s) => s.meta)
  const candidates = useStore((s) => s.candidates)
  const sel = useStore((s) => s.selectedIndex)
  if (!meta || !candidates) return null
  const columns = meta.candidates.columns.filter((c): c is (typeof COLUMN_NAMES)[number] =>
    (COLUMN_NAMES as readonly string[]).includes(c))
  return (
    <section>
      <h2>Zaznaczony punkt</h2>
      {sel === null ? <p className="muted">Kliknij punkt na mapie.</p> : (
        <table className="kv">
          <tbody>
            {columns.map((c) => (
              <tr key={c}><th>{c}</th><td>{fmt(candidates.col[c][sel] ?? NaN)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function SitesList() {
  const sites = useStore((s) => s.sites)
  const selectById = useStore((s) => s.selectById)
  return (
    <section>
      <h2>Miejsca</h2>
      <ul className="sites">
        {sites.map((s) => {
          const clickable = s.nearest_candidate_id !== null
          return (
            <li key={s.id}>
              <button type="button" disabled={!clickable}
                onClick={() => selectById(s.nearest_candidate_id)}>
                <span className="dot" style={{ background: categoryColor(s.category) }} />
                <span className="site-name">{s.name}</span>
                <span className="muted">
                  {s.category}
                  {s.x_m === null || s.y_m === null ? ' · poza mapą' : ''}
                  {s.nearest_candidate_dist_km !== null
                    ? ` · ${s.nearest_candidate_dist_km.toFixed(2)} km do punktu`
                    : ' · brak punktu siatki'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Sidebar() {
  const mock = useStore((s) => s.meta?.mock === true)
  return (
    <aside className="sidebar">
      {mock && <div className="mock-banner">DANE TESTOWE (mock)</div>}
      <ColorBy />
      <TopList />
      <FiltersPanel />
      <WeightsPanel />
      <Layers />
      <SelectedPoint />
      <SitesList />
    </aside>
  )
}
