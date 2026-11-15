import { useMemo } from 'react'
import { fmtCoord } from '../app/coords'
import { fmtVal, METRIC_DIGITS } from '../app/format'
import { isMockSite } from '../app/sites'
import type { Candidates, Meta, MetricKey } from '../data/types'
import { candidatesForYear, candidatesRange, isEternalShadow, yearHours, yearOfStep } from '../data/years'
import { fill, useT } from '../i18n'
import { earthPct, longestCommGapH, longestNightH, solarPower, sunPct, type SolarPower } from '../physics'
import { METRIC_META } from '../rank/metrics'
import { useStore } from '../store'
import { useActiveRange, useAnalysis, type Analysis, type SlotKey } from './analysis'
import { isBetter } from './compare'
import { earthTransition, splitHours, sunTransition, type Transition } from './countdown'
import { PlaceTimeline } from './PlaceTimeline'
import { SkyPanorama } from './SkyPanorama'
import { Term } from '../tour/Term'
import { TimeBar } from './TimeBar'

const PANEL_METRICS: readonly MetricKey[] = [
  'sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h', 'dist_psr_km',
]

interface Check { label: string; computed: number; file: number; unit: string; tol: number }

/** Porównanie z candidates.bin: tylko na krokach jego roku (candidates_period), nie na całym ephem.bin. */
function CheckTable({ meta, c, cPeriod, i, a }: {
  meta: Meta; c: Candidates; cPeriod: Candidates; i: number; a: Analysis
}) {
  const t = useT()
  const checks: Check[] = useMemo(() => {
    const p = candidatesRange(meta)
    const s = { f: a.series.f.subarray(p.start, p.start + p.len), g: a.series.g.subarray(p.start, p.start + p.len) }
    const n = p.len, stepS = meta.step_s, stepH = stepS / 3600
    return [
      { label: 'sun_pct', unit: 'pp', tol: 1, computed: sunPct(s.f), file: c.col.sun_pct[i]! },
      {
        label: 'earth_pct', unit: 'pp', tol: Math.max(0.05, (2 / n) * 100),
        computed: earthPct(s.g), file: c.col.earth_pct[i]!,
      },
      {
        label: 'longest_night_h', unit: 'h', tol: stepH,
        computed: longestNightH(s.f, stepS, meta.night_threshold), file: c.col.longest_night_h[i]!,
      },
      {
        label: 'longest_comm_gap_h', unit: 'h', tol: stepH,
        computed: longestCommGapH(s.g, stepS), file: c.col.longest_comm_gap_h[i]!,
      },
      // Moc (kontrakt 3.4): z metrics_by_year dla roku candidates.bin; brak kolumn = wiersze pominięte.
      ...(() => {
        const file = cPeriod.col
        if (!Number.isFinite(file.power_track_wm2[i]!)) return []
        const pw = solarPower(a.series, p.start, p.len, Date.parse(meta.t0_utc), stepS)
        return [
          { label: 'power_track_wm2', unit: 'W/m²', tol: 1, computed: pw.trackingWm2, file: file.power_track_wm2[i]! },
          { label: 'power_fixed_wm2', unit: 'W/m²', tol: 2, computed: pw.fixedWm2, file: file.power_fixed_wm2[i]! },
          {
            label: 'power_fixed_az_deg', unit: '°', tol: 0,
            computed: pw.fixedWm2 > 0 ? pw.fixedAzDeg : NaN, file: file.power_fixed_az_deg[i]!,
          },
        ]
      })(),
    ]
  }, [a, meta, c, cPeriod, i])
  const na = t('na')
  return (
    <table className="kv pp-check">
      <thead>
        <tr><th>{t('panel.diagCheck')}</th><td>{t('panel.diagComputed')}</td><td>{t('panel.diagFile')}</td><td>Δ</td></tr>
      </thead>
      <tbody>
        {checks.map((ch) => {
          const d = ch.computed - ch.file
          const known = Number.isFinite(d)
          const pass = known && Math.abs(d) <= ch.tol + 1e-9
          return (
            <tr key={ch.label}>
              <th>{ch.label}</th>
              <td>{fmtVal(ch.computed, 2, na)}</td>
              <td>{fmtVal(ch.file, 2, na)}</td>
              <td className={known ? (pass ? 'pp-ok' : 'pp-bad') : 'muted'}>
                {known ? `${d >= 0 ? '+' : ''}${d.toFixed(2)} ${ch.unit}` : na}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Średnia moc z paneli w wybranym roku (null, dopóki szeregi się liczą). */
function usePower(a: Analysis | null, meta: Meta | null): SolarPower | null {
  const { start, len } = useActiveRange()
  return useMemo(() => (a && meta && len > 0
    ? solarPower(a.series, start, len, Date.parse(meta.t0_utc), meta.step_s) : null), [a, meta, start, len])
}

interface Props {
  slot: SlotKey
  /** Tryb porównania: dwa boxy obok siebie, niższa panorama, odznaki A/B. */
  compare: boolean
}

/** Szklany box miejsca: panorama nieba, czas, wskaźniki i liczniki zachodów. */
export function PlaceBox({ slot, compare }: Props) {
  const t = useT()
  const meta = useStore((s) => s.meta)
  const c = useStore((s) => s.candidates)
  const base = useStore((s) => s.baseCandidates)
  const year = useStore((s) => s.year)
  const byYear = useStore((s) => s.byYear)
  const sites = useStore((s) => s.sites)
  const index = useStore((s) => (slot === 'a' ? s.selectedIndex : s.compareIndex))
  const other = useStore((s) => (slot === 'a' ? s.compareIndex : s.selectedIndex))
  const score = useStore((s) => (index === null ? undefined : s.score?.[index]))
  const otherScore = useStore((s) => (other === null ? undefined : s.score?.[other]))
  const rank = useStore((s) => s.top.findIndex((p) => p.index === index))
  const startCompare = useStore((s) => s.startCompare)
  const closeSlot = useStore((s) => s.closeSlot)
  const picking = useStore((s) => s.picking)

  const status = useAnalysis((s) => s[slot].status)
  const error = useAnalysis((s) => s[slot].error)
  const data = useAnalysis((s) => s[slot].data)
  const cursor = useAnalysis((s) => s.cursor)
  const otherData = useAnalysis((s) => s[slot === 'a' ? 'b' : 'a'].data)
  const power = usePower(data, meta)
  const otherPower = usePower(other === null ? null : otherData, meta)

  if (!meta || !c || index === null) return null
  const id = c.col.id[index]
  const na = t('na')
  const n = meta.n_steps
  const k = Math.min(Math.max(0, n - 1), cursor)
  const site = sites.find((s) => s.nearest_candidate_id === id && !isMockSite(s))
  const coord = fmtCoord(c.col.lat[index], c.col.lon[index], 2, na)
  const stepH = meta.step_s / 3600
  const period = candidatesRange(meta)
  const shownYear = year ?? yearOfStep(meta.t0_utc, meta.step_s, period.start)
  const yearH = year !== null ? yearHours(year) : period.len * stepH
  const shadow = isEternalShadow(c.col.sun_pct[index], c.col.longest_night_h[index], yearH)

  const dur = (steps: number) => {
    const { d, h } = splitHours(steps * stepH)
    return fill(t('panel.duration'), { d, h })
  }
  const describe = (tr: Transition, downKey: string, downNeverKey: string): string => {
    if (tr.on) return tr.steps === null ? t('panel.never') : fill(t('panel.inT'), { t: dur(tr.steps) })
    return tr.steps === null ? t(downNeverKey) : fill(t(downKey), { t: dur(tr.steps) })
  }
  const sunText = data
    ? describe(sunTransition(data.series.f, k, meta.night_threshold), 'panel.sunDown', 'panel.sunDownNever') : null
  const earthText = data
    ? describe(earthTransition(data.series.g, k), 'panel.earthDown', 'panel.earthDownNever') : null

  const facts: { key: string; gloss: string; label: string; value: string; better: boolean }[] = [
    {
      key: 'score', gloss: 'score', label: t('panel.score'), value: fmtVal(score, 3, na),
      better: score !== undefined && otherScore !== undefined && Number.isFinite(score) && score > otherScore,
    },
    { key: 'elev', gloss: 'elev', label: t('panel.elev'), value: `${fmtVal(c.col.elev_m[index], 0, na)} m`, better: false },
    {
      key: 'slope', gloss: 'slope_deg', label: t('panel.slope'), value: `${fmtVal(c.col.slope_deg[index], 1, na)}°`,
      better: other !== null && isBetter('slope_deg', c.col.slope_deg[index], c.col.slope_deg[other]),
    },
  ]

  return (
    <article className={`place-box glass${compare ? ' compact' : ''}`} aria-labelledby={`pb-${slot}-title`}>
      <header className="pb-head">
        <div className="pb-titles">
          {compare && <span className={`pb-badge ${slot}`} aria-hidden="true">{slot.toUpperCase()}</span>}
          <div>
            <h2 id={`pb-${slot}-title`} title={id === undefined ? undefined : `#${id}`}>{coord}</h2>
            <p className="pb-sub">
              {site && <span className="pb-site">{site.name}</span>}
              {rank >= 0 && <span>{fill(t('panel.rank'), { r: rank + 1 })}</span>}
              {shadow && <span className="pb-shadow" title={t('shadow.title')}>{fill(t('shadow.badge'), { y: shownYear })}</span>}
            </p>
          </div>
        </div>
        <div className="pb-actions">
          {slot === 'a' && !compare && (
            <button type="button" className="btn-glow sm" data-tour="compare" onClick={startCompare} disabled={picking}>
              {t('place.compare')}
            </button>
          )}
          {slot === 'b' && (
            <button type="button" className="btn-glow sm" onClick={startCompare} disabled={picking}>
              {t('place.change')}
            </button>
          )}
          <button type="button" className="icon-btn" aria-label={t('panel.close')} onClick={() => closeSlot(slot)}>×</button>
        </div>
      </header>

      <SkyPanorama slot={slot} index={index} />

      {/* W porównaniu czas i oś są we wspólnym pasku pod boxami (Places). */}
      {!compare && <TimeBar />}
      {!compare && status === 'ready' && data && <PlaceTimeline data={data} />}
      {status === 'error' && <p className="pp-error">{error}</p>}

      <div className="pb-grid" data-tour={slot === 'a' ? 'numbers' : undefined}>
        <dl className="pb-facts">
          {facts.map((f) => (
            <div key={f.key} className={f.better ? 'better' : ''}>
              <dt><Term k={f.gloss}>{f.label}</Term></dt>
              <dd>{f.value}{f.better && <span className="pb-better" role="img" aria-label={t('place.better')} />}</dd>
            </div>
          ))}
        </dl>
        <dl className="pb-metrics">
          {PANEL_METRICS.map((m) => {
            const v = c.col[m][index]
            const ok = v !== undefined && Number.isFinite(v)
            const better = other !== null && isBetter(m, v, c.col[m][other])
            return (
              <div key={m} className={better ? 'better' : ''}>
                <dt><Term k={m}>{t(`metric.${m}`)}</Term></dt>
                <dd className={ok ? '' : 'muted'}>
                  {ok ? `${fmtVal(v, METRIC_DIGITS[m], na)} ${METRIC_META[m].unit}` : na}
                  {better && <span className="pb-better" role="img" aria-label={t('place.better')} />}
                </dd>
              </div>
            )
          })}
          {/* Moc z paneli pionowych w wybranym roku: z metrics_by_year (to samo co filtr i ranking),
              a przy starszych danych liczona tu z szeregów (physics/solarPower). */}
          {([
            ['power_track_wm2', 'trackingWm2'],
            ['power_fixed_wm2', 'fixedWm2'],
          ] as const).map(([col, key]) => {
            const fromFile = (j: number | null) => (j === null ? undefined : c.col[col][j])
            const pick = (j: number | null, pw: SolarPower | null) => {
              const f = fromFile(j)
              return f !== undefined && Number.isFinite(f) ? f : pw?.[key]
            }
            const v = pick(index, power)
            const ov = other === null ? undefined : pick(other, otherPower)
            const better = v !== undefined && ov !== undefined && v > ov + 0.5
            const fileAz = c.col.power_fixed_az_deg[index]
            const az = Number.isFinite(c.col.power_fixed_wm2[index]!) ? fileAz : power?.fixedWm2 ? power.fixedAzDeg : undefined
            return (
              <div key={col} className={better ? 'better' : ''} title={t('power.note')}>
                <dt>{t(`metric.${col}`)}</dt>
                <dd className={v === undefined ? 'muted' : ''}>
                  {v === undefined ? '…' : `${Math.round(v)} W/m²`}
                  {col === 'power_fixed_wm2' && v !== undefined && v > 0 && az !== undefined && Number.isFinite(az) && (
                    <span className="muted">{fill(t('power.faces'), { az: az.toFixed(1).replace(/\.0$/, '') })}</span>
                  )}
                  {better && <span className="pb-better" role="img" aria-label={t('place.better')} />}
                </dd>
              </div>
            )
          })}
        </dl>
        <dl className="pb-count" aria-live="polite">
          <div><dt><span className="dot sun" aria-hidden="true" />{t('panel.sunset')}</dt><dd>{sunText ?? '…'}</dd></div>
          <div><dt><span className="dot earth" aria-hidden="true" />{t('panel.earthset')}</dt><dd>{earthText ?? '…'}</dd></div>
        </dl>
      </div>

      <details className="pb-more">
        <summary>{t('dock.help')}</summary>
        <p>{t('dock.note')}</p>
        <p className="pb-credit">{t('sky.credit')}</p>
        {status === 'ready' && data && (
          <>
            <h3 className="label">{fill(t('panel.diag'), { y: yearOfStep(meta.t0_utc, meta.step_s, period.start) })}</h3>
            <CheckTable meta={meta} c={base ?? c} i={index} a={data}
              cPeriod={candidatesForYear(base ?? c, byYear, yearOfStep(meta.t0_utc, meta.step_s, period.start))} />
          </>
        )}
      </details>
    </article>
  )
}
