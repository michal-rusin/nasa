import { useMemo } from 'react'
import { useStore } from '../store'
import { useActiveRange, useAnalysis, yearSpans, type Analysis } from './analysis'
import { Timeline } from './Timeline'

/** Doba synodyczna Księżyca: tyle obejmuje tor Słońca/Ziemi zaznaczony na osi czasu. */
const LUNAR_DAY_S = 29.53 * 86400

/** Oś Słońca/Ziemi jednego miejsca w wybranym roku, podpięta pod wspólny kursor czasu. */
export function PlaceTimeline({ data, tag }: { data: Analysis; tag?: string }) {
  const meta = useStore((s) => s.meta)
  const cursor = useAnalysis((s) => s.cursor)
  const setCursor = useAnalysis((s) => s.setCursor)
  const setPlaying = useAnalysis((s) => s.setPlaying)
  const { start, len } = useActiveRange()
  const threshold = meta?.night_threshold ?? 0
  const view = useMemo(() => {
    const spans = yearSpans(data.series, { start, len }, threshold)
    // Ciąg sięgający poza rok rysujemy przycięty do roku (oś liczona od początku roku).
    const clip = (s: { start: number; len: number }) => {
      const a = Math.max(start, s.start), b = Math.min(start + len, s.start + s.len)
      return { start: a - start, len: Math.max(0, b - a) }
    }
    return {
      f: data.series.f.subarray(start, start + len),
      g: data.series.g.subarray(start, start + len),
      night: clip(spans.night),
      commGap: clip(spans.commGap),
    }
  }, [data, start, len, threshold])
  if (!meta || len === 0) return null
  const k = Math.min(len - 1, Math.max(0, cursor - start))
  const t0 = new Date(Date.parse(meta.t0_utc) + start * meta.step_s * 1000).toISOString()
  return (
    <div className="pb-timeline">
      <Timeline f={view.f} g={view.g} t0Utc={t0} stepS={meta.step_s} cursor={k}
        trackLen={Math.max(1, Math.round(LUNAR_DAY_S / meta.step_s))}
        night={view.night} commGap={view.commGap} tag={tag}
        onCursor={(v) => { setPlaying(false); setCursor(start + v) }} />
    </div>
  )
}
