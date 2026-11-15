// Draw the sky panorama on a 2D canvas. Equirectangular projection in a fov × (fov·h/w) window:
// x = center + Δaz·k, y = center − (el − el₀)·k, k = w/fov px per degree.
// Black sky (no atmosphere), catalog stars, Sun 0.53°, phased Earth ≈1.9°, terrain from mask.

import { maskHeightDeg, type EnuBasis } from '../physics'
import { earthLitFraction, starEnu, wrapDeg, type SkyState, type StarCatalog } from './sky'
import type { SkyView } from './analysis'

const RAD = 180 / Math.PI
const TAU = Math.PI * 2
const MONO = '"JetBrains Mono", ui-monospace, monospace'
const COLUMN_STEP_PX = 1
const LIT_DEPTH_PX = 70

export interface SkyDrawInput {
  w: number
  h: number
  mask: Int16Array
  sky: SkyState
  /** Solar disk fraction above the horizon (series.f). */
  sunFraction: number
  sunRadiusDeg: number
  basis: EnuBasis
  view: SkyView
  stars: StarCatalog | null
  labels: { sun: string; earth: string }
  /** Sun and Earth sky tracks (from series), drawn over terrain. */
  tracks?: readonly SkyTrack[]
}

/** Body sky track over steps [from, to]; now = current step (past is fainter). */
export interface SkyTrack {
  az: ArrayLike<number>
  el: ArrayLike<number>
  from: number
  to: number
  now: number
  stepH: number
  rgb: readonly [number, number, number]
  /** Days between labeled markers (Earth moves slowly: weekly). */
  tickDays: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Star color from B–V index (blue → white → orange). */
function starRgb(bv: number): [number, number, number] {
  if (bv < 0.0) return [170, 195, 255]
  if (bv < 0.4) return [205, 220, 255]
  if (bv < 0.8) return [255, 248, 240]
  if (bv < 1.3) return [255, 224, 180]
  return [255, 190, 140]
}

export function drawSky(ctx: CanvasRenderingContext2D, inp: SkyDrawInput): void {
  const { w, h, mask, sky, view, basis } = inp
  const k = w / view.fov
  const X = (az: number) => w / 2 + wrapDeg(az - view.az) * k
  const Y = (el: number) => h / 2 - (el - view.el) * k
  const sunUp = clamp01((sky.sunEl + 0.8) / 2.5)
  const sunVis = Math.sqrt(clamp01(inp.sunFraction))

  // 1. Background: nearly black, with a faint horizon glow.
  const horizonY = Y(0)
  const bg = ctx.createLinearGradient(0, 0, 0, Math.max(h, horizonY))
  bg.addColorStop(0, '#000104')
  bg.addColorStop(1, '#070a13')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // 2. Elevation scale: subtle lines every 5° with labels on the left.
  ctx.font = `10px ${MONO}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  // Lines every 5°, less often at small scales to keep spacing ≥ 26 px.
  const elStep = k * 5 >= 26 ? 5 : k * 10 >= 26 ? 10 : 15
  for (let e = elStep; e <= 85; e += elStep) {
    const y = Y(e)
    if (y < 0 || y > h) continue
    ctx.fillStyle = 'rgba(255,255,255,0.045)'
    ctx.fillRect(0, y, w, 1)
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillText(`${e}°`, 10, y - 8)
  }

  // 3. Stars: color from B–V, size from brightness; washed out near the Sun.
  const cat = inp.stars
  if (cat && cat.n > 0) {
    const cd = Math.cos(sky.starDeltaDeg / RAD)
    const sd = Math.sin(sky.starDeltaDeg / RAD)
    const v: [number, number, number] = [0, 0, 0]
    const wash = sunVis > 0 ? sunVis : 0
    for (let i = 0; i < cat.n; i++) {
      const mag = cat.mag[i]!
      if (mag > 6.1) continue
      starEnu(cat, i, cd, sd, basis, v)
      const el = Math.asin(Math.min(1, Math.max(-1, v[2]))) * RAD
      if (el < -3) continue
      const x = X(Math.atan2(v[0], v[1]) * RAD)
      if (x < -4 || x > w + 4) continue
      const y = Y(el)
      if (y < -4 || y > h + 4) continue
      let alpha = Math.min(1, 0.3 + (6.2 - mag) * 0.17)
      if (wash > 0) {
        const cosAng = v[0] * sky.sunEnu[0] + v[1] * sky.sunEnu[1] + v[2] * sky.sunEnu[2]
        const ang = Math.acos(Math.min(1, Math.max(-1, cosAng))) * RAD
        alpha *= 1 - 0.9 * wash * Math.exp(-((ang / 24) ** 2))
      }
      if (alpha < 0.03) continue
      const r = Math.min(2.8, 0.55 + (6.2 - mag) * 0.3)
      const [cr, cg, cb] = starRgb(cat.bv[i]!)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()
      if (mag < 1.5) {
        // Brightest stars: soft halo.
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5)
        g.addColorStop(0, `rgba(${cr},${cg},${cb},${(alpha * 0.35).toFixed(3)})`)
        g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        ctx.fillStyle = g
        ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10)
      }
    }
  }

  // 4. Earth: true angular size, phase, and bright limb facing the Sun.
  const ex = X(sky.earthAz)
  const ey = Y(sky.earthEl)
  const er = Math.max(5, (sky.earthDiamDeg / 2) * k)
  if (ex > -er * 4 && ex < w + er * 4) drawEarth(ctx, ex, ey, er, sky.earthPhaseDeg, sky.earthLimbRad)

  // 5. Sun: 0.53° disk, additive glow (behind terrain, clipped by the silhouette).
  const sx = X(sky.sunAz)
  const sy = Y(sky.sunEl)
  const sr = Math.max(3, inp.sunRadiusDeg * k)
  if (sx > -200 && sx < w + 200) {
    if (sunVis > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const glowR = Math.max(60, sr * 22)
      const glow = ctx.createRadialGradient(sx, sy, sr * 0.6, sx, sy, glowR)
      glow.addColorStop(0, `rgba(255,236,200,${(0.75 * sunVis).toFixed(3)})`)
      glow.addColorStop(0.18, `rgba(255,205,140,${(0.28 * sunVis).toFixed(3)})`)
      glow.addColorStop(1, 'rgba(255,190,120,0)')
      ctx.fillStyle = glow
      ctx.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2)
      ctx.restore()
    }
    ctx.fillStyle = '#fffaf0'
    ctx.beginPath()
    ctx.arc(sx, sy, sr, 0, TAU)
    ctx.fill()
  }

  // 6. Terrain: mask silhouette, height gradient, sunlight and earthlight on the ridge.
  const xs: number[] = []
  const ys: number[] = []
  let yTop = h
  for (let x = 0; x <= w + COLUMN_STEP_PX; x += COLUMN_STEP_PX) {
    const az = view.az + (x - w / 2) / k
    const y = Y(maskHeightDeg(mask, az))
    xs.push(x)
    ys.push(y)
    if (y < yTop) yTop = y
  }
  const ground = ctx.createLinearGradient(0, Math.min(yTop, h - 40), 0, h)
  ground.addColorStop(0, '#2d3240')
  ground.addColorStop(0.22, '#141720')
  ground.addColorStop(1, '#030405')
  ctx.fillStyle = ground
  ctx.beginPath()
  ctx.moveTo(xs[0]!, h + 2)
  for (let i = 0; i < xs.length; i++) ctx.lineTo(xs[i]!, ys[i]!)
  ctx.lineTo(xs[xs.length - 1]!, h + 2)
  ctx.closePath()
  ctx.fill()

  ctx.beginPath()
  for (let i = 0; i < xs.length; i++) (i === 0 ? ctx.moveTo(xs[i]!, ys[i]!) : ctx.lineTo(xs[i]!, ys[i]!))
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(170, 185, 220, 0.22)'
  ctx.stroke()

  const earthUp = clamp01((sky.earthEl + 0.5) / 2)
  const earthShine = earthUp * earthLitFraction(sky.earthPhaseDeg) * 0.55
  const litGrad = ctx.createLinearGradient(0, 0, 0, LIT_DEPTH_PX)
  litGrad.addColorStop(0, 'rgba(255,214,150,0.40)')
  litGrad.addColorStop(1, 'rgba(255,214,150,0)')
  const shineGrad = ctx.createLinearGradient(0, 0, 0, LIT_DEPTH_PX * 0.6)
  shineGrad.addColorStop(0, 'rgba(110,160,255,0.30)')
  shineGrad.addColorStop(1, 'rgba(110,160,255,0)')
  ctx.lineWidth = 1.6
  for (let i = 0; i < xs.length - 1; i++) {
    const az = view.az + (xs[i]! - w / 2) / k
    const bSun = sunUp * Math.exp(-((wrapDeg(az - sky.sunAz) / 50) ** 2))
    const bEarth = earthShine * Math.exp(-((wrapDeg(az - sky.earthAz) / 28) ** 2))
    if (bSun < 0.02 && bEarth < 0.02) continue
    const y0 = ys[i]!
    if (y0 > h) continue
    ctx.save()
    ctx.translate(0, y0)
    if (bSun >= 0.02) {
      ctx.globalAlpha = bSun
      ctx.fillStyle = litGrad
      ctx.fillRect(xs[i]!, 0, COLUMN_STEP_PX, LIT_DEPTH_PX)
    }
    if (bEarth >= 0.02) {
      ctx.globalAlpha = bEarth
      ctx.fillStyle = shineGrad
      ctx.fillRect(xs[i]!, 0, COLUMN_STEP_PX, LIT_DEPTH_PX * 0.6)
    }
    ctx.restore()
    // Bright ridge edge.
    ctx.beginPath()
    ctx.moveTo(xs[i]!, y0)
    ctx.lineTo(xs[i + 1]!, ys[i + 1]!)
    ctx.strokeStyle = bSun >= bEarth
      ? `rgba(255,228,180,${(0.9 * bSun).toFixed(3)})`
      : `rgba(140,185,255,${(0.9 * bEarth).toFixed(3)})`
    ctx.stroke()
  }

  // 6b. Sun and Earth tracks: solid above terrain, dashed behind mountains.
  if (inp.tracks) for (const tr of inp.tracks) drawTrack(ctx, tr, w, h, X, Y, mask)

  // 7. Sun and Earth labels above terrain.
  ctx.font = `500 10px ${MONO}`
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const label = (text: string, x: number, y: number, r: number, color: string) => {
    if (x < 8 || x > w - 60 || y < 14 || y > h - 30) return
    ctx.fillStyle = color
    ctx.fillText(text, x + r + 8, y - r - 4)
    ctx.fillRect(x + r * 0.7 + 2, y - r * 0.7 - 2, 5, 1)
  }
  label(inp.labels.sun, sx, sy, sr, 'rgba(255,235,200,0.85)')
  label(inp.labels.earth, ex, ey, er, 'rgba(170,205,255,0.9)')

  // 8. Compass at the bottom edge.
  drawCompass(ctx, w, h, view, k)
}

function drawEarth(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phaseDeg: number, limbRad: number,
): void {
  const lit = earthLitFraction(phaseDeg)
  ctx.save()
  // Atmospheric glow.
  ctx.globalCompositeOperation = 'lighter'
  const halo = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 3.2)
  halo.addColorStop(0, `rgba(110,165,255,${(0.22 * lit + 0.03).toFixed(3)})`)
  halo.addColorStop(1, 'rgba(110,165,255,0)')
  ctx.fillStyle = halo
  ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4)
  ctx.restore()

  ctx.save()
  ctx.translate(x, y)
  // Night side: reflected light.
  const night = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  night.addColorStop(0, '#0f1c33')
  night.addColorStop(1, '#070f1e')
  ctx.fillStyle = night
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.fill()

  // Day side: semicircle + half terminator ellipse; bright limb along +x after rotation.
  ctx.rotate(limbRad)
  const c = Math.cos((phaseDeg * Math.PI) / 180)
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false)
  ctx.ellipse(0, 0, Math.max(0.001, Math.abs(c) * r), r, 0, Math.PI / 2, -Math.PI / 2, c < 0)
  ctx.closePath()
  const day = ctx.createRadialGradient(r * 0.3, -r * 0.2, 0, 0, 0, r * 1.05)
  day.addColorStop(0, '#e6f2ff')
  day.addColorStop(0.55, '#8fbcff')
  day.addColorStop(1, '#3f78d6')
  ctx.fillStyle = day
  ctx.fill()
  ctx.restore()

  // Thin atmospheric rim.
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.lineWidth = 1
  ctx.strokeStyle = `rgba(150,200,255,${(0.25 + 0.3 * lit).toFixed(3)})`
  ctx.stroke()
  ctx.restore()
}

function drawTrack(
  ctx: CanvasRenderingContext2D, tr: SkyTrack, w: number, h: number,
  X: (az: number) => number, Y: (el: number) => number, mask: Int16Array,
): void {
  const n = Math.min(tr.az.length, tr.el.length)
  const from = Math.max(0, tr.from)
  const to = Math.min(n - 1, tr.to)
  if (to <= from) return
  const stride = Math.max(1, Math.round(2 / tr.stepH)) // sample every ~2 h
  const [r, g, b] = tr.rgb
  ctx.save()
  ctx.lineCap = 'round'
  let px = NaN, py = NaN, pVis = false
  for (let i = from; i <= to; i += stride) {
    const az = tr.az[i]!, el = tr.el[i]!
    const x = X(az), y = Y(el)
    const vis = el >= maskHeightDeg(mask, az)
    // Break at panorama-edge crossings (azimuth wrap) or far outside the frame.
    const jump = Math.abs(x - px) > w / 2
    const off = (y < -40 && py < -40) || (y > h + 40 && py > h + 40)
    if (!Number.isNaN(px) && !jump && !off) {
      const past = i <= tr.now
      const both = vis && pVis
      ctx.setLineDash(both ? [] : [2, 5])
      ctx.lineWidth = both ? 1.6 : 1.2
      ctx.strokeStyle = `rgba(${r},${g},${b},${(both ? 0.75 : 0.35) * (past ? 0.4 : 1)})`
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    px = x; py = y; pVis = vis
  }
  ctx.setLineDash([])

  // Daily markers from now; label “+N d” when sufficiently separated from the previous label.
  const day = Math.max(1, Math.round(24 / tr.stepH)) * tr.tickDays
  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  let lx = NaN, ly = NaN
  for (let d = tr.tickDays, i = tr.now + day; i <= to; d += tr.tickDays, i += day) {
    const x = X(tr.az[i]!), y = Y(tr.el[i]!)
    if (x < 0 || x > w || y < 0 || y > h) continue
    ctx.fillStyle = `rgba(${r},${g},${b},0.9)`
    ctx.beginPath()
    ctx.arc(x, y, 2.2, 0, TAU)
    ctx.fill()
    if (Number.isNaN(lx) || Math.hypot(x - lx, y - ly) >= 56) {
      ctx.fillStyle = `rgba(${r},${g},${b},0.8)`
      ctx.fillText(`+${d} d`, x, y - 6)
      lx = x; ly = y
    }
  }
  ctx.restore()
}

const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }

function drawCompass(ctx: CanvasRenderingContext2D, w: number, h: number, view: SkyView, k: number): void {
  const major = view.fov > 100 ? 30 : view.fov > 50 ? 15 : 5
  const half = view.fov / 2
  const first = Math.ceil((view.az - half) / major) * major
  ctx.font = `10px ${MONO}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const y = h - 12
  for (let a = first; a <= view.az + half; a += major) {
    const norm = ((a % 360) + 360) % 360
    const x = w / 2 + (a - view.az) * k
    const name = CARDINALS[norm]
    ctx.fillStyle = name ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.38)'
    ctx.fillRect(Math.round(x), y - 14, 1, name ? 8 : 5)
    ctx.fillText(name ?? `${norm}°`, x, y)
  }
}
