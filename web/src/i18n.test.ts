import { describe, expect, it } from 'vitest'
import { dictionary, fill, LANGS, t, translate } from './i18n'
import { useStore } from './store'

describe('English interface', () => {
  it('exposes only English', () => {
    expect(LANGS).toEqual(['en'])
    expect(Object.keys(dictionary)).toEqual(['en'])
    expect(useStore.getState().lang).toBe('en')
    expect(t('home.cta')).toBe('Explore the South Pole')
  })
  it('returns the key when no label exists', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })
  it('substitutes known placeholders and preserves unknown ones', () => {
    expect(fill('#{id} · {s} {x}', { id: 7, s: '0.5' })).toBe('#7 · 0.5 {x}')
  })
})
