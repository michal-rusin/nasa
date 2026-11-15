// Local ENU frame at a point on a sphere (contract 1.2). Vectors in MOON_ME.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

export type Vec3 = readonly [number, number, number]

export interface EnuBasis {
  U: Vec3
  E: Vec3
  N: Vec3
}

const DEG = Math.PI / 180

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** U = up (radial), E = east, N = north. */
export function enuBasis(latDeg: number, lonDeg: number): EnuBasis {
  const phi = latDeg * DEG
  const lam = lonDeg * DEG
  const cp = Math.cos(phi), sp = Math.sin(phi), cl = Math.cos(lam), sl = Math.sin(lam)
  return {
    U: [cp * cl, cp * sl, sp],
    E: [-sl, cl, 0],
    N: [-sp * cl, -sp * sl, cp],
  }
}

/** Azimuth in [0, 360) from arbitrary components (0 = north, increasing through east). */
export function azimuthDeg(vE: number, vN: number): number {
  const az = Math.atan2(vE, vN) / DEG
  const wrapped = ((az % 360) + 360) % 360
  return wrapped === 360 ? 0 : wrapped
}

/** Elevation in degrees from vU / |v| (clamped to [-1, 1]). */
export function elevationDeg(vU: number, norm: number): number {
  return Math.asin(Math.min(1, Math.max(-1, vU / norm))) / DEG
}

/** Azimuth and elevation of direction v (point to object) in the ENU basis. */
export function azEl(v: Vec3, basis: EnuBasis): { azDeg: number; elDeg: number } {
  const norm = Math.hypot(v[0], v[1], v[2])
  return {
    azDeg: azimuthDeg(dot(v, basis.E), dot(v, basis.N)),
    elDeg: elevationDeg(dot(v, basis.U), norm),
  }
}
