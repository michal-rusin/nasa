// Rysowanie panoramy nieba na canvasie 2D. Rzut równoprostokątny w oknie fov × (fov·h/w):
// x = środek + Δaz·k, y = środek − (el − el₀)·k, k = w/fov px na stopień.
// Czarne niebo (brak atmosfery), gwiazdy z katalogu, Słońce 0,53°, Ziemia ≈1,9° z fazą, teren z maski.

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
  /** Ułamek tarczy Słońca nad horyzontem (series.f). */
  sunFraction: number
  sunRadiusDeg: number
  basis: EnuBasis
  view: SkyView
  stars: StarCatalog | null
  labels: { sun: string; earth: string }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Kolor gwiazdy z indeksu B–V (niebieskie → białe → pomarańczowe). */
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

  // 1. Tło: prawie czarne, z ledwo zaznaczoną poświatą przy horyzoncie.
  const horizonY = Y(0)
  const bg = ctx.createLinearGradient(0, 0, 0, Math.max(h, horizonY))
  bg.addColorStop(0, '#000104')
  bg.addColorStop(1, '#070a13')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // 2. Skala elewacji: delikatne linie co 5° z opisem po lewej.
  ctx.font = `10px ${MONO}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  // Linie co 5°, a przy małej skali rzadziej, żeby odstęp między nimi był ≥ 26 px.
  const elStep = k * 5 >= 26 ? 5 : k * 10 >= 26 ? 10 : 15
  for (let e = elStep; e <= 85; e += elStep) {
    const y = Y(e)
    if (y < 0 || y > h) continue
    ctx.fillStyle = 'rgba(255,255,255,0.045)'
    ctx.fillRect(0, y, w, 1)
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillText(`${e}°`, 10, y - 8)
  }

  // 3. Gwiazdy: kolor z B–V, wielkość z jasności; zalewane blaskiem Słońca w jego pobliżu.
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
        // Najjaśniejsze: miękki halo.
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5)
        g.addColorStop(0, `rgba(${cr},${cg},${cb},${(alpha * 0.35).toFixed(3)})`)
        g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        ctx.fillStyle = g
        ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10)
      }
    }
  }

  // 4. Ziemia: prawdziwy rozmiar kątowy, faza i jasny limb zwrócony ku Słońcu.
  const ex = X(sky.earthAz)
  const ey = Y(sky.earthEl)
  const er = Math.max(5, (sky.earthDiamDeg / 2) * k)
  if (ex > -er * 4 && ex < w + er * 4) drawEarth(ctx, ex, ey, er, sky.earthPhaseDeg, sky.earthLimbRad)

  // 5. Słońce: tarcza 0,53°, poświata addytywna (nad terenem, więc ją przycina sylwetka).
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

  // 6. Teren: sylwetka z maski, gradient wg wysokości, światło Słońca i Ziemi na grzbiecie.
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
    // Jasna krawędź grzbietu.
    ctx.beginPath()
    ctx.moveTo(xs[i]!, y0)
    ctx.lineTo(xs[i + 1]!, ys[i + 1]!)
    ctx.strokeStyle = bSun >= bEarth
      ? `rgba(255,228,180,${(0.9 * bSun).toFixed(3)})`
      : `rgba(140,185,255,${(0.9 * bEarth).toFixed(3)})`
    ctx.stroke()
  }

  // 7. Etykiety Słońca i Ziemi nad terenem.
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

  // 8. Kompas przy dolnej krawędzi.
  drawCompass(ctx, w, h, view, k)
}

function drawEarth(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, phaseDeg: number, limbRad: number,
): void {
  const lit = earthLitFraction(phaseDeg)
  ctx.save()
  // Poświata atmosfery.
  ctx.globalCompositeOperation = 'lighter'
  const halo = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 3.2)
  halo.addColorStop(0, `rgba(110,165,255,${(0.22 * lit + 0.03).toFixed(3)})`)
  halo.addColorStop(1, 'rgba(110,165,255,0)')
  ctx.fillStyle = halo
  ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4)
  ctx.restore()

  ctx.save()
  ctx.translate(x, y)
  // Strona nocna: światło popielate.
  const night = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  night.addColorStop(0, '#0f1c33')
  night.addColorStop(1, '#070f1e')
  ctx.fillStyle = night
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, TAU)
  ctx.fill()

  // Strona dzienna: półkole + połowa elipsy terminatora; jasny limb po +x po obrocie.
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

  // Cienki rąbek atmosfery.
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, TAU)
  ctx.lineWidth = 1
  ctx.strokeStyle = `rgba(150,200,255,${(0.25 + 0.3 * lit).toFixed(3)})`
  ctx.stroke()
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
