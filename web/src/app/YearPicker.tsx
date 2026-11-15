// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useT } from '../i18n'
import { useStore } from '../store'

/**
 * Year selection (metrics_by_year): ‹ 2028 ›. Shared state for map ranking and timeline,
 * so the control can appear in multiple places. Single-year data renders nothing.
 */
export function YearPicker({ className = '' }: { className?: string }) {
  const t = useT()
  const years = useStore((s) => s.byYear?.years)
  const year = useStore((s) => s.year)
  const setYear = useStore((s) => s.setYear)
  if (!years || years.length < 2 || year === null) return null
  const i = years.indexOf(year)
  const go = (d: number) => {
    const y = years[i + d]
    if (y !== undefined) setYear(y)
  }
  return (
    <div className={`year-picker ${className}`} role="group" aria-label={t('year.aria')}>
      <button type="button" aria-label={t('year.prev')} disabled={i <= 0} onClick={() => go(-1)}>‹</button>
      <select value={year} aria-label={t('year.aria')} onChange={(e) => setYear(Number(e.target.value))}>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button type="button" aria-label={t('year.next')} disabled={i >= years.length - 1} onClick={() => go(1)}>›</button>
    </div>
  )
}
