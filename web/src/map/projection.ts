import proj4 from 'proj4'

/**
 * lat/lon (degrees, planetocentric on a sphere) → raster CRS meters.
 * The source sphere has the same radius as the CRS, preventing proj4 from converting
 * through the WGS84 ellipsoid (which would shift latitude).
 */
export function latLonToXY(projString: string, moonRadiusM: number, latDeg: number, lonDeg: number): [number, number] {
  const src = `+proj=longlat +R=${moonRadiusM} +no_defs`
  const [x, y] = proj4(src, projString, [lonDeg, latDeg])
  return [x!, y!]
}

/** Radius of a latitude circle in CRS meters (pole at 0,0). */
export function latitudeRadiusM(projString: string, moonRadiusM: number, latDeg: number): number {
  const [x, y] = latLonToXY(projString, moonRadiusM, latDeg, 0)
  return Math.hypot(x, y)
}
