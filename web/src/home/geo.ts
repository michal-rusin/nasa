/**
 * Globe geometry using the three.js convention (Y up), matching the default UV mapping
 * of `SphereGeometry` for an equirectangular texture centered on longitude 0:
 *   lon 0   -> +X (image center),
 *   lon 90E -> -Z (right side for a camera at +X, so east appears on the right),
 *   north pole -> +Y, south pole -> -Y.
 * This avoids rotating the mesh or mirroring the texture.
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

const DEG = Math.PI / 180

/** lat: north-positive, lon: east-positive (degrees). */
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

/** Inverse of `latLonToVec3` (degrees + distance from center). */
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
 * Whether a point on a sphere centered at 0 is visible from the camera:
 * the surface normal (= the point itself) must face the camera: n · (camera − point) > 0.
 * This is an exact horizon test, not just a hemisphere test.
 */
export function isVisibleOnSphere(point: Vec3, camera: Vec3): boolean {
  return (
    point.x * (camera.x - point.x) +
    point.y * (camera.y - point.y) +
    point.z * (camera.z - point.z) > 0
  )
}
