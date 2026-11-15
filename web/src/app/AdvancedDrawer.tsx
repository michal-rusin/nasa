import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { MetricKey } from '../data/types'
import { useT } from '../i18n'
import { METRIC_META } from '../rank/metrics'
import { COLOR_KEYS, RASTER_KEYS, useStore, type LayerKey } from '../store'
import { fmtVal, METRIC_DIGITS } from './format'
import { isMockSite } from './sites'

/** Opóźnienie zapisu suwaka do store: ranking i kolory liczą się po chwili bezruchu. */
const COMMIT_DELAY_MS = 120
const SLIDER_STEPS = 200

/** Filtry w kolejności z briefu: nachylenie, sun_pct min, noc max, łączność, reszta. */
const FILTER_DEFS: readonly { key: MetricKey; bound: 'min' | 'max' }[] = [
  { key: 'slope_deg', bound: 'max' },
  { key: 'sun_pct', bound: 'min' },
  { key: 'longest_night_h', bound: 'max' },
  { key: 'longest_comm_gap_h', bound: 'max' },
  { key: 'earth_pct', bound: 'min' },
  { key: 'dist_psr_km', bound: 'max' },
  { key: 'power_track_wm2', bound: 'min' },
  { key: 'power_fixed_wm2', bound: 'min' },
]

interface RangeProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  display: (v: number) => string
  onCommit: (v: number) => void
  muted?: boolean
}

/** Suwak z lokalnym stanem: płynny pod palcem, zapis do store z opóźnieniem. */
function DebouncedRange({ label, value, min, max, step, display, onCommit, muted }: RangeProps) {
  const [local, setLocal] = useState(value)
  const timer = useRef<number | undefined>(undefined)
  const id = useId()
  // Zmiana z zewnątrz (reset) nadpisuje lokalny stan, o ile nic nie czeka na zapis.
  useEffect(() => { if (timer.current === undefined) setLocal(value) }, [value])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <div className="adv-range">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={local}
        aria-valuetext={display(local)}
        onChange={(e) => {
          const v = Number(e.target.value)
          setLocal(v)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            timer.current = undefined
            onCommit(v)
          }, COMMIT_DELAY_MS)
        }} />
      <output htmlFor={id} className={muted ? 'muted' : ''}>{display(local)}</output>
    </div>
  )
}

function FilterRange({ k, bound }: { k: MetricKey; bound: 'min' | 'max' }) {
  const t = useT()
  const range = useStore((s) => s.ranges?.[k])
  const value = useStore((s) => s.filters[k]?.[bound])
  const setFilter = useStore((s) => s.setFilter)
  // Metryka bez danych (same NaN) nie ma czego filtrować.
  if (!range || !(range.max > range.min)) return null
  const neutral = bound === 'min' ? range.min : range.max
  const isNeutral = (v: number) => (bound === 'min' ? v <= range.min : v >= range.max)
  const unit = METRIC_META[k].unit
  return (
    <DebouncedRange
      label={`${t(`metric.${k}`)}, ${t(bound === 'min' ? 'filter.min' : 'filter.max')}`}
      value={value ?? neutral} min={range.min} max={range.max}
      step={(range.max - range.min) / SLIDER_STEPS}
      display={(v) => (isNeutral(v) ? t('filter.off') : `${fmtVal(v, METRIC_DIGITS[k], t('na'))} ${unit}`)}
      muted={value === undefined}
      // Suwak na skraju = filtr wyłączony (nie odrzuca też punktów bez danych).
      onCommit={(v) => setFilter(k, isNeutral(v) ? undefined : { [bound]: v })} />
  )
}

function LayerToggle({ k }: { k: LayerKey }) {
  const t = useT()
  const on = useStore((s) => s.layers[k])
  const setLayerVisible = useStore((s) => s.setLayerVisible)
  return (
    <label className="adv-check">
      <input type="checkbox" checked={on} onChange={(e) => setLayerVisible(k, e.target.checked)} />
      {t(`layer.${k}`)}
    </label>
  )
}

