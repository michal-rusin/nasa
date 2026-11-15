import { useCallback, useEffect, useRef, useState } from 'react'
import { AdvancedDrawer } from '../app/AdvancedDrawer'
import { Legend } from '../app/Legend'
import { isMockSite } from '../app/sites'
import { SearchBox } from '../app/SearchBox'
import { ModeSwitch } from '../app/ModeSwitch'
import { TopCard } from '../app/TopCard'
import { useT } from '../i18n'
import { MapView } from '../map/MapView'
import { useAnalysisLoader, usePlayback } from '../panel/analysis'
import { Places } from '../panel/Places'
import { useStore } from '../store'
import './south-pole.css'

/** Prawy dolny róg: skrót danych z meta.json (monospace, jak panel statystyk). */
function MapStats() {
  const t = useT()
  const meta = useStore((s) => s.meta)
  if (!meta) return null
  const y0 = new Date(Date.parse(meta.t0_utc)).getUTCFullYear()
  const y1 = new Date(Date.parse(meta.t0_utc) + (meta.n_steps - 1) * meta.step_s * 1000).getUTCFullYear()
  const hours = meta.step_s / 3600
  return (
    <dl className="map-stats" aria-label={t('stats.title')}>
      <dt>{t('stats.region')}</dt>
      <dd>{Math.abs(meta.region.lat_max)}°S–{Math.abs(meta.region.lat_min)}°S</dd>
      <dt>{t('stats.candidates')}</dt>
      <dd>{meta.candidates.count.toLocaleString('en-US')}</dd>
      <dt>{t('stats.ephem')}</dt>
      <dd>{Number.isFinite(y0) ? (y0 === y1 ? y0 : `${y0}–${y1}`) : '?'}</dd>
      <dt>{t('stats.step')}</dt>
      <dd>{Number.isInteger(hours) ? `${hours} h` : `${meta.step_s} s`}</dd>
    </dl>
  )
}

/** Przed włączeniem rankingu: mapa bez kolorów i jedno wyraźne wezwanie. */
function RankingCta() {
  const t = useT()
  const setRankingShown = useStore((s) => s.setRankingShown)
  return (
    <section className="rank-cta glass" aria-labelledby="rank-cta-title">
      <h2 id="rank-cta-title">{t('rank.title')}</h2>
      <p>{t('rank.lead')}</p>
      <button type="button" className="btn-glow" onClick={() => setRankingShown(true)}>
        <span>{t('rank.show')}</span>
      </button>
      <p className="rank-hint">{t('rank.hint')}</p>
    </section>
  )
}

/** Przełącznik w kształcie pigułki (aria-pressed). */
function TogglePill({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`pill-toggle${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span className="pill-dot" aria-hidden="true" />{label}
    </button>
  )
}

function scrollBehavior(): ScrollBehavior {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** Strona z przewijaniem: mapa na pierwszy ekran, pod nią szklane boxy wybranych miejsc. */
function Explorer() {
  const t = useT()
  useAnalysisLoader()
  usePlayback()
  const mock = useStore((s) => s.meta?.mock === true)
  const selected = useStore((s) => s.selectedIndex)
  const compare = useStore((s) => s.compareIndex)
  const picking = useStore((s) => s.picking)
  const rankingShown = useStore((s) => s.rankingShown)
  const setRankingShown = useStore((s) => s.setRankingShown)
  const sitesShown = useStore((s) => s.layers.sites)
  const hasSites = useStore((s) => s.sites.some((x) => x.x_m !== null && !isMockSite(x)))
  const setLayerVisible = useStore((s) => s.setLayerVisible)
  const setSelectedIndex = useStore((s) => s.setSelectedIndex)
  const cancelCompare = useStore((s) => s.cancelCompare)
  const [advOpen, setAdvOpen] = useState(false)
  const advBtn = useRef<HTMLButtonElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const placesRef = useRef<HTMLDivElement>(null)

  const closeAdvanced = useCallback(() => {
    setAdvOpen(false)
    advBtn.current?.focus()
  }, [])

  // „Porównaj miejsce”: wracamy do mapy.
  useEffect(() => {
    if (picking) pageRef.current?.scrollTo({ top: 0, behavior: scrollBehavior() })
  }, [picking])
  // Każdy nowo wybrany punkt (A albo B): płynnie zjeżdżamy do boxów pod mapą.
  useEffect(() => {
    if (selected === null && compare === null) return
    const page = pageRef.current
    const places = placesRef.current
    if (!page || !places) return
    // Po klatce: box jest już w układzie strony, więc znamy jego pozycję.
    const raf = requestAnimationFrame(() => {
      page.scrollTo({ top: places.offsetTop, behavior: scrollBehavior() })
    })
    return () => cancelAnimationFrame(raf)
  }, [selected, compare])

  // Esc: najpierw szuflada, potem tryb wyboru, potem boxy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (advOpen) closeAdvanced()
      else if (s.picking) cancelCompare()
      else if (s.selectedIndex !== null) setSelectedIndex(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [advOpen, closeAdvanced, cancelCompare, setSelectedIndex])

  return (
    <div className="sp-page starfield" ref={pageRef}>
      <section className={`map-section${picking ? ' picking' : ''}${rankingShown ? ' ranked' : ''}`}>
        <MapView />
        <div className="map-ui">
          <div className="ui-left">
            <SearchBox />
            {rankingShown ? <TopCard /> : <RankingCta />}
          </div>
          <div className="ui-right">
            {mock && <div className="mock-banner">{t('sp.mock')}</div>}
            {hasSites && (
              <TogglePill on={sitesShown} label={t('sites.pill')} onClick={() => setLayerVisible('sites', !sitesShown)} />
            )}
            <button ref={advBtn} type="button" className="btn adv-btn" aria-haspopup="dialog"
              aria-expanded={advOpen} onClick={() => { setRankingShown(true); setAdvOpen(true) }}>{t('adv.open')}</button>
          </div>
          {picking && (
            <div className="pick-banner" role="status">
              <span>{t('pick.banner')}</span>
              <button type="button" className="chip" onClick={cancelCompare}>{t('pick.cancel')}</button>
            </div>
          )}
          {rankingShown && <Legend />}
          {rankingShown && <ModeSwitch />}
          <MapStats />
        </div>
        {advOpen && <AdvancedDrawer onClose={closeAdvanced} />}
      </section>
      <div ref={placesRef} className="places-anchor">
        <Places />
      </div>
    </div>
  )
}

export default function SouthPole() {
  const t = useT()
  const status = useStore((s) => s.status)
  const error = useStore((s) => s.error)
  const load = useStore((s) => s.load)

  // Dane bieguna ładujemy dopiero tutaj; przy powrocie z globusa nie pobieramy ich drugi raz.
  useEffect(() => {
    if (useStore.getState().status !== 'ready') void load()
  }, [load])

  return (
    <div id="app-root" className="view-fade">
      {status === 'loading' && <div className="state">{t('sp.loading')}</div>}
      {status === 'error' && (
        <div className="state error">
          <strong>{t('sp.loadError')}</strong>
          <p>{error}</p>
        </div>
      )}
      {status === 'ready' && <Explorer />}
    </div>
  )
}
