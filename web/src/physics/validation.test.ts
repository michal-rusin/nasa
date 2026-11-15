/// <reference types="node" />
// Zgodność fizyki TS z validation.json i candidates.bin (kontrakt 6).
// Dane czytane z dysku: web/public/data oraz web/public/data/sample (jeśli są).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildIdToIndex, parseCandidates, parseMeta } from '../data/load'
import { candidatesRange } from '../data/years'
import { earthPct, longestCommGapH, longestNightH, sunPct } from './aggregates'
import { maskFromBuffer } from './mask'
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
    it(`zgodność agregatów: ${dir.slice(DATA_ROOT.length) || 'public/data'}`, () => {
      const meta = parseMeta(readJson(join(dir, 'meta.json')))
      const cand = parseCandidates(readBuf(join(dir, 'candidates.bin')), meta)
      const idToIndex = buildIdToIndex(cand)
      const ephem = ephemFromBuffer(readBuf(join(dir, 'ephem.bin')), meta.n_steps)
      const index = readJson(join(dir, 'masks', 'index.json')) as { records: Record<string, [string, number]> }
      const validation = readJson(join(dir, 'validation.json')) as ValidationEntry[]
      const stepH = meta.step_s / 3600
      // candidates.bin i validation.json dotyczą tylko candidates_period (2028 = kroki 0..8783),
      // a ephem.bin może obejmować więcej lat (kontrakt 1.4).
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

        expect(dSun, `sun_pct id ${v.id}`).toBeLessThanOrEqual(sunTol)
        expect(dEarth, `earth_pct id ${v.id}`).toBeLessThanOrEqual(earthTol)
        expect(dNight, `longest_night_h id ${v.id}`).toBeLessThanOrEqual(stepH)
        expect(dGap, `longest_comm_gap_h id ${v.id}`).toBeLessThanOrEqual(stepH)
      }
    })
  }
})
