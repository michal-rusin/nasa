// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useEffect, useMemo, useRef, type PointerEvent } from 'react'
import { getProjString } from '../data/load'
import { useT } from '../i18n'
import { latLonToXY } from '../map/projection'
import { useStore } from '../store'
import { useAnalysis, type SlotKey } from './analysis'

/** Drawing size in CSS px; CSS may reduce it (e.g. when comparing two locations). */
const SIZE = 88
const DEG = Math.PI / 180

interface Props {
  slot: SlotKey
  latDeg: number
  lonDeg: number
  sunAz: number | null
  earthAz: number | null
}

type Vec = [number, number]

/** Azimuth direction (0 = local north, increasing through east) as a unit vector (y down). */
function dirOnMap(n: Vec, e: Vec, az: number): Vec {
  const ca = Math.cos(az * DEG), sa = Math.sin(az * DEG)
  return [n[0] * ca + e[0] * sa, n[1] * ca + e[1] * sa]
}

/**
 * Minimal panorama compass oriented like the pole map: cone = view direction and width,
 * of view, rim dots = Sun and Earth, N mark = local north (at the pole it points
 * away from the pole). Click/drag rotates the view.
 */
export function SkyMiniMap({ slot, latDeg, lonDeg, sunAz, earthAz }: Props) {
  const t = useT()
  const meta = useStore((s) => s.meta)
  const view = useAnalysis((s) => s.views[slot])
  const setView = useAnalysis((s) => s.setView)
  const ref = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)

  // Local N and E vectors in pole-map orientation.
  const axes = useMemo(() => {
    if (!meta || !Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null
    const proj = getProjString(meta)
    const R = meta.moon_radius_km * 1000
    const [x, y] = latLonToXY(proj, R, latDeg, lonDeg)
    const [xn, yn] = latLonToXY(proj, R, Math.min(latDeg + 0.02, 89.99), lonDeg)
    const [xe, ye] = latLonToXY(proj, R, latDeg, lonDeg + 0.02)
    const unit = (dx: number, dy: number): Vec => {
      const l = Math.hypot(dx, dy) || 1
      return [dx / l, -dy / l]
    }
    return { n: unit(xn - x, yn - y), e: unit(xe - x, ye - y) }
  }, [meta, latDeg, lonDeg])

  useEffect(() => {
    const cv = ref.current
    if (!cv || !axes) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = SIZE * dpr
    cv.height = SIZE * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)
    const c = SIZE / 2
    const r = c - 7
    const dir = (az: number) => dirOnMap(axes.n, axes.e, az)

    // View cone.
    const half = Math.min(170, view.fov / 2)
    ctx.beginPath()
    ctx.moveTo(c, c)
    for (let i = 0; i <= 24; i++) {
      const [dx, dy] = dir(view.az - half + (2 * half * i) / 24)
      ctx.lineTo(c + dx * r, c + dy * r)
    }
    ctx.closePath()
    const [vx, vy] = dir(view.az)
    const g = ctx.createLinearGradient(c, c, c + vx * r, c + vy * r)
    g.addColorStop(0, 'rgba(156, 196, 255, 0.5)')
    g.addColorStop(1, 'rgba(156, 196, 255, 0.06)')
    ctx.fillStyle = g
    ctx.fill()

    // Rim and short ticks every 90° (N is longer and red).
    ctx.beginPath()
    ctx.arc(c, c, r, 0, 2 * Math.PI)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = 1
    ctx.stroke()
    for (const az of [90, 180, 270]) {
      const [dx, dy] = dir(az)
      ctx.beginPath()
      ctx.moveTo(c + dx * (r - 4), c + dy * (r - 4))
      ctx.lineTo(c + dx * r, c + dy * r)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
      ctx.stroke()
    }
    const [nx, ny] = dir(0)
    ctx.beginPath()
    ctx.moveTo(c + nx * (r - 7), c + ny * (r - 7))
    ctx.lineTo(c + nx * r, c + ny * r)
    ctx.strokeStyle = '#ff8a7a'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.font = '600 8.5px "JetBrains Mono", ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ff8a7a'
    ctx.fillText('N', c + nx * (r - 13), c + ny * (r - 13))

    // Sun and Earth on the rim.
    const dot = (az: number | null, fill: string) => {
      if (az === null) return
      const [dx, dy] = dir(az)
      ctx.save()
      ctx.shadowColor = fill
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.arc(c + dx * r, c + dy * r, 3.5, 0, 2 * Math.PI)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.restore()
    }
    dot(sunAz, '#ffc23a')
    dot(earthAz, '#4aa3ff')

    // Observer position.
    ctx.beginPath()
    ctx.arc(c, c, 2.5, 0, 2 * Math.PI)
    ctx.fillStyle = slot === 'b' ? '#ffb35c' : '#ffffff'
    ctx.fill()
  }, [axes, view.az, view.fov, sunAz, earthAz, slot])

  const turnTo = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!axes) return
    const b = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - b.left - b.width / 2
    const y = e.clientY - b.top - b.height / 2
    if (Math.hypot(x, y) < 4) return
    const vn = x * axes.n[0] + y * axes.n[1]
    const ve = x * axes.e[0] + y * axes.e[1]
    setView(slot, { az: Math.atan2(ve, vn) / DEG })
  }

  if (!axes) return null
  return (
    <canvas ref={ref} className="sky-mini" role="img" aria-label={t('sky.minimap')}
      onPointerDown={(e) => {
        e.stopPropagation()
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        turnTo(e)
      }}
      onPointerMove={(e) => { if (dragging.current) { e.stopPropagation(); turnTo(e) } }}
      onPointerUp={() => { dragging.current = false }}
      onPointerCancel={() => { dragging.current = false }} />
  )
}
