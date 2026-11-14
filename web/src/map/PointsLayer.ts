import type { FrameState } from 'ol/Map'
import Layer from 'ol/layer/Layer'
import { NO_DATA_RGB, normalize, rampRgb, rgbCss, type Range } from './colors'

/** Liczba kubełków koloru: punkty jednego kubełka rysujemy jedną ścieżką i jednym fill(). */
const N_BINS = 64
const NAN_BIN = N_BINS
const RADIUS_PX = 2.5
const SELECTED_RADIUS_PX = 5.5

export interface PointsStyle {
  values: Float32Array
  range: Range
  selectedIndex: number | null
}

export interface PointsLayerHandle {
  layer: Layer
  setStyle: (s: PointsStyle) => void
}

/**
 * Własna warstwa canvas dla punktów siatki (bez obiektu Feature na punkt).
 * cx, cy: współrzędne w metrach CRS rastrów (x_m, y_m z candidates.bin).
 */
export function createPointsLayer(cx: Float32Array, cy: Float32Array): PointsLayerHandle {
  const n = Math.min(cx.length, cy.length)
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.left = '0'
  canvas.style.top = '0'
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Przeglądarka nie obsługuje canvas 2D')

  // Punkty posortowane po kubełku koloru (sortowanie przez zliczanie).
  const order = new Int32Array(n)
  const offsets = new Int32Array(N_BINS + 2)
  const binColors: string[] = []
  for (let b = 0; b < N_BINS; b++) binColors.push(rgbCss(rampRgb((b + 0.5) / N_BINS)))
  binColors.push(rgbCss(NO_DATA_RGB))
  let style: PointsStyle | null = null

  function rebin(s: PointsStyle): void {
    const bins = new Uint8Array(n)
    const counts = new Int32Array(N_BINS + 1)
    for (let i = 0; i < n; i++) {
      const t = normalize(s.values[i]!, s.range.min, s.range.max)
      const b = Number.isNaN(t) ? NAN_BIN : Math.min(N_BINS - 1, Math.floor(t * N_BINS))
      bins[i] = b
      counts[b]!++
    }
    offsets[0] = 0
    for (let b = 0; b <= N_BINS; b++) offsets[b + 1] = offsets[b]! + counts[b]!
    const fill = offsets.slice(0, N_BINS + 1)
    for (let i = 0; i < n; i++) order[fill[bins[i]!]!++] = i
  }

  function render(fs: FrameState): HTMLElement {
    const pr = fs.pixelRatio
    const w = Math.round(fs.size[0]! * pr)
    const h = Math.round(fs.size[1]! * pr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      canvas.style.width = `${fs.size[0]}px`
      canvas.style.height = `${fs.size[1]}px`
    }
    ctx!.setTransform(1, 0, 0, 1, 0, 0)
    ctx!.clearRect(0, 0, w, h)
    if (!style) return canvas

    // Mapa → piksele CSS, potem × pixelRatio.
    const t = fs.coordinateToPixelTransform
    const a = t[0]! * pr, b = t[1]! * pr, c = t[2]! * pr, d = t[3]! * pr, e = t[4]! * pr, f = t[5]! * pr
    const r = RADIUS_PX * pr
    const margin = r / pr * fs.viewState.resolution
    const ext = fs.extent
    const minX = (ext ? ext[0]! : -Infinity) - margin
    const minY = (ext ? ext[1]! : -Infinity) - margin
    const maxX = (ext ? ext[2]! : Infinity) + margin
    const maxY = (ext ? ext[3]! : Infinity) + margin

    for (let bin = 0; bin <= N_BINS; bin++) {
      const from = offsets[bin]!
      const to = offsets[bin + 1]!
      if (from === to) continue
      ctx!.fillStyle = binColors[bin]!
      ctx!.beginPath()
      for (let k = from; k < to; k++) {
        const i = order[k]!
        const x = cx[i]!
        const y = cy[i]!
        if (x < minX || x > maxX || y < minY || y > maxY) continue
        const px = a * x + c * y + e
        const py = b * x + d * y + f
        ctx!.moveTo(px + r, py)
        ctx!.arc(px, py, r, 0, 2 * Math.PI)
      }
      ctx!.fill()
    }

    const sel = style.selectedIndex
    if (sel !== null && sel >= 0 && sel < n) {
      const x = cx[sel]!
      const y = cy[sel]!
      const px = a * x + c * y + e
      const py = b * x + d * y + f
      const tt = normalize(style.values[sel]!, style.range.min, style.range.max)
      ctx!.beginPath()
      ctx!.arc(px, py, SELECTED_RADIUS_PX * pr, 0, 2 * Math.PI)
      ctx!.fillStyle = rgbCss(Number.isNaN(tt) ? NO_DATA_RGB : rampRgb(tt))
      ctx!.fill()
      ctx!.lineWidth = 2 * pr
      ctx!.strokeStyle = '#ffffff'
      ctx!.stroke()
      ctx!.beginPath()
      ctx!.arc(px, py, (SELECTED_RADIUS_PX + 2) * pr, 0, 2 * Math.PI)
      ctx!.lineWidth = 1 * pr
      ctx!.strokeStyle = '#000000'
      ctx!.stroke()
    }
    return canvas
  }

  const layer = new Layer({ render, zIndex: 20 })

  return {
    layer,
    setStyle(s) {
      if (!style || style.values !== s.values || style.range !== s.range) rebin(s)
      style = s
      layer.changed()
    },
  }
}
