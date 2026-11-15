// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

/** Parsed “lat, lon” input. */
export type LatLonParse =
  | { ok: true; lat: number; lon: number }
  | { ok: false; reason: 'format' | 'range' }

const NUM = String.raw`([+-]?\d+(?:\.\d+)?)\s*°?\s*`
const RE = new RegExp(String.raw`^\s*${NUM}([NSns])?\s*(?:[,;]\s*|\s+)${NUM}([EWew])?\s*$`)

/**
 * Parse “lat, lon” in degrees: „-89.5, 129”, „-89.5 129”, „89.5S 129E”, „-89.5°; -45”.
 * lat ∈ [−90, 90]; lon ∈ [−180, 360], normalized to (−180, 180]. S/W reverses the sign.
 */
export function parseLatLon(input: string): LatLonParse {
  const m = RE.exec(input)
  if (!m) return { ok: false, reason: 'format' }
  let lat = Number(m[1])
  let lon = Number(m[3])
  const ns = m[2]?.toUpperCase()
  const ew = m[4]?.toUpperCase()
  if (ns && lat < 0) return { ok: false, reason: 'format' }
  if (ew && lon < 0) return { ok: false, reason: 'format' }
  if (ns === 'S') lat = -lat
  if (ew === 'W') lon = -lon
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, reason: 'format' }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 360) return { ok: false, reason: 'range' }
  if (lon > 180) lon -= 360
  return { ok: true, lat, lon }
}
