import { useCallback, useMemo } from 'react'
import { MASK_SAMPLES, MASK_SCALE, MASK_STEP_DEG, type Series } from '../physics'
import type { Envelope } from './envelope'
import { useCanvas } from './useCanvas'

const PAD = { l: 34, r: 8, t: 8, b: 18 }

export const PANO_COLORS = {
  grid: '#262630',
  zero: '#6a6a78',
  text: '#8a8a96',
  terrain: '#3b3f4f',
  terrainEdge: '#7d8399',
  envelope: 'rgba(255, 196, 70, 0.10)',
  sun: '#ffc23a',
  earth: '#4aa3ff',
}
const C = PANO_COLORS

interface Props {
  mask: Int16Array
  series: Series
  envelope: Envelope
  cursor: number
  /** Długość toru wokół kursora w krokach (jedna doba księżycowa). */
  trackLen: number
  height: number
}

/**
 * Zakres osi Y dopasowany do danych (skala mocno przesadzona, bo przy biegunie
 * Słońce chodzi ±1,5–6°): od min(maska, −1) − 1 do max(maska, Słońce, Ziemia) + 1,
 * co najmniej 8°.
 */
export function panoramaYRange(mask: Int16Array, s: Series): [number, number] {
  let mMin = Infinity, mMax = -Infinity
  for (let k = 0; k < mask.length; k++) {
    const v = mask[k]! * MASK_SCALE
    if (v < mMin) mMin = v
    if (v > mMax) mMax = v
  }
  let top = mMax
  for (let k = 0; k < s.sunEl.length; k++) {
    if (s.sunEl[k]! > top) top = s.sunEl[k]!
    if (s.earthEl[k]! > top) top = s.earthEl[k]!
  }
  const lo = Math.floor(Math.min(mMin, -1) - 1)
  let hi = Math.ceil(top + 1)
  if (hi - lo < 8) hi = lo + 8
  return [lo, hi]
}

function gridStep(span: number): number {
  return span <= 10 ? 1 : span <= 20 ? 2 : 5
}

export function Panorama({ mask, series, envelope, cursor, trackLen, height }: Props) {
  const [yLo, yHi] = useMemo(() => panoramaYRange(mask, series), [mask, series])

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b
    const X = (az: number) => PAD.l + (az / 360) * pw
    const Y = (el: number) => PAD.t + ((yHi - el) / (yHi - yLo)) * ph
    const bottom = PAD.t + ph
    const n = series.f.length
    const k = Math.min(n - 1, Math.max(0, cursor))
    const t0 = Math.max(0, k - Math.floor(trackLen / 2))
    const t1 = Math.min(n, t0 + trackLen)
    const step = gridStep(yHi - yLo)

    ctx.font = '11px system-ui, sans-serif'
    ctx.lineWidth = 1

    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD.l, PAD.t, pw, ph)
    ctx.clip()

    // Siatka: azymut co 30°, elewacja co `step`.
    ctx.strokeStyle = C.grid
    ctx.beginPath()
    for (let az = 30; az < 360; az += 30) { ctx.moveTo(Math.round(X(az)) + 0.5, PAD.t); ctx.lineTo(Math.round(X(az)) + 0.5, bottom) }
    for (let el = Math.ceil(yLo / step) * step; el <= yHi; el += step) {
      ctx.moveTo(PAD.l, Math.round(Y(el)) + 0.5); ctx.lineTo(PAD.l + pw, Math.round(Y(el)) + 0.5)
    }
    ctx.stroke()

    // Obwiednia roczna Słońca: gładkie pasmo przez środki przedziałów, cyklicznie.
    const nb = envelope.min.length, bd = envelope.binDeg
    ctx.fillStyle = C.envelope
    const run: number[] = []
    const flush = () => {
      if (run.length > 0) {
        ctx.beginPath()
        run.forEach((b, j) => {
          const x = X((b + 0.5) * bd), y = Y(envelope.max[((b % nb) + nb) % nb]!)
          if (j === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        for (let j = run.length - 1; j >= 0; j--) {
          const b = run[j]!
          ctx.lineTo(X((b + 0.5) * bd), Y(envelope.min[((b % nb) + nb) % nb]!))
        }
        ctx.closePath()
        ctx.fill()
      }
      run.length = 0
    }
    for (let b = -1; b <= nb; b++) {
      if (Number.isNaN(envelope.min[((b % nb) + nb) % nb]!)) flush()
      else run.push(b)
    }
    flush()

    // Tory w dobie księżycowej wokół kursora (przerywane, przerwa na zawinięciu azymutu).
    const track = (az: Float32Array, el: Float32Array, color: string, dash: number[]) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.setLineDash(dash)
      ctx.beginPath()
      for (let i = t0; i < t1; i++) {
        const x = X(az[i]!), y = Y(el[i]!)
        if (i === t0 || Math.abs(az[i]! - az[i - 1]!) > 180) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1
    }
    track(series.sunAz, series.sunEl, C.sun, [5, 4])
    track(series.earthAz, series.earthEl, C.earth, [3, 4])

    // Teren zasłania tory (sylwetka maski, cyklicznie: próbka 0 domyka 360°).
    ctx.beginPath()
    ctx.moveTo(X(0), bottom)
    for (let i = 0; i <= MASK_SAMPLES; i++) ctx.lineTo(X(i * MASK_STEP_DEG), Y(mask[i % MASK_SAMPLES]! * MASK_SCALE))
    ctx.lineTo(X(360), bottom)
    ctx.closePath()
    ctx.fillStyle = C.terrain
    ctx.fill()
    ctx.strokeStyle = C.terrainEdge
    ctx.beginPath()
    for (let i = 0; i <= MASK_SAMPLES; i++) {
      const x = X(i * MASK_STEP_DEG), y = Y(mask[i % MASK_SAMPLES]! * MASK_SCALE)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Linia 0°.
    ctx.strokeStyle = C.zero
    ctx.setLineDash([2, 3])
    ctx.beginPath(); ctx.moveTo(PAD.l, Math.round(Y(0)) + 0.5); ctx.lineTo(PAD.l + pw, Math.round(Y(0)) + 0.5); ctx.stroke()
    ctx.setLineDash([])

    // Tarcze w chwili kursora: pełne gdy widoczne, przerywany kontur gdy zasłonięte.
    const disc = (x: number, y: number, r: number, color: string, vis: number) => {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      if (vis > 0.01) {
        ctx.globalAlpha = vis >= 0.99 ? 1 : 0.6
        ctx.fillStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = vis >= 0.99 ? 10 : 4
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      } else {
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineWidth = 1
      }
    }
    disc(X(series.earthAz[k]!), Y(series.earthEl[k]!), 8, C.earth, series.g[k]!)
    disc(X(series.sunAz[k]!), Y(series.sunEl[k]!), 7, C.sun, series.f[k]!)
    ctx.restore()

    // Podpisy osi.
    ctx.fillStyle = C.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const card = ['N', 'E', 'S', 'W', 'N']
    for (let i = 0; i <= 4; i++) {
      const x = Math.min(PAD.l + pw - 4, Math.max(PAD.l + 4, X(i * 90)))
      ctx.fillText(card[i]!, x, bottom + 4)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let el = Math.ceil(yLo / step) * step; el <= yHi; el += step) ctx.fillText(`${el}°`, PAD.l - 5, Y(el))
  }, [mask, series, envelope, cursor, trackLen, yLo, yHi])

  const ref = useCanvas(draw, height)
  return <div className="pp-canvas"><canvas ref={ref} /></div>
}
