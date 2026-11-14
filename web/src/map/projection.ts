import proj4 from 'proj4'

/**
 * lat/lon (stopnie, planetocentryczne na kuli) → metry CRS rastrów.
 * Źródło to kula o tym samym promieniu co CRS, żeby proj4 nie robił przejścia
 * przez elipsoidę WGS84 (to przesunęłoby szerokość).
 */
export function latLonToXY(projString: string, moonRadiusM: number, latDeg: number, lonDeg: number): [number, number] {
  const src = `+proj=longlat +R=${moonRadiusM} +no_defs`
  const [x, y] = proj4(src, projString, [lonDeg, latDeg])
  return [x!, y!]
}

/** Promień okręgu danej szerokości w metrach CRS (biegun w 0,0). */
export function latitudeRadiusM(projString: string, moonRadiusM: number, latDeg: number): number {
  const [x, y] = latLonToXY(projString, moonRadiusM, latDeg, 0)
  return Math.hypot(x, y)
}
