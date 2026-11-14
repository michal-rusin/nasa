/**
 * Geometria globusa w konwencji three.js (Y do góry) zgodna z domyślnym mapowaniem UV
 * `SphereGeometry` dla tekstury equirectangular wyśrodkowanej na południku 0:
 *   lon 0   -> +X (środek obrazu),
 *   lon 90E -> -Z (dla kamery na +X jest to prawa strona, czyli wschód po prawej),
 *   biegun N -> +Y, biegun S -> -Y.
 * Dzięki temu siatki nie trzeba obracać ani odbijać tekstury.
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

const DEG = Math.PI / 180

/** lat: N dodatnia, lon: E dodatnia (stopnie). */
export function latLonToVec3(latDeg: number, lonDeg: number, radius = 1): Vec3 {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  const c = Math.cos(lat)
  return {
    x: radius * c * Math.cos(lon),
    y: radius * Math.sin(lat),
    z: -radius * c * Math.sin(lon),
  }
}

/** Odwrotność `latLonToVec3` (stopnie + odległość od środka). */
export function vec3ToLatLon(v: Vec3): { lat: number; lon: number; dist: number } {
  const dist = Math.hypot(v.x, v.y, v.z)
  if (dist === 0) return { lat: 0, lon: 0, dist: 0 }
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, v.y / dist))) / DEG,
    lon: Math.atan2(-v.z, v.x) / DEG,
    dist,
  }
}

/**
 * Czy punkt na powierzchni kuli (o środku w 0) jest po stronie widocznej z kamery:
 * normalna w punkcie (= sam punkt) musi patrzeć w stronę kamery, czyli n · (kamera − punkt) > 0.
 * To dokładny test horyzontu, nie tylko "półkuli".
 */
export function isVisibleOnSphere(point: Vec3, camera: Vec3): boolean {
  return (
    point.x * (camera.x - point.x) +
    point.y * (camera.y - point.y) +
    point.z * (camera.z - point.z) > 0
  )
}
