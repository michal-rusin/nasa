import { useMemo } from 'react'
import { METRIC_KEYS, type Candidates, type Meta, type MetricKey } from '../data/types'
import { earthPct, longestCommGapH, longestNightH, sunPct } from '../physics'
import { useStore } from '../store'
import { useAnalysis, useAnalysisLoader, type Analysis } from './analysis'

const METRIC_INFO: Record<MetricKey, { label: string; unit: string }> = {
  sun_pct: { label: 'Nasłonecznienie', unit: '%' },
  longest_night_h: { label: 'Najdłuższa noc', unit: 'h' },
  earth_pct: { label: 'Widoczność Ziemi', unit: '%' },
  longest_comm_gap_h: { label: 'Najdł. przerwa łączności', unit: 'h' },
  slope_deg: { label: 'Nachylenie', unit: '°' },
  dist_psr_km: { label: 'Odległość do PSR', unit: 'km' },
}

export const NO_DATA = 'brak danych'

export function fmt(v: number | undefined, digits = 1): string {
  return v === undefined || !Number.isFinite(v) ? NO_DATA : v.toFixed(digits)
}

function MetricsTable({ c, i }: { c: Candidates; i: number }) {
  const ranges = useStore((s) => s.ranges)
  return (
    <table className="kv pp-metrics">
      <tbody>
        {METRIC_KEYS.map((k) => {
          const v = c.col[k][i]
          const r = ranges?.[k]
          const ok = v !== undefined && Number.isFinite(v)
          const t = ok && r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min
            ? (v - r.min) / (r.max - r.min) : null
          return (
            <tr key={k}>
              <th>{METRIC_INFO[k].label}</th>
              <td className={ok ? '' : 'muted'}>{ok ? `${fmt(v)} ${METRIC_INFO[k].unit}` : NO_DATA}</td>
              <td className="pp-bar-cell">
                {t !== null && (
                  <div className="pp-bar" title={`zakres ${fmt(r?.min)}–${fmt(r?.max)} ${METRIC_INFO[k].unit}`}>
                    <div className="pp-bar-mark" style={{ left: `${Math.min(1, Math.max(0, t)) * 100}%` }} />
                  </div>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface Check { label: string; computed: number; file: number; unit: string; tol: number }

function CheckTable({ meta, c, i, a }: { meta: Meta; c: Candidates; i: number; a: Analysis }) {
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

  return (
    <table className="kv pp-check">
      <thead>
        <tr><th>kontrola</th><td>przeliczone</td><td>z pliku</td><td>Δ</td></tr>
      </thead>
      <tbody>
        {checks.map((ch) => {
          const d = ch.computed - ch.file
          const known = Number.isFinite(d)
          const pass = known && Math.abs(d) <= ch.tol + 1e-9
          return (
            <tr key={ch.label}>
              <th>{ch.label}</th>
              <td>{fmt(ch.computed, 2)}</td>
              <td>{fmt(ch.file, 2)}</td>
              <td className={known ? (pass ? 'pp-ok' : 'pp-bad') : 'muted'}>
                {known ? `${d >= 0 ? '+' : ''}${d.toFixed(2)} ${ch.unit}` : NO_DATA}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function PointPanel() {
  useAnalysisLoader()
  const meta = useStore((s) => s.meta)
  const c = useStore((s) => s.candidates)
  const sites = useStore((s) => s.sites)
  const sel = useStore((s) => s.selectedIndex)
  const status = useAnalysis((s) => s.status)
  const error = useAnalysis((s) => s.error)
  const data = useAnalysis((s) => s.data)

  if (!meta || !c) return null
  const id = sel !== null ? c.col.id[sel] : undefined
  if (sel === null || id === undefined) {
    return (
      <section className="point-panel">
        <h2>Punkt</h2>
        <p className="muted">Kliknij punkt na mapie albo miejsce z listy: pod mapą pojawi się panorama horyzontu i oś czasu.</p>
      </section>
    )
  }

  const site = sites.find((s) => s.nearest_candidate_id === id)
  return (
    <section className="point-panel">
      <h2>Punkt #{id}</h2>
      {site && (
        <div className="pp-site">
          <strong>{site.name}</strong> <span className="muted">({site.category}
          {site.nearest_candidate_dist_km !== null ? `, ${site.nearest_candidate_dist_km.toFixed(2)} km od miejsca` : ''})</span>
        </div>
      )}
      <div className="muted pp-coords">
        {fmt(c.col.lat[sel], 3)}°, {fmt(c.col.lon[sel], 3)}° · wys. {fmt(c.col.elev_m[sel], 0)} m
      </div>
      <MetricsTable c={c} i={sel} />
      {status === 'loading' && <p className="muted">Wczytuję maskę i efemerydy…</p>}
      {status === 'error' && <p className="pp-error">{error}</p>}
      {status === 'ready' && data && (
        <>
          <h3 className="pp-h3">Przeliczone vs z pliku</h3>
          <CheckTable meta={meta} c={c} i={sel} a={data} />
        </>
      )}
    </section>
  )
}
