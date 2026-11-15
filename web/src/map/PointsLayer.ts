import type { FrameState } from 'ol/Map'
import Layer from 'ol/layer/Layer'
import { NO_DATA_RGB, normalize, rampRgb, rgbCss, type Range, type RGB } from './colors'
import { detectGrid } from './grid'
import type { ModeTheme } from './themes'

/** Liczba kubełków koloru (tryb punktowy): punkty jednego kubełka rysujemy jednym fill(). */
const N_BINS = 64
const NAN_BIN = N_BINS
/** Punkty niespełniające filtrów: nie są rysowane wcale (znikają z mapy). */
const HIDDEN_BIN = N_BINS + 1
const N_ALL_BINS = N_BINS + 2
const DRAW_BINS = [NAN_BIN, ...Array.from({ length: N_BINS }, (_, b) => b)]
/** Bok kwadratu punktu w trybie punktowym, gdy dane nie mają regularnej siatki. */
const SIZE_PX = 3
/** Zagęszczenie `level = 1` ma oczko 250 m (kontrakt 3.1); tak duże kwadraty rysujemy na wierzchu pola. */
const FINE_CELL_M = 250
const SELECTED_RADIUS_PX = 6
const HOVER_RADIUS_PX = 5
const MONO = '"JetBrains Mono", ui-monospace, monospace'
/** Maks. liczba plakietek z animacją (Top N ≤ tyle). */
const MAX_BADGES = 32
/** Odsłanianie pola rankingu: czas przejścia [ms]. */
const REVEAL_MS = 900
/** Plakietki wskakują po kolei: opóźnienie startu i odstęp między kolejnymi [ms]. */
const BADGE_DELAY_MS = 380
const BADGE_STAGGER_MS = 60
/** Sprężyna plakietek (lekko niedotłumiona, jak w iOS): sztywność i tłumienie. */
const SPRING_K = 420
const SPRING_C = 26
/** Powiększenie plakietki pod kursorem. */
const BADGE_HOVER_SCALE = 1.45

