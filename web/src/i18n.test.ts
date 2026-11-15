// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { describe, expect, it } from 'vitest'
import { fill, t } from './i18n'

describe('i18n', () => {
  it('teksty po angielsku', () => {
    expect(t('home.cta')).toBe('Explore the South Pole')
  })

  it('brak klucza zwraca klucz', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('fill podstawia zmienne, nieznane zostawia', () => {
    expect(fill('#{id} · {s} {x}', { id: 7, s: '0.5' })).toBe('#7 · 0.5 {x}')
  })
})
