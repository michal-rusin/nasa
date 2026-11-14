export function fmtNum(v: number): string {
  if (Number.isNaN(v)) return '—'
  if (Number.isInteger(v)) return String(v)
  return Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)
}
