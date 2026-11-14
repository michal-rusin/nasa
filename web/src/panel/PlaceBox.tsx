import { useId, useMemo } from 'react'
import { fmtCoord } from '../app/coords'
import { fmtVal, METRIC_DIGITS } from '../app/format'
import { isMockSite } from '../app/sites'
import type { Candidates, Meta, MetricKey } from '../data/types'
import { fill, useT } from '../i18n'
import { earthPct, longestCommGapH, longestNightH, sunPct } from '../physics'
import { METRIC_META } from '../rank/metrics'
import { useStore } from '../store'
import { useAnalysis, type Analysis, type SlotKey } from './analysis'
import { isBetter } from './compare'
import { earthTransition, splitHours, sunTransition, type Transition } from './countdown'
import { SkyPanorama } from './SkyPanorama'
import { Timeline } from './Timeline'
import { stepToUtc } from './timelineMath'

const PANEL_METRICS: readonly MetricKey[] = [
  'sun_pct', 'longest_night_h', 'earth_pct', 'longest_comm_gap_h', 'dist_psr_km',
]
/** Doba synodyczna Księżyca: tyle obejmuje tor Słońca/Ziemi zaznaczony na osi czasu. */
const LUNAR_DAY_S = 29.53 * 86400

interface Check { label: string; computed: number; file: number; unit: string; tol: number }

function CheckTable({ meta, c, i, a }: { meta: Meta; c: Candidates; i: number; a: Analysis }) {
  const t = useT()
  const checks: Check[] = useMemo(() => {
    const s = a.series, n = meta.n_steps, stepS = meta.step_s, stepH = stepS / 3600
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
    ]
  }, [a, meta, c, i])
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
  const playing = useAnalysis((s) => s.playing)
  const setCursor = useAnalysis((s) => s.setCursor)
  const setPlaying = useAnalysis((s) => s.setPlaying)
  const sliderId = useId()

  if (!meta || !c || index === null) return null
  const id = c.col.id[index]
  const na = t('na')
  const n = meta.n_steps
  const k = Math.min(Math.max(0, n - 1), cursor)
  const now = stepToUtc(meta.t0_utc, meta.step_s, k)
  const site = sites.find((s) => s.nearest_candidate_id === id && !isMockSite(s))
  const coord = fmtCoord(c.col.lat[index], c.col.lon[index], 2, na)
  const stepH = meta.step_s / 3600

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

  const facts: { key: string; label: string; value: string; better: boolean }[] = [
    {
      key: 'score', label: t('panel.score'), value: fmtVal(score, 3, na),
      better: score !== undefined && otherScore !== undefined && Number.isFinite(score) && score > otherScore,
    },
    { key: 'elev', label: t('panel.elev'), value: `${fmtVal(c.col.elev_m[index], 0, na)} m`, better: false },
    {
      key: 'slope', label: t('panel.slope'), value: `${fmtVal(c.col.slope_deg[index], 1, na)}°`,
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
            </p>
          </div>
        </div>
        <div className="pb-actions">
          {slot === 'a' && !compare && (
            <button type="button" className="btn-glow sm" onClick={startCompare} disabled={picking}>
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

      <div className="pb-time">
        <button type="button" className="hd-play" aria-label={t(playing ? 'dock.pause' : 'dock.play')}
          onClick={() => {
            if (!playing && k >= n - 1) setCursor(0)
            setPlaying(!playing)
          }}>{playing ? '❚❚' : '▶'}</button>
        <label htmlFor={sliderId} className="pb-time-label">
          <span className="label">{t('panel.time')}</span>
          <span className="pb-now">{now}</span>
        </label>
        <input id={sliderId} type="range" min={0} max={Math.max(0, n - 1)} step={1} value={k}
          aria-valuetext={now}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)) }} />
      </div>
      <p className="pb-range">
        {fill(t('panel.range'), {
          from: stepToUtc(meta.t0_utc, meta.step_s, 0, false),
          to: stepToUtc(meta.t0_utc, meta.step_s, n - 1, false),
        })}
      </p>

      {status === 'ready' && data && (
        <div className="pb-timeline">
          <Timeline f={data.series.f} g={data.series.g} t0Utc={meta.t0_utc} stepS={meta.step_s} cursor={k}
            trackLen={Math.max(1, Math.round(LUNAR_DAY_S / meta.step_s))}
            night={data.night} commGap={data.commGap}
            onCursor={(v) => { setPlaying(false); setCursor(v) }} />
        </div>
      )}
      {status === 'error' && <p className="pp-error">{error}</p>}

      <div className="pb-grid">
        <dl className="pb-facts">
          {facts.map((f) => (
            <div key={f.key} className={f.better ? 'better' : ''}>
              <dt>{f.label}</dt>
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
                <dt>{t(`metric.${m}`)}</dt>
                <dd className={ok ? '' : 'muted'}>
                  {ok ? `${fmtVal(v, METRIC_DIGITS[m], na)} ${METRIC_META[m].unit}` : na}
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
            <h3 className="label">{t('panel.diag')}</h3>
            <CheckTable meta={meta} c={c} i={index} a={data} />
          </>
        )}
      </details>
    </article>
  )
}
