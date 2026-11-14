import type { Site } from '../data/types'

/** Wpisy testowe z mock-data.py mają „[MOCK]” w nazwie; w produkcie ich nie pokazujemy. */
export function isMockSite(s: Site): boolean {
  return s.name.includes('[MOCK]')
}
