import { afterEach, describe, expect, it } from 'vitest'
import { dictionary, t, translate } from './i18n'
import { useStore } from './store'

afterEach(() => useStore.getState().setLang('en'))

describe('i18n', () => {
  it('domyślnym językiem jest angielski', () => {
    expect(useStore.getState().lang).toBe('en')
    expect(t('home.cta')).toBe('Explore the South Pole')
  })

  it('brak klucza zwraca klucz', () => {
    expect(t('no.such.key')).toBe('no.such.key')
    expect(translate('pl', 'no.such.key')).toBe('no.such.key')
  })

  it('przełączenie języka w store zmienia wynik t()', () => {
    useStore.getState().setLang('pl')
    expect(useStore.getState().lang).toBe('pl')
    expect(t('home.cta')).toBe(dictionary.pl['home.cta'])
    expect(t('home.cta')).not.toBe(dictionary.en['home.cta'])
    useStore.getState().setLang('en')
    expect(t('home.cta')).toBe('Explore the South Pole')
  })

  it('oba słowniki mają ten sam zestaw kluczy', () => {
    expect(Object.keys(dictionary.pl).sort()).toEqual(Object.keys(dictionary.en).sort())
  })
})
