/// <reference types="node" />
// Check TS physics against validation.json and candidates.bin (contract 6).
// Read data from disk: web/public/data and web/public/data/sample (if present).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildIdToIndex, parseCandidates, parseMeta } from '../data/load'
import { candidatesRange } from '../data/years'
import { earthPct, longestCommGapH, longestNightH, sunPct } from './aggregates'
import { maskFromBuffer } from './mask'
import { solarPower } from './solarPower'
import { computeSeries, ephemFromBuffer } from './series'

const DATA_ROOT = fileURLToPath(new URL('../../public/data/', import.meta.url))
const DATASETS = [DATA_ROOT, join(DATA_ROOT, 'sample')]
  .filter((d) => existsSync(join(d, 'meta.json')) && existsSync(join(d, 'validation.json')))

interface ValidationEntry {
  id: number
  sun_f: number[]
  earth_g: number[]
  sun_pct: number
  earth_pct: number
  /** Delivery 7 (contract 6): power for candidates_period; null = no direction (no sunlight). */
  power_track_wm2?: number
  power_fixed_wm2?: number
  power_fixed_az_deg?: number | null
}

function readBuf(path: string): ArrayBuffer {
  const b = readFileSync(path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe.skipIf(DATASETS.length === 0)('validation.json', () => {
  for (const dir of DATASETS) {
    it(`aggregate consistency: ${dir.slice(DATA_ROOT.length) || 'public/data'}`, () => {
      const meta = parseMeta(readJson(join(dir, 'meta.json')))
      const cand = parseCandidates(readBuf(join(dir, 'candidates.bin')), meta)
      const idToIndex = buildIdToIndex(cand)
      const ephem = ephemFromBuffer(readBuf(join(dir, 'ephem.bin')), meta.n_steps)
      const index = readJson(join(dir, 'masks', 'index.json')) as { records: Record<string, [string, number]> }
      const validation = readJson(join(dir, 'validation.json')) as ValidationEntry[]
      const stepH = meta.step_s / 3600
      // candidates.bin and validation.json cover only candidates_period (2028 = steps 0..8783),
      // whereas ephem.bin may span more years (contract 1.4).
      const period = candidatesRange(meta)
      const nSteps = period.len
      const sunTol = meta.mock === true ? 0.01 : 1
      const earthTol = Math.max(0.05, (2 / nSteps) * 100)
      const params = {
        moonRadiusKm: meta.moon_radius_km,
        observerHeightM: meta.observer_height_m,
        sunRadiusDeg: meta.sun_radius_deg,
      }
      const tiles = new Map<string, ArrayBuffer>()

      expect(validation.length).toBeGreaterThan(0)
      for (const v of validation) {
        const row = idToIndex.get(v.id)
        expect(row, `id ${v.id} nie ma w candidates.bin`).toBeDefined()
        const rec = index.records[String(v.id)]
        expect(rec, `id ${v.id} nie ma w masks/index.json`).toBeDefined()
        if (row === undefined || !rec) continue
        const [file, recNo] = rec
        let tile = tiles.get(file)
        if (!tile) {
          tile = readBuf(join(dir, 'masks', file))
          tiles.set(file, tile)
        }
        const mask = maskFromBuffer(tile, recNo)
        const full = computeSeries(
          { latDeg: cand.col.lat[row]!, lonDeg: cand.col.lon[row]!, elevM: cand.col.elev_m[row]! },
          mask, ephem, period.start + nSteps, params,
        )
        const s = { f: full.f.subarray(period.start), g: full.g.subarray(period.start) }

        const dSun = Math.abs(sunPct(s.f) - v.sun_pct)
        const dEarth = Math.abs(earthPct(s.g) - v.earth_pct)
        const dNight = Math.abs(longestNightH(s.f, meta.step_s, meta.night_threshold) - cand.col.longest_night_h[row]!)
        const dGap = Math.abs(longestCommGapH(s.g, meta.step_s) - cand.col.longest_comm_gap_h[row]!)
        let maxDf = 0
        let gMismatch = 0
        for (let k = 0; k < nSteps; k++) {
          maxDf = Math.max(maxDf, Math.abs(s.f[k]! - (v.sun_f[k] ?? NaN)))
          if (s.g[k] !== v.earth_g[k]) gMismatch++
        }
        console.log(`[validation] id=${v.id} Δsun=${dSun.toFixed(5)} pp Δearth=${dEarth.toFixed(5)} pp `
          + `Δnight=${dNight} h Δgap=${dGap} h max|Δf|=${maxDf.toExponential(2)} g≠=${gMismatch}`)

        if (v.power_track_wm2 !== undefined && v.power_fixed_wm2 !== undefined) {
          const pw = solarPower(full, period.start, nSteps, Date.parse(meta.t0_utc), meta.step_s)
          console.log(`[validation] id=${v.id} power track ${pw.trackingWm2.toFixed(2)} vs ${v.power_track_wm2}, `
            + `fixed ${pw.fixedWm2.toFixed(2)} vs ${v.power_fixed_wm2} @ ${pw.fixedAzDeg} vs ${String(v.power_fixed_az_deg)}`)
          expect(Math.abs(pw.trackingWm2 - v.power_track_wm2), `power_track_wm2 id ${v.id}`).toBeLessThanOrEqual(1)
          expect(Math.abs(pw.fixedWm2 - v.power_fixed_wm2), `power_fixed_wm2 id ${v.id}`).toBeLessThanOrEqual(2)
          if (v.power_fixed_wm2 > 0) expect(pw.fixedAzDeg, `power_fixed_az_deg id ${v.id}`).toBe(v.power_fixed_az_deg)
          else expect(v.power_fixed_az_deg ?? null).toBeNull()
        }

        expect(dSun, `sun_pct id ${v.id}`).toBeLessThanOrEqual(sunTol)
        expect(dEarth, `earth_pct id ${v.id}`).toBeLessThanOrEqual(earthTol)
        expect(dNight, `longest_night_h id ${v.id}`).toBeLessThanOrEqual(stepH)
        expect(dGap, `longest_comm_gap_h id ${v.id}`).toBeLessThanOrEqual(stepH)
      }
    })
  }
})
