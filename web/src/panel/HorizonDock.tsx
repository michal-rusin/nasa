import { useEffect } from 'react'
import { useStore } from '../store'
import { useAnalysis } from './analysis'
import { Panorama, PANO_COLORS } from './Panorama'
import { Timeline } from './Timeline'

/** Doba synodyczna Księżyca: tyle obejmują tory w panoramie. */
const LUNAR_DAY_S = 29.53 * 86400
/** Odtwarzanie: kroków na klatkę (~2,5 doby/s przy 60 fps i kroku 1 h). */
const PLAY_STEPS_PER_FRAME = 1

function fmtTime(t0Utc: string, stepS: number, k: number): string {
  const t = Date.parse(t0Utc) + k * stepS * 1000
  if (!Number.isFinite(t)) return `krok ${k}`
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function HorizonDock() {
  const meta = useStore((s) => s.meta)
  const status = useAnalysis((s) => s.status)
  const data = useAnalysis((s) => s.data)
  const cursor = useAnalysis((s) => s.cursor)
  const playing = useAnalysis((s) => s.playing)
  const setCursor = useAnalysis((s) => s.setCursor)
  const setPlaying = useAnalysis((s) => s.setPlaying)
  const n = meta?.n_steps ?? 0

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const { cursor: c } = useAnalysis.getState()
      if (c >= n - 1) { setPlaying(false); return }
      setCursor(c + PLAY_STEPS_PER_FRAME)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, n, setCursor, setPlaying])

  if (!meta || status === 'idle') return null
  if (status !== 'ready' || !data) {
    return <div className="horizon-dock"><p className="muted">{status === 'loading' ? 'Wczytuję maskę i efemerydy…' : 'Panorama niedostępna (szczegóły w panelu punktu).'}</p></div>
  }

  const s = data.series
  const k = Math.min(n - 1, cursor)
  const trackLen = Math.max(1, Math.round(LUNAR_DAY_S / meta.step_s))
  const f = s.f[k]!, g = s.g[k]!
  const sunState = f >= 0.99 ? 'cała tarcza' : f > 0.01 ? `${Math.round(f * 100)}% tarczy` : 'za horyzontem'

  return (
    <div className="horizon-dock">
      <div className="hd-head">
        <strong>Panorama horyzontu</strong>
        <button type="button" className="hd-play" onClick={() => {
          if (!playing && k >= n - 1) setCursor(0)
          setPlaying(!playing)
        }}>{playing ? '❚❚' : '▶'}</button>
        <span className="hd-time">{fmtTime(meta.t0_utc, meta.step_s, k)}</span>
        <span style={{ color: PANO_COLORS.sun }}>● Słońce: {sunState}, el {s.sunEl[k]!.toFixed(1)}°, az {s.sunAz[k]!.toFixed(0)}°</span>
        <span style={{ color: PANO_COLORS.earth }}>● Ziemia: {g ? 'widoczna' : 'zasłonięta'}, el {s.earthEl[k]!.toFixed(1)}°, az {s.earthAz[k]!.toFixed(0)}°</span>
      </div>
      <Panorama mask={data.mask} series={s} envelope={data.envelope} cursor={k} trackLen={trackLen} height={210} />
      <Timeline f={s.f} g={s.g} t0Utc={meta.t0_utc} stepS={meta.step_s} cursor={k} trackLen={trackLen}
        night={data.night} commGap={data.commGap} onCursor={(v) => { setPlaying(false); setCursor(v) }} />
      <div className="muted hd-note">
        Skala pionowa mocno przesadzona. Szara sylwetka to horyzont z maski. Przerywane linie to tory Słońca i Ziemi
        przez dobę księżycową wokół kursora, a jasne pasmo to zakres Słońca w całym roku. Tarcza z konturem jest zasłonięta.
        Kliknij lub przeciągnij po paskach, żeby zmienić chwilę; czerwone ramki to najdłuższa noc i przerwa łączności.
      </div>
    </div>
  )
}
