// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { fmtCoord } from '../app/coords'
import { fill, useT } from '../i18n'
import { enuBasis } from '../physics'
import { useStore } from '../store'
import { useAnalysis, type SkyView, type SlotKey } from './analysis'
import { earthLitFraction, skyState } from './sky'
import { SkyMiniMap } from './SkyMiniMap'
import { drawSky, type SkyTrack } from './skyDraw'
import { useStars } from './stars'
import { tourSignal } from '../tour/store'

interface Props {
  slot: SlotKey
  index: number
}

const ZOOM_STEP = 1.25
/** Sky tracks: 2 days back and almost a full lunar day ahead. */
const TRACK_BACK_H = 48
const TRACK_AHEAD_H = 27 * 24
const SUN_RGB = [255, 200, 90] as const
const EARTH_RGB = [120, 175, 255] as const

/** Sky panorama from a location: black sky, stars, Sun, phased Earth, and terrain silhouette. */
export function SkyPanorama({ slot, index }: Props) {
  const t = useT()
  const meta = useStore((s) => s.meta)
  const c = useStore((s) => s.candidates)
  const status = useAnalysis((s) => s[slot].status)
  const data = useAnalysis((s) => s[slot].data)
  const ephem = useAnalysis((s) => s.ephem)
  const cursor = useAnalysis((s) => s.cursor)
  const view = useAnalysis((s) => s.views[slot])
  const setSlotView = useAnalysis((s) => s.setView)
  const stars = useStars()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)
  const setView = (v: Partial<SkyView>) => setSlotView(slot, v)

  // Canvas size = container size (CSS sets height, e.g. 50vh).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setSize((s) => {
      const w = Math.floor(el.clientWidth), h = Math.floor(el.clientHeight)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      return s.w === w && s.h === h && s.dpr === dpr ? s : { w, h, dpr }
    })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Ctrl/⌘ + wheel (including trackpad pinch) zooms; plain wheel scrolls the page.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setSlotView(slot, { fov: useAnalysis.getState().views[slot].fov * Math.exp(e.deltaY * 0.003) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setSlotView, slot])

  const point = useMemo(() => (c ? {
    latDeg: c.col.lat[index]!, lonDeg: c.col.lon[index]!, elevM: c.col.elev_m[index]!,
  } : null), [c, index])
  const basis = useMemo(() => (point ? enuBasis(point.latDeg, point.lonDeg) : null), [point])
  const k = Math.min(Math.max(0, (meta?.n_steps ?? 1) - 1), cursor)
  const sky = useMemo(() => (meta && point && ephem && basis ? skyState(
    point, ephem, k,
    { moonRadiusKm: meta.moon_radius_km, observerHeightM: meta.observer_height_m, sunRadiusDeg: meta.sun_radius_deg },
    meta.t0_utc, meta.step_s, basis,
  ) : null), [meta, point, ephem, basis, k])

  const labels = useMemo(() => ({ sun: t('dock.sun'), earth: t('dock.earth') }), [t])
  const sunFraction = data?.series.f[k] ?? 0
  const tracks = useMemo<SkyTrack[] | undefined>(() => {
    if (!data || !meta) return undefined
    const stepH = meta.step_s / 3600
    const from = k - Math.round(TRACK_BACK_H / stepH)
    const to = k + Math.round(TRACK_AHEAD_H / stepH)
    const sr = data.series
    return [
      { az: sr.sunAz, el: sr.sunEl, from, to, now: k, stepH, rgb: SUN_RGB, tickDays: 1 },
      { az: sr.earthAz, el: sr.earthEl, from, to, now: k, stepH, rgb: EARTH_RGB, tickDays: 7 },
    ]
  }, [data, meta, k])

  // Draw at most once per frame, always using the latest state. Do not
  // cancel the scheduled frame on each change: playback updates the cursor every frame,
  // so cancellation would starve rendering (view rotation previously appeared only after stopping).
  const frame = useRef({ size, data, sky, basis, meta, sunFraction, view, stars, labels, tracks })
  const rafId = useRef(0)
  useEffect(() => {
    frame.current = { size, data, sky, basis, meta, sunFraction, view, stars, labels, tracks }
    if (rafId.current) return
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0
      const canvas = canvasRef.current
      const f = frame.current
      if (!canvas || f.size.w <= 0 || f.size.h <= 0) return
      const cw = Math.round(f.size.w * f.size.dpr), ch = Math.round(f.size.h * f.size.dpr)
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(f.size.dpr, 0, 0, f.size.dpr, 0, 0)
      if (!f.data || !f.sky || !f.basis || !f.meta) {
        ctx.fillStyle = '#02030a'
        ctx.fillRect(0, 0, f.size.w, f.size.h)
        return
      }
      drawSky(ctx, {
        w: f.size.w, h: f.size.h, mask: f.data.mask, sky: f.sky, sunFraction: f.sunFraction,
        sunRadiusDeg: f.meta.sun_radius_deg, basis: f.basis, view: f.view, stars: f.stars, labels: f.labels, tracks: f.tracks,
      })
    })
  }, [size, data, sky, basis, meta, sunFraction, view, stars, labels, tracks])
  useEffect(() => () => { cancelAnimationFrame(rafId.current); rafId.current = 0 }, [])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY }
    dragged.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || size.w <= 0) return
    const kPx = size.w / view.fov
    setView({ az: view.az - (e.clientX - d.x) / kPx, el: view.el + (e.clientY - d.y) / kPx })
    drag.current = { x: e.clientX, y: e.clientY }
    dragged.current = true
  }
  const endDrag = () => {
    if (drag.current && dragged.current) tourSignal('sky')
    drag.current = null
  }
  const zoom = (f: number) => setView({ fov: view.fov * f })
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = view.fov / 12
    const acts: Record<string, () => void> = {
      ArrowLeft: () => setView({ az: view.az - step }),
      ArrowRight: () => setView({ az: view.az + step }),
      ArrowUp: () => setView({ el: view.el + step / 2 }),
      ArrowDown: () => setView({ el: view.el - step / 2 }),
      '+': () => zoom(1 / ZOOM_STEP),
      '=': () => zoom(1 / ZOOM_STEP),
      '-': () => zoom(ZOOM_STEP),
    }
    const act = acts[e.key]
    if (act) {
      e.preventDefault()
      act()
      tourSignal('sky')
    }
  }

  const na = t('na')
  const sunState = sunFraction >= 0.99 ? t('dock.sunFull')
    : sunFraction > 0.01 ? fill(t('dock.sunPart'), { p: Math.round(sunFraction * 100) }) : t('dock.sunDown')
  const earthState = data && data.series.g[k] ? t('dock.earthVis') : t('dock.earthHid')
  const lit = sky ? Math.round(earthLitFraction(sky.earthPhaseDeg) * 100) : null
  const summary = sky && point ? fill(t('sky.summary'), {
    c: fmtCoord(point.latDeg, point.lonDeg, 2, na), sun: sunState, earth: earthState, p: lit ?? 0,
  }) : ''

  return (
    <div
      ref={wrapRef}
      className="sky"
      data-tour={slot === 'a' ? 'sky' : undefined}
      tabIndex={0}
      role="group"
      aria-label={t('sky.aria')}
      aria-describedby={`sky-${slot}-desc`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} className="sky-canvas" />
      <p id={`sky-${slot}-desc`} className="sr-only">{summary}</p>

      {status === 'loading' && <div className="sky-state">{t('panel.loading')}</div>}
      {status === 'error' && <div className="sky-state error">{t('sp.loadError')}</div>}

      {sky && data && (
        <dl className="sky-readout" aria-hidden="true">
          <div><dt className="sun">{t('dock.sun')}</dt><dd>el {sky.sunEl.toFixed(1)}° · az {sky.sunAz.toFixed(0)}°</dd></div>
          <div><dt className="earth">{t('dock.earth')}</dt><dd>el {sky.earthEl.toFixed(1)}° · az {sky.earthAz.toFixed(0)}° · {lit}%</dd></div>
        </dl>
      )}

      <div className="sky-tools">
        <span className="sky-zoom">
          <button type="button" className="sky-btn icon" aria-label={t('sky.zoomOut')} onClick={() => zoom(ZOOM_STEP)}>−</button>
          <button type="button" className="sky-btn icon" aria-label={t('sky.zoomIn')} onClick={() => zoom(1 / ZOOM_STEP)}>+</button>
        </span>
      </div>
      {point && (
        <SkyMiniMap slot={slot} latDeg={point.latDeg} lonDeg={point.lonDeg}
          sunAz={sky ? sky.sunAz : null} earthAz={sky ? sky.earthAz : null} />
      )}
      <div className="sky-hint" aria-hidden="true">
        <p className="sky-key"><span className="key-line sun" />{t('sky.trackSun')} <span className="key-line earth" />{t('sky.trackEarth')}</p>
        <p>{t('sky.hint')}</p>
      </div>
    </div>
  )
}
