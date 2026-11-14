// Widoczność Słońca i Ziemi w jednym kroku (kontrakt 2.1, 2.2).

/** Domyślny promień kątowy Słońca (kontrakt 2.1); właściwą wartość bierz z meta.sun_radius_deg. */
export const DEFAULT_SUN_RADIUS_DEG = 0.2666

/** Ułamek tarczy Słońca nad horyzontem (horyzont jako linia prosta). */
export function sunFraction(elDeg: number, maskDeg: number, sunRadiusDeg = DEFAULT_SUN_RADIUS_DEG): number {
  const d = (elDeg - maskDeg) / sunRadiusDeg
  if (d <= -1) return 0
  if (d >= 1) return 1
  return (Math.acos(-d) + d * Math.sqrt(1 - d * d)) / Math.PI
}

/** 1, jeśli środek Ziemi jest powyżej maski, inaczej 0. */
export function earthVisible(elDeg: number, maskDeg: number): 0 | 1 {
  return elDeg > maskDeg ? 1 : 0
}

/** |P| w km: P = (R + elev_km + observer_height_m/1000)·U. */
export function observerRadiusKm(moonRadiusKm: number, elevM: number, observerHeightM: number): number {
  return moonRadiusKm + elevM / 1000 + observerHeightM / 1000
}