export function AdvancedDrawer({ onClose }: { onClose: () => void }) {
  const t = useT()
  const colorBy = useStore((s) => s.colorBy)
  const setColorBy = useStore((s) => s.setColorBy)
  const weights = useStore((s) => s.weights)
  const metricKeys = useStore((s) => s.metricKeys)
  const setWeight = useStore((s) => s.setWeight)
  const radius = useStore((s) => s.nmsRadiusKm)
  const setNmsRadius = useStore((s) => s.setNmsRadius)
  const avail = useStore((s) => s.availableLayers)
  const hasSites = useStore((s) => s.sites.some((x) => !isMockSite(x) && x.x_m !== null))
  const overlayOpacity = useStore((s) => s.overlayOpacity)
  const setOverlayOpacity = useStore((s) => s.setOverlayOpacity)
  const pointsOpacity = useStore((s) => s.pointsOpacity)
  const setPointsOpacity = useStore((s) => s.setPointsOpacity)
  const resetAdvanced = useStore((s) => s.resetAdvanced)
  const closeRef = useRef<HTMLButtonElement>(null)
  const colorId = useId()

  useEffect(() => { closeRef.current?.focus() }, [])

  const overlays = RASTER_KEYS.filter((k) => k !== 'basemap' && avail[k])
  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer glass" role="dialog" aria-modal="true" aria-labelledby="adv-title">
        <header className="drawer-head">
          <h2 id="adv-title">{t('adv.title')}</h2>
          <button ref={closeRef} type="button" className="icon-btn" aria-label={t('adv.close')} onClick={onClose}>×</button>
        </header>
        <div className="drawer-body">
          <section>
            <label htmlFor={colorId} className="adv-h">{t('adv.colorBy')}</label>
            <select id={colorId} value={colorBy} onChange={(e) => {
              const k = COLOR_KEYS.find((c) => c === e.target.value)
              if (k) setColorBy(k)
            }}>
              {COLOR_KEYS.filter((k) => k === 'score' || metricKeys.includes(k))
                .map((k) => <option key={k} value={k}>{t(`metric.${k}`)}</option>)}
            </select>
          </section>

          <section>
            <h3 className="adv-h">{t('adv.weights')}</h3>
            <p className="adv-hint">{t('adv.weightsHint')}</p>
            {metricKeys.map((k) => (
              <DebouncedRange key={k} label={t(`metric.${k}`)} value={weights[k]} min={0} max={5} step={1}
                display={(v) => String(v)} onCommit={(v) => setWeight(k, v)} />
            ))}
            <DebouncedRange label={t('adv.nms')} value={radius} min={0} max={20} step={0.5}
              display={(v) => `${v} km`} onCommit={setNmsRadius} />
          </section>

          <section>
            <h3 className="adv-h">{t('adv.filters')}</h3>
            {FILTER_DEFS.filter((d) => metricKeys.includes(d.key))
              .map((d) => <FilterRange key={d.key} k={d.key} bound={d.bound} />)}
          </section>

          <section>
            <h3 className="adv-h">{t('adv.layers')}</h3>
            <LayerToggle k="points" />
            {avail.basemap && <LayerToggle k="basemap" />}
            {overlays.map((k) => <LayerToggle key={k} k={k} />)}
            {hasSites && <LayerToggle k="sites" />}
            {overlays.length === 0 && <p className="adv-hint">{t('adv.noOverlays')}</p>}
            <DebouncedRange label={t('adv.pointsOpacity')} value={pointsOpacity} min={0.1} max={1} step={0.05}
              display={pct} onCommit={setPointsOpacity} />
            {overlays.length > 0 && (
              <DebouncedRange label={t('adv.overlayOpacity')} value={overlayOpacity} min={0} max={1} step={0.05}
                display={pct} onCommit={setOverlayOpacity} />
            )}
          </section>

          <button type="button" className="btn btn-wide" onClick={resetAdvanced}>{t('adv.reset')}</button>
        </div>
      </aside>
    </>
  )
}
