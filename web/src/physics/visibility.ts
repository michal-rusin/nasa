// Sun and Earth visibility at one step (contract 2.1, 2.2).

/** Default solar angular radius (contract 2.1); use the actual value from meta.sun_radius_deg. */
export const DEFAULT_SUN_RADIUS_DEG = 0.2666

/** Solar disk fraction above the horizon (approximated as a straight line). */
export function sunFraction(elDeg: number, maskDeg: number, sunRadiusDeg = DEFAULT_SUN_RADIUS_DEG): number {
  const d = (elDeg - maskDeg) / sunRadiusDeg
  if (d <= -1) return 0
  if (d >= 1) return 1
  return (Math.acos(-d) + d * Math.sqrt(1 - d * d)) / Math.PI
}

/** 1 if Earth's center is above the mask, otherwise 0. */
export function earthVisible(elDeg: number, maskDeg: number): 0 | 1 {
  return elDeg > maskDeg ? 1 : 0
}

/** |P| in km: P = (R + elev_km + observer_height_m/1000)·U. */
export function observerRadiusKm(moonRadiusKm: number, elevM: number, observerHeightM: number): number {
  return moonRadiusKm + elevM / 1000 + observerHeightM / 1000
}
