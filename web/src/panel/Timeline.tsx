import { useCallback, useMemo } from 'react'
import { PANO_COLORS } from './Panorama'
import { bucketMean, monthTicks, type Span } from './timelineMath'
import { useCanvas } from './useCanvas'

const H = 66
const PAD_L = 62
const PAD_R = 8
const ROW = { label: 14, bar: 16, gap: 8 }

interface Props {
  f: Float32Array
  g: Uint8Array
  t0Utc: string
  stepS: number
  cursor: number
  trackLen: number
  night: Span
  commGap: Span
  onCursor: (step: number) => void
}

function mix(a: readonly number[], b: readonly number[], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
const DARK = [30, 30, 38] as const
const SUN = [255, 194, 58] as const
const EARTH = [74, 163, 255] as const

export function Timeline({ f, g, t0Utc, stepS, cursor, trackLen, night, commGap, onCursor }: Props) {
  const n = f.length
  const ticks = useMemo(() => monthTicks(t0Utc, stepS, n), [t0Utc, stepS, n])

  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number) => {
    const pw = w - PAD_L - PAD_R
    const X = (step: number) => PAD_L + (step / n) * pw
    const cols = Math.max(1, Math.floor(pw))
    const fb = bucketMean(f, cols)
    const gb = bucketMean(g, cols)
    const ySun = ROW.label, yEarth = ROW.label + ROW.bar + ROW.gap
    const yEnd = yEarth + ROW.bar

    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = mix(DARK, SUN, fb[c]!)
      ctx.fillRect(PAD_L + c, ySun, 1, ROW.bar)
      ctx.fillStyle = mix(DARK, EARTH, gb[c]!)
      ctx.fillRect(PAD_L + c, yEarth, 1, ROW.bar)
    }

    ctx.font = '11px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = PANO_COLORS.text
    ctx.fillText('Słońce', 4, ySun + ROW.bar / 2)
    ctx.fillText('Ziemia', 4, yEarth + ROW.bar / 2)

    // Miesiące.
    ctx.textBaseline = 'top'
    ctx.font = '10px system-ui, sans-serif'
    for (const t of ticks) {
      const x = Math.round(PAD_L + t.pos * pw)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(x, ySun, 1, yEnd - ySun)
      ctx.fillStyle = PANO_COLORS.text
      ctx.fillText(t.label, x + 3, 0)
    }

    // Najdłuższa noc / przerwa łączności.
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#ff5a5a'
    if (night.len > 0) ctx.strokeRect(X(night.start), ySun - 1, Math.max(2, X(night.start + night.len) - X(night.start)), ROW.bar + 2)
    if (commGap.len > 0) ctx.strokeRect(X(commGap.start), yEarth - 1, Math.max(2, X(commGap.start + commGap.len) - X(commGap.start)), ROW.bar + 2)

    // Doba księżycowa wokół kursora (ten sam odcinek co tory w panoramie) + kursor.
    const t0 = Math.max(0, cursor - Math.floor(trackLen / 2))
    const t1 = Math.min(n, t0 + trackLen)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(X(t0), ySun - 3, X(t1) - X(t0), yEnd - ySun + 6)
    const xc = Math.round(X(cursor)) + 0.5
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.setLineDash([2, 2])
    ctx.beginPath(); ctx.moveTo(xc, ySun - 4); ctx.lineTo(xc, yEnd + 4); ctx.stroke()
    ctx.setLineDash([])
  }, [f, g, n, ticks, cursor, trackLen, night, commGap])

  const ref = useCanvas(draw, H)

  const moveTo = (clientX: number, target: HTMLCanvasElement) => {
    const rect = target.getBoundingClientRect()
    const pw = rect.width - PAD_L - PAD_R
    if (pw <= 0) return
    onCursor(((clientX - rect.left - PAD_L) / pw) * n)
  }

  return (
    <div className="pp-canvas">
      <canvas ref={ref} className="pp-timeline"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); moveTo(e.clientX, e.currentTarget) }}
        onPointerMove={(e) => { if (e.buttons & 1) moveTo(e.clientX, e.currentTarget) }} />
    </div>
  )
}
