/** Display selenographic coordinates: “89.53°S 129.89°E”. NaN/missing → `na`. */
export function fmtCoord(lat: number | undefined, lon: number | undefined, digits = 2, na = 'n/a'): string {
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return na
  const ns = lat < 0 ? 'S' : 'N'
  const ew = lon < 0 ? 'W' : 'E'
  return `${Math.abs(lat).toFixed(digits)}°${ns} ${Math.abs(lon).toFixed(digits)}°${ew}`
}
