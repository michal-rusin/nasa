import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { fmtCoord } from '../app/coords'
import { fill, useT } from '../i18n'
import { enuBasis } from '../physics'
import { useStore } from '../store'
import { useAnalysis, type SlotKey } from './analysis'
import { earthLitFraction, skyState } from './sky'
import { drawSky } from './skyDraw'
import { useStars } from './stars'

interface Props {
  slot: SlotKey
  index: number
}

const ZOOM_STEP = 1.25

/** Panorama nieba z punktu: czarne niebo, gwiazdy, Słońce, Ziemia z fazą i sylwetka terenu. */
export function SkyPanorama({ slot, index }: Props) {
  const t = useT()
  const meta = useStore((s) => s.meta)
  const c = useStore((s) => s.candidates)
  const status = useAnalysis((s) => s[slot].status)
  const data = useAnalysis((s) => s[slot].data)
  const ephem = useAnalysis((s) => s.ephem)
  const cursor = useAnalysis((s) => s.cursor)
  const view = useAnalysis((s) => s.view)
  const setView = useAnalysis((s) => s.setView)
  const stars = useStars()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  // Rozmiar canvasa = rozmiar kontenera (CSS ustala wysokość, np. 50vh).
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

  // Ctrl/⌘ + kółko (też gest „pinch” na gładziku) przybliża; zwykłe kółko przewija stronę.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setView({ fov: useAnalysis.getState().view.fov * Math.exp(e.deltaY * 0.003) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setView])

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w <= 0 || size.h <= 0) return
    const id = requestAnimationFrame(() => {
      canvas.width = Math.round(size.w * size.dpr)
      canvas.height = Math.round(size.h * size.dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
      if (!data || !sky || !basis || !meta) {
        ctx.fillStyle = '#02030a'
        ctx.fillRect(0, 0, size.w, size.h)
        return
      }
      drawSky(ctx, {
        w: size.w, h: size.h, mask: data.mask, sky, sunFraction,
        sunRadiusDeg: meta.sun_radius_deg, basis, view, stars, labels,
      })
    })
    return () => cancelAnimationFrame(id)
  }, [size, data, sky, basis, meta, sunFraction, view, stars, labels])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || size.w <= 0) return
    const kPx = size.w / view.fov
    setView({ az: view.az - (e.clientX - d.x) / kPx, el: view.el + (e.clientY - d.y) / kPx })
    drag.current = { x: e.clientX, y: e.clientY }
  }
  const endDrag = () => { drag.current = null }
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
        <button type="button" className="sky-btn" onClick={() => sky && setView({ az: sky.sunAz })}>{t('sky.centerSun')}</button>
        <button type="button" className="sky-btn" onClick={() => sky && setView({ az: sky.earthAz })}>{t('sky.centerEarth')}</button>
        <span className="sky-zoom">
          <button type="button" className="sky-btn icon" aria-label={t('sky.zoomOut')} onClick={() => zoom(ZOOM_STEP)}>−</button>
          <button type="button" className="sky-btn icon" aria-label={t('sky.zoomIn')} onClick={() => zoom(1 / ZOOM_STEP)}>+</button>
        </span>
      </div>
      <p className="sky-hint" aria-hidden="true">{t('sky.hint')}</p>
    </div>
  )
}
