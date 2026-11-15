import { useId } from 'react'
import { YearPicker } from '../app/YearPicker'
import { fill, useT } from '../i18n'
import { useStore } from '../store'
import { useActiveRange, useAnalysis } from './analysis'
import { stepToUtc } from './timelineMath'

/** Odtwarzanie i suwak daty w wybranym roku (wspólny kursor czasu dla wszystkich panoram). */
export function TimeBar() {
  const t = useT()
  const meta = useStore((s) => s.meta)
  const cursor = useAnalysis((s) => s.cursor)
  const playing = useAnalysis((s) => s.playing)
  const setCursor = useAnalysis((s) => s.setCursor)
  const setPlaying = useAnalysis((s) => s.setPlaying)
  const sliderId = useId()
  const { start, len } = useActiveRange()
  if (!meta || len === 0) return null
  const n = meta.n_steps
  const last = start + len - 1
  const k = Math.min(last, Math.max(start, cursor))
  const now = stepToUtc(meta.t0_utc, meta.step_s, k)

  return (
    <>
      <div className="pb-time">
        <button type="button" className="hd-play" aria-label={t(playing ? 'dock.pause' : 'dock.play')}
          onClick={() => {
            if (!playing && k >= last) setCursor(start)
            setPlaying(!playing)
          }}>{playing ? '❚❚' : '▶'}</button>
        <label htmlFor={sliderId} className="pb-time-label">
          <span className="label">{t('panel.time')}</span>
          <span className="pb-now">{now}</span>
        </label>
        <input id={sliderId} type="range" min={start} max={last} step={1} value={k}
          aria-valuetext={now}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)) }} />
      </div>
      <div className="pb-range">
        <YearPicker />
        <p>
          {fill(t('panel.range'), {
            from: stepToUtc(meta.t0_utc, meta.step_s, 0, false),
            to: stepToUtc(meta.t0_utc, meta.step_s, n - 1, false),
          })}
        </p>
      </div>
    </>
  )
}
