// Lokalny układ ENU punktu na kuli (kontrakt 1.2). Wektory w MOON_ME.

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

/** U = góra (radialnie), E = wschód, N = północ. */
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

/** Azymut w [0, 360) z dowolnych składowych (0 = północ, rośnie przez wschód). */
export function azimuthDeg(vE: number, vN: number): number {
  const az = Math.atan2(vE, vN) / DEG
  const wrapped = ((az % 360) + 360) % 360
  return wrapped === 360 ? 0 : wrapped
}

/** Elewacja w stopniach z vU / |v| (przycięte do [-1, 1]). */
export function elevationDeg(vU: number, norm: number): number {
  return Math.asin(Math.min(1, Math.max(-1, vU / norm))) / DEG
}

/** Azymut i elewacja kierunku v (od punktu do obiektu) w bazie ENU. */
export function azEl(v: Vec3, basis: EnuBasis): { azDeg: number; elDeg: number } {
  const norm = Math.hypot(v[0], v[1], v[2])
  return {
    azDeg: azimuthDeg(dot(v, basis.E), dot(v, basis.N)),
    elDeg: elevationDeg(dot(v, basis.U), norm),
  }
}
