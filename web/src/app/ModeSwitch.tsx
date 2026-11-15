// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import type { CSSProperties } from 'react'
import { useT } from '../i18n'
import { MODE_THEMES } from '../map/themes'
import { COLOR_KEYS, useStore } from '../store'
import { YearPicker } from './YearPicker'

/** Bottom map bar: year and ranking mode (each has its own color scale and Top 10). */
export function ModeSwitch() {
  const t = useT()
  const colorBy = useStore((s) => s.colorBy)
  const setColorBy = useStore((s) => s.setColorBy)
  const metricKeys = useStore((s) => s.metricKeys)
  const keys = COLOR_KEYS.filter((k) => k === 'score' || metricKeys.includes(k))
  return (
    <div className="mode-switch" data-tour="modes">
      <YearPicker />
      <div className="mode-list" role="radiogroup" aria-label={t('mode.aria')}>
      {keys.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={k === colorBy}
          className={k === colorBy ? 'on' : ''}
          style={{ '--mode': MODE_THEMES[k].accent } as CSSProperties}
          title={t(`modeFull.${k}`)}
          onClick={() => setColorBy(k)}>
          <span className="mode-dot" aria-hidden="true" />{t(`mode.${k}`)}
        </button>
      ))}
      </div>
    </div>
  )
}