/** Promień plakietki Top N w px CSS przy danej rozdzielczości (do hit-testu w createMap). */
export function badgeRadiusPx(rank: number, resolution: number): number {
  const base = resolution > 350 ? 11.5 : 10
  return rank === 0 ? base * 1.2 : base
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface PointsStyle {
  values: ArrayLike<number>
  range: Range
  /** true dla metryk „mniej = lepiej”: rampa odwrócona, jasny = dobry. */
  invert: boolean
  /** 1 = spełnia filtry; null = wszystkie spełniają. */
  mask: Uint8Array | null
  /** Indeksy top-N w kolejności rankingu (numerowane pierścienie). */
  top: readonly number[]
  /** Miejsce A (zaznaczone) i B (porównanie). */
  selectedIndex: number | null
  compareIndex: number | null
  /** Skala kolorów i kolor plakietek wersji rankingu. */
  theme: ModeTheme
}

export interface PointsLayerHandle {
  layer: Layer
  setStyle: (s: PointsStyle) => void
  setHover: (i: number | null) => void
  /** Podświetlenie z listy Top 10 (działa jak najechanie na mapie). */
  setHighlight: (i: number | null) => void
  /** Krycie samego pola/kwadratów (znaczniki i obrys zostają pełne). */
  setOpacity: (v: number) => void
  /** Pokazuje lub chowa kolory rankingu i plakietki (z animacją). */
  setRevealed: (on: boolean) => void
  /** Czy ranking jest włączony. */
  isRevealed: () => boolean
  dispose: () => void
}

/**
 * Własna warstwa canvas dla punktów kandydatów (bez obiektu Feature na punkt).
 * Punkty poziomu 0 (siatka 2 km) rysujemy jako gładkie pole wartości (jeden piksel obrazu
 * na punkt, skalowanie z wygładzaniem); zagęszczenia (poziom ≠ 0) jako drobne kwadraty na wierzchu.
 * Jeśli poziom 0 nie jest regularną siatką, wszystkie punkty idą jako kwadraty.
 * Na koniec: poświata krawędzi obszaru (okrąg o promieniu regionRadiusM wokół 0,0).
 * cx, cy: współrzędne w metrach CRS rastrów (x_m, y_m z candidates.bin).
 */
export function createPointsLayer(
  cx: Float32Array,
  cy: Float32Array,
  regionRadiusM: number,
  level?: ArrayLike<number>,
): PointsLayerHandle {
  const n = Math.min(cx.length, cy.length)
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.left = '0'
  canvas.style.top = '0'
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not supported')

  const coarse: number[] = []
  const fine: number[] = []
  for (let i = 0; i < n; i++) (!level || level[i] === 0 ? coarse : fine).push(i)
  const coarseIdx = Int32Array.from(coarse)
  const grid = detectGrid(Float32Array.from(coarse, (i) => cx[i]!), Float32Array.from(coarse, (i) => cy[i]!))
  // Tryb punktowy obejmuje: zagęszczenia (gdy jest pole) albo wszystkie punkty (gdy pola nie ma).
  const pointIdx = Int32Array.from(grid ? fine : Array.from({ length: n }, (_, i) => i))
  const field = grid ? document.createElement('canvas') : null
  const fctx = field?.getContext('2d') ?? null
  if (grid && field) {
    field.width = grid.nx
    field.height = grid.ny
  }

  // Tryb punktowy: punkty posortowane po kubełku koloru (sortowanie przez zliczanie).
  const order = new Int32Array(pointIdx.length)
  const offsets = new Int32Array(N_ALL_BINS + 1)
  let binColors: string[] = []
  const makeBinColors = (ramp: readonly RGB[]) => {
    binColors = []
    for (let b = 0; b < N_BINS; b++) binColors.push(rgbCss(rampRgb((b + 0.5) / N_BINS, ramp)))
    binColors.push(rgbCss(NO_DATA_RGB))
  }
  let style: PointsStyle | null = null
  let hover: number | null = null
  let highlight: number | null = null
  let opacity = 1

  // Animacje: odsłanianie pola (0..1) i sprężyny skali plakietek.
  let revealed = false
  let reveal = 0
  let revealedAt = 0
  const bScale = new Float32Array(MAX_BADGES)
  const bVel = new Float32Array(MAX_BADGES)
  let raf = 0
  let lastT = 0
  const hot = () => hover ?? highlight

  function badgeTarget(rank: number, now: number): number {
    if (!revealed || !style || rank >= style.top.length) return 0
    if (now < revealedAt + BADGE_DELAY_MS + rank * BADGE_STAGGER_MS) return 0
    return style.top[rank] === hot() ? BADGE_HOVER_SCALE : 1
  }
  function step(now: number): void {
    const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 1 / 60)
    lastT = now
    let moving = false
    if (prefersReducedMotion()) {
      reveal = revealed ? 1 : 0
      for (let r = 0; r < MAX_BADGES; r++) { bScale[r] = badgeTarget(r, Infinity); bVel[r] = 0 }
    } else {
      if (reveal !== (revealed ? 1 : 0)) {
        const d = (dt * 1000) / (revealed ? REVEAL_MS : REVEAL_MS * 0.5)
        reveal = revealed ? Math.min(1, reveal + d) : Math.max(0, reveal - d)
        moving = true
      }
      for (let r = 0; r < MAX_BADGES; r++) {
        if (!revealed) {
          // Chowanie: szybkie, bez odbicia.
          bScale[r] = Math.max(0, bScale[r]! - dt * 6)
          bVel[r] = 0
          if (bScale[r]! > 0) moving = true
          continue
        }
        const tg = badgeTarget(r, now)
        if (tg === 0 && style && r < style.top.length) moving = true // czeka na swoją kolej
        const x = bScale[r]!, v = bVel[r]!
        const a = SPRING_K * (tg - x) - SPRING_C * v
        const nv = v + a * dt
        const nx = x + nv * dt
        if (Math.abs(tg - nx) > 0.002 || Math.abs(nv) > 0.01) {
          bVel[r] = nv
          bScale[r] = nx
          moving = true
        } else {
          bScale[r] = tg
          bVel[r] = 0
        }
      }
    }
    layer.changed()
    if (moving) raf = requestAnimationFrame(step)
    else { raf = 0; lastT = 0 }
  }
  function kick(): void {
    if (raf === 0) raf = requestAnimationFrame(step)
  }

  function colorT(s: PointsStyle, i: number): number {
    const t = normalize(s.values[i]!, s.range.min, s.range.max)
    return s.invert && !Number.isNaN(t) ? 1 - t : t
  }
  function rgbOf(s: PointsStyle, i: number): RGB {
    const t = colorT(s, i)
    return Number.isNaN(t) ? NO_DATA_RGB : rampRgb(t, s.theme.ramp)
  }

  function rebuild(s: PointsStyle): void {
    makeBinColors(s.theme.ramp)
    if (grid && fctx && field) {
      const img = fctx.createImageData(grid.nx, grid.ny)
      const d = img.data
      for (let kk = 0; kk < coarseIdx.length; kk++) {
        const i = coarseIdx[kk]!
        if (s.mask && s.mask[i] === 0) continue // alfa 0: odfiltrowany znika
        const c = rgbOf(s, i)
        const o = (grid.row[kk]! * grid.nx + grid.col[kk]!) * 4
        d[o] = c[0]
        d[o + 1] = c[1]
        d[o + 2] = c[2]
        d[o + 3] = 255
      }
      fctx.putImageData(img, 0, 0)
    }
    const m = pointIdx.length
    const bins = new Uint8Array(m)
    const counts = new Int32Array(N_ALL_BINS)
    for (let j = 0; j < m; j++) {
      const i = pointIdx[j]!
      let b: number
      if (s.mask && s.mask[i] === 0) b = HIDDEN_BIN
      else {
        const t = colorT(s, i)
        b = Number.isNaN(t) ? NAN_BIN : Math.min(N_BINS - 1, Math.floor(t * N_BINS))
      }
      bins[j] = b
      counts[b]!++
    }
    offsets[0] = 0
    for (let b = 0; b < N_ALL_BINS; b++) offsets[b + 1] = offsets[b]! + counts[b]!
    const fill = offsets.slice(0, N_ALL_BINS)
    for (let j = 0; j < m; j++) order[fill[bins[j]!]!++] = pointIdx[j]!
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

    // Mapa → piksele CSS, potem × pixelRatio.
    const t = fs.coordinateToPixelTransform
    const a = t[0]! * pr, b = t[1]! * pr, c = t[2]! * pr, d = t[3]! * pr, e = t[4]! * pr, f = t[5]! * pr
    const px = (x: number, y: number) => a * x + c * y + e
    const py = (x: number, y: number) => b * x + d * y + f
    const res = fs.viewState.resolution

    // Poświata krawędzi obszaru: rysowana zawsze, także przy ukrytych punktach.
    const ox = px(0, 0), oy = py(0, 0)
    const rr = (regionRadiusM / res) * pr
    ctx!.save()
    ctx!.beginPath()
    ctx!.arc(ox, oy, rr, 0, 2 * Math.PI)
    ctx!.shadowColor = 'rgba(140, 180, 255, 0.55)'
    ctx!.shadowBlur = 28 * pr
    ctx!.lineWidth = 1 * pr
    ctx!.strokeStyle = 'rgba(200, 220, 255, 0.45)'
    ctx!.stroke()
    ctx!.restore()

    if (!style) return canvas
    const s = style

    const ease = easeInOutCubic(reveal)
    if (ease > 0) {
    ctx!.save()
    ctx!.globalAlpha = opacity * ease
    if (ease < 1) {
      // Kolory rozlewają się od bieguna ku krawędzi obszaru.
      ctx!.beginPath()
      ctx!.arc(ox, oy, rr * (0.06 + ease), 0, 2 * Math.PI)
      ctx!.clip()
    }
    if (grid && field) {
      const half = grid.step / 2
      const x0 = px(grid.x0 - half, grid.yTop + half)
      const y0 = py(grid.x0 - half, grid.yTop + half)
      const x1 = px(grid.x0 + (grid.nx - 1) * grid.step + half, grid.yTop - (grid.ny - 1) * grid.step - half)
      const y1 = py(grid.x0 + (grid.nx - 1) * grid.step + half, grid.yTop - (grid.ny - 1) * grid.step - half)
      ctx!.imageSmoothingEnabled = true
      ctx!.imageSmoothingQuality = 'high'
      ctx!.drawImage(field, x0, y0, x1 - x0, y1 - y0)
    }
    if (pointIdx.length > 0) {
      // Przy polu: kwadraty zagęszczenia wielkości oczka 250 m (min. 2,2 px); bez pola: stałe 3 px.
      const sz = (grid ? Math.min(10, Math.max(2.2, (FINE_CELL_M * 0.85) / res)) : SIZE_PX) * pr
      const hs = sz / 2
      for (const bin of DRAW_BINS) {
        const from = offsets[bin]!
        const to = offsets[bin + 1]!
        if (from === to) continue
        ctx!.fillStyle = binColors[bin]!
        ctx!.beginPath()
        for (let k = from; k < to; k++) {
          const i = order[k]!
          ctx!.rect(px(cx[i]!, cy[i]!) - hs, py(cx[i]!, cy[i]!) - hs, sz, sz)
        }
        ctx!.fill()
      }
    }
    ctx!.restore()
    }

    const ipx = (i: number) => px(cx[i]!, cy[i]!)
    const ipy = (i: number) => py(cx[i]!, cy[i]!)

    // Top-N: białe plakietki z numerem (#1 złota, największa i na wierzchu). Przy oddaleniu
    // powiększone, żeby na tle gęstego pola kolorów było je widać od razu.
    if (s.top.length > 0) {
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'middle'
      const hotI = hot()
      // Od ostatniego do #1, a wskazana plakietka na samym wierzchu.
      const order = Array.from({ length: Math.min(MAX_BADGES, s.top.length) }, (_, r) => r).reverse()
      const hr = order.findIndex((r) => s.top[r] === hotI)
      if (hr >= 0) order.push(order.splice(hr, 1)[0]!)
      for (const rank of order) {
        const i = s.top[rank]!
        const sc = bScale[rank]!
        if (i < 0 || i >= n || sc <= 0.01) continue
        const r = badgeRadiusPx(rank, res) * pr
        ctx!.save()
        ctx!.translate(ipx(i), ipy(i))
        ctx!.scale(sc, sc)
        if (i === hotI) {
          // Miękka aureola wokół wskazanej plakietki.
          const g = ctx!.createRadialGradient(0, 0, r, 0, 0, r * 2.4)
          g.addColorStop(0, `${s.theme.accent}88`)
          g.addColorStop(1, `${s.theme.accent}00`)
          ctx!.fillStyle = g
          ctx!.beginPath()
          ctx!.arc(0, 0, r * 2.4, 0, 2 * Math.PI)
          ctx!.fill()
        }
        // Plakietka w kolorze wersji rankingu; #1 z białą obwódką.
        ctx!.save()
        ctx!.shadowColor = 'rgba(0, 0, 0, 0.9)'
        ctx!.shadowBlur = 9 * pr
        ctx!.beginPath()
        ctx!.arc(0, 0, r, 0, 2 * Math.PI)
        ctx!.fillStyle = s.theme.accent
        ctx!.fill()
        ctx!.restore()
        ctx!.lineWidth = (rank === 0 ? 2.5 : 1.5) * pr
        ctx!.strokeStyle = rank === 0 ? '#ffffff' : 'rgba(2, 3, 6, 0.95)'
        ctx!.stroke()
        ctx!.fillStyle = s.theme.onAccent
        ctx!.font = `600 ${Math.round((rank >= 9 ? 9.5 : 11.5) * pr)}px ${MONO}`
        ctx!.fillText(String(rank + 1), 0, 0.5 * pr)
        ctx!.restore()
      }
    }

    const dot = (i: number, radiusPx: number, glow: string) => {
      const x = ipx(i), y = ipy(i)
      const cc = rgbOf(s, i)
      ctx!.save()
      ctx!.shadowColor = glow
      ctx!.shadowBlur = 14 * pr
      ctx!.beginPath()
      ctx!.arc(x, y, radiusPx * pr, 0, 2 * Math.PI)
      ctx!.fillStyle = rgbCss(cc)
      ctx!.fill()
      ctx!.lineWidth = 2 * pr
      ctx!.strokeStyle = '#ffffff'
      ctx!.stroke()
      ctx!.restore()
    }
    const hv = hot()
    const hotIsBadge = hv !== null && revealed && s.top.includes(hv)
    if (hv !== null && hv >= 0 && hv < n && hv !== s.selectedIndex && !hotIsBadge) {
      dot(hv, HOVER_RADIUS_PX, 'rgba(255, 255, 255, 0.6)')
    }
    const tag = (i: number, text: string) => {
      ctx!.font = `600 ${Math.round(11 * pr)}px ${MONO}`
      ctx!.textAlign = 'center'
      ctx!.textBaseline = 'alphabetic'
      ctx!.lineWidth = 3 * pr
      ctx!.strokeStyle = 'rgba(2, 3, 6, 0.9)'
      ctx!.strokeText(text, ipx(i), ipy(i) - (SELECTED_RADIUS_PX + 6) * pr)
      ctx!.fillStyle = '#ffffff'
      ctx!.fillText(text, ipx(i), ipy(i) - (SELECTED_RADIUS_PX + 6) * pr)
    }
    const both = s.selectedIndex !== null && s.compareIndex !== null
    const cmp = s.compareIndex
    if (cmp !== null && cmp >= 0 && cmp < n) {
      dot(cmp, SELECTED_RADIUS_PX, 'rgba(255, 179, 92, 0.95)')
      if (both) tag(cmp, 'B')
    }
    const sel = s.selectedIndex
    if (sel !== null && sel >= 0 && sel < n) {
      dot(sel, SELECTED_RADIUS_PX, 'rgba(140, 190, 255, 0.95)')
      if (both) tag(sel, 'A')
    }
    return canvas
  }

  const layer = new Layer({ render, zIndex: 20 })

  return {
    layer,
    setStyle(s) {
      if (!style || style.values !== s.values || style.range !== s.range
        || style.invert !== s.invert || style.mask !== s.mask || style.theme !== s.theme) rebuild(s)
      // Nowe Top 10 (inna wersja rankingu, wagi, filtry): plakietki wskakują od nowa.
      const newTop = !!style && revealed && (style.top.length !== s.top.length || style.top.some((v, i) => v !== s.top[i]))
      style = s
      if (newTop) {
        bScale.fill(0)
        bVel.fill(0)
        revealedAt = performance.now() - BADGE_DELAY_MS * 0.6
        kick()
      }
      layer.changed()
    },
    setOpacity(v) {
      if (v === opacity) return
      opacity = v
      layer.changed()
    },
    setHover(i) {
      if (i === hover) return
      hover = i
      layer.changed()
      kick()
    },
    setHighlight(i) {
      if (i === highlight) return
      highlight = i
      layer.changed()
      kick()
    },
    setRevealed(on) {
      if (on === revealed) return
      revealed = on
      revealedAt = performance.now()
      kick()
    },
    isRevealed: () => revealed,
    dispose() {
      cancelAnimationFrame(raf)
      raf = 0
    },
  }
}
