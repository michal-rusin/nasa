import type { Site } from '../data/types'

/** Test entries from mock-data.py contain “[MOCK]” in the name; hide them in the product. */
export function isMockSite(s: Site): boolean {
  return s.name.includes('[MOCK]')
}
