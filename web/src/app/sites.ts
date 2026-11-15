// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import type { Site } from '../data/types'

/** Test entries from mock-data.py contain “[MOCK]” in the name; hide them in the product. */
export function isMockSite(s: Site): boolean {
  return s.name.includes('[MOCK]')
}
