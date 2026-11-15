import type { CSSProperties } from 'react'
import { useT } from '../i18n'
import { MODE_THEMES } from '../map/themes'
import { COLOR_KEYS, useStore } from '../store'
import { YearPicker } from './YearPicker'

/** Pasek na dole mapy: rok i wersja rankingu (każda ma swoją skalę kolorów i swoje Top 10). */
export function ModeSwitch() {
  const t = useT()
  const colorBy = useStore((s) => s.colorBy)
  const setColorBy = useStore((s) => s.setColorBy)
  return (
    <div className="mode-switch">
      <YearPicker />
      <div className="mode-list" role="radiogroup" aria-label={t('mode.aria')}>
      {COLOR_KEYS.map((k) => (
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
