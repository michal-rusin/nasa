import { useEffect, useState } from 'react'
import { EMPTY_STARS, parseStarCatalog, type StarCatalog } from './sky'

let promise: Promise<StarCatalog> | null = null

/**
 * Katalog jasnych gwiazd (Hipparcos do 6 mag, ~5 tys.) z public/assets/stars.json.
 * Przy błędzie zwraca pusty katalog: panorama działa wtedy bez gwiazd.
 */
export function loadStars(): Promise<StarCatalog> {
  if (!promise) {
    promise = fetch(`${import.meta.env.BASE_URL}assets/stars.json`)
      .then(async (res) => {
        // Serwer dev Vite na brakujący plik odpowiada 200 + index.html.
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('brak stars.json')
        return parseStarCatalog(await res.json())
      })
      .catch((e: unknown) => {
        console.warn(`Gwiazdy niedostępne: ${e instanceof Error ? e.message : String(e)}`)
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
