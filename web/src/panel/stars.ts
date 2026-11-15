// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useEffect, useState } from 'react'
import { EMPTY_STARS, parseStarCatalog, type StarCatalog } from './sky'

let promise: Promise<StarCatalog> | null = null

/**
 * Bright star catalog (Hipparcos down to magnitude 6, ~5,000) from public/assets/stars.json.
 * Returns an empty catalog on error: the panorama then works without stars.
 */
export function loadStars(): Promise<StarCatalog> {
  if (!promise) {
    promise = fetch(`${import.meta.env.BASE_URL}assets/stars.json`)
      .then(async (res) => {
        // Vite dev server returns 200 + index.html for missing files.
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('missing stars.json')
        return parseStarCatalog(await res.json())
      })
      .catch((e: unknown) => {
        console.warn(`Stars unavailable: ${e instanceof Error ? e.message : String(e)}`)
        return EMPTY_STARS
      })
  }
  return promise
}

export function useStars(): StarCatalog | null {
  const [stars, setStars] = useState<StarCatalog | null>(null)
  useEffect(() => {
    let alive = true
    void loadStars().then((s) => { if (alive) setStars(s) })
    return () => { alive = false }
  }, [])
  return stars
}
