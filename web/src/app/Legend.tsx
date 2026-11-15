import { fill, useT } from '../i18n'
import { rampCssGradient } from '../map/colors'
import { MODE_THEMES } from '../map/themes'
import { METRIC_META } from '../rank/metrics'
import { useStore } from '../store'
import { Term } from '../tour/Term'
import { fmtVal, METRIC_DIGITS } from './format'

/** Legenda kolorów punktów: nazwa, gradient i liczby na końcach (kolor nie jest jedynym nośnikiem). */
export function Legend() {
  const t = useT()
  const colorBy = useStore((s) => s.colorBy)
  const range = useStore((s) => (s.colorBy === 'score' ? s.scoreRange : s.ranges?.[s.colorBy]))
  const passCount = useStore((s) => s.passCount)
  const total = useStore((s) => s.candidates?.n ?? 0)
  const filtered = useStore((s) => Object.keys(s.filters).length > 0)
  const isScore = colorBy === 'score'
  const low = !isScore && METRIC_META[colorBy].direction === 'low'
  const unit = isScore ? '' : ` ${METRIC_META[colorBy].unit}`
  const digits = isScore ? 2 : METRIC_DIGITS[colorBy]
  const na = t('na')
  const title = t(`metric.${colorBy}`)
  // Jasny = dobry: dla „mniej = lepiej” max po lewej.
  const left = range ? fmtVal(low ? range.max : range.min, digits, na) + unit : na
  const right = range ? fmtVal(low ? range.min : range.max, digits, na) + unit : na
  return (
    <div className="legend" data-tour="legend" role="group" aria-label={title}>
      <div className="legend-title"><Term k={colorBy}>{title}</Term></div>
      <div className="legend-bar" style={{ background: rampCssGradient(MODE_THEMES[colorBy].ramp) }} aria-hidden="true" />
      <div className="legend-labels"><span>{left}</span><span>{right}</span></div>
      <div className="legend-note">
        {isScore ? t('legend.highBetter') : t(low ? 'legend.lowBetterBright' : 'legend.highBetterBright')}
        {filtered && <><br />{fill(t('top.pass'), { n: passCount, total })}</>}
      </div>
    </div>
  )
}
