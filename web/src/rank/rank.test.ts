import { describe, expect, it } from 'vitest'
import { COLUMN_NAMES, type Candidates, type ColumnName, type MetricKey } from '../data/types'
import { passMask } from './filters'
import { normalizeAll, normalizeMetric, percentile } from './normalize'
import { computeScore } from './score'
import { topN } from './topN'

function cands(cols: Partial<Record<ColumnName, number[]>>, n: number): Candidates {
  const col = {} as Record<ColumnName, Float32Array>
  for (const c of COLUMN_NAMES) col[c] = Float32Array.from(cols[c] ?? new Array<number>(n).fill(0))
  return { n, col }
}

describe('normalize', () => {
  const vals = Array.from({ length: 101 }, (_, i) => i) // 0..100, p2=2, p98=98

  it('percentyl z interpolacją', () => {
    expect(percentile([0, 10], 0.5)).toBe(5)
    expect(percentile(Float64Array.from(vals), 0.02)).toBeCloseTo(2)
  })

  it('rank / (N-1), bez nasycenia powyżej dawnego p98', () => {
    const t = normalizeMetric(vals, 'high')
    expect(t[0]).toBe(0)
    expect(t[50]).toBeCloseTo(0.5)
    expect(t[100]).toBe(1)
    expect(t[99]).toBeLessThan(t[100]!)
    expect(t[98]).toBeLessThan(t[99]!)
  })

  it('kolejność wejścia nie ma znaczenia (rank po wartościach)', () => {
    const t = normalizeMetric([30, 10, 20], 'high')
    expect(Array.from(t)).toEqual([1, 0, 0.5])
  })

  it('remisy → równe normy (średni rank)', () => {
    const t = normalizeMetric([5, 1, 5, 9, 5], 'high')
    expect(t[0]).toBe(t[2])
    expect(t[2]).toBe(t[4])
    expect(t[0]).toBeCloseTo(2 / 4) // ranki 1,2,3 → średnio 2
    expect(t[1]).toBe(0)
    expect(t[3]).toBe(1)
  })

  it('odwraca dla low (1 = najlepiej)', () => {
    const t = normalizeMetric(vals, 'low')
    expect(t[0]).toBe(1)
    expect(t[100]).toBe(0)
    expect(t[25]).toBeCloseTo(1 - 25 / 100, 5)
  })

  it('NaN → 0 i nie wlicza się do N', () => {
    const t = normalizeMetric([1, NaN, 3], 'high')
    expect(Array.from(t)).toEqual([0, 0, 1])
    expect(normalizeMetric([NaN, 7], 'low')[1]).toBe(1)
  })

  it('topN rośnie ze score, bez zależności od indeksu przy różnych wartościach', () => {
    // 100 punktów, górne wartości rosną z malejącym indeksem → dawniej wszystkie > p98 miały 1.0
    const raw = Array.from({ length: 100 }, (_, i) => (i < 90 ? i : 1000 - i))
    const norm = normalizeMetric(raw, 'high')
    const x = raw.map((_, i) => i * 1e5)
    const y = raw.map(() => 0)
    const r = topN(norm, raw.map(() => 1), x, y, { n: 10 })
    const expected = raw.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 10).map((p) => p[1])
    expect(r.map((p) => p.index)).toEqual(expected)
    expect(new Set(r.map((p) => p.score)).size).toBe(10)
    for (let k = 1; k < r.length; k++) expect(r[k]!.score).toBeLessThan(r[k - 1]!.score)
  })
})

describe('passMask', () => {
  const c = cands({ sun_pct: [10, 50, 90, NaN], slope_deg: [1, 5, 20, 1] }, 4)

  it('pusty filtr → wszystko przechodzi (także NaN)', () => {
    expect(Array.from(passMask(c, {}))).toEqual([1, 1, 1, 1])
    expect(Array.from(passMask(c, { sun_pct: {} }))).toEqual([1, 1, 1, 1])
  })

  it('min i max, granice włącznie, NaN odpada', () => {
    expect(Array.from(passMask(c, { sun_pct: { min: 50 } }))).toEqual([0, 1, 1, 0])
    expect(Array.from(passMask(c, { slope_deg: { max: 5 } }))).toEqual([1, 1, 0, 1])
    expect(Array.from(passMask(c, { sun_pct: { min: 50 }, slope_deg: { max: 5 } }))).toEqual([0, 1, 0, 0])
    expect(Array.from(passMask(c, { sun_pct: { min: 20, max: 60 } }))).toEqual([0, 1, 0, 0])
  })
})

describe('score', () => {
  const norms = {
    sun_pct: Float32Array.from([1, 0]),
    earth_pct: Float32Array.from([0, 1]),
    longest_night_h: Float32Array.from([0, 0]),
    longest_comm_gap_h: Float32Array.from([0, 0]),
    slope_deg: Float32Array.from([0, 0]),
    dist_psr_km: Float32Array.from([0, 0]),
  } satisfies Record<MetricKey, Float32Array>

  it('średnia ważona', () => {
    const s = computeScore(norms, { sun_pct: 3, earth_pct: 1 }, 2)
    expect(s[0]).toBeCloseTo(0.75)
    expect(s[1]).toBeCloseTo(0.25)
  })

  it('wagi zerowe → same zera, ujemne ignorowane', () => {
    expect(Array.from(computeScore(norms, {}, 2))).toEqual([0, 0])
    const s = computeScore(norms, { sun_pct: 1, earth_pct: -5 }, 2)
    expect(s[0]).toBeCloseTo(1)
    expect(s[1]).toBeCloseTo(0)
  })
})

describe('topN', () => {
  it('NMS odrzuca sąsiada w promieniu', () => {
    const score = [0.9, 0.8, 0.7]
    const x = [0, 3000, 10000] // 3 km i 10 km od pierwszego
    const y = [0, 0, 0]
    const r = topN(score, [1, 1, 1], x, y, { radiusKm: 5 })
    expect(r.map((p) => p.index)).toEqual([0, 2])
    const noNms = topN(score, [1, 1, 1], x, y, { radiusKm: 0 })
    expect(noNms.map((p) => p.index)).toEqual([0, 1, 2])
  })

  it('NMS działa przez granicę komórek siatki', () => {
    const r = topN([1, 0.5], [1, 1], [4999, 5001], [0, 0], { radiusKm: 5 })
    expect(r.map((p) => p.index)).toEqual([0])
  })

  it('remis → niższy indeks pierwszy', () => {
    const r = topN([0.5, 0.5, 0.5], [1, 1, 1], [0, 1e5, 2e5], [0, 0, 0])
    expect(r.map((p) => p.index)).toEqual([0, 1, 2])
  })

  it('odfiltrowane nie wchodzą, limit n', () => {
    const score = [1, 0.9, 0.8, 0.7]
    const x = [0, 1e5, 2e5, 3e5]
    const y = [0, 0, 0, 0]
    const r = topN(score, [0, 1, 1, 1], x, y, { n: 2 })
    expect(r).toEqual([{ index: 1, score: 0.9 }, { index: 2, score: 0.8 }])
  })
})

describe('ranking end-to-end: wagi zmieniają top-10', () => {
  // 30 punktów daleko od siebie (NMS nie przeszkadza): sun_pct rośnie z i, slope_deg też rośnie z i
  // (czyli gorzej). Waga na sun → najlepsze najwyższe i; waga na slope → najlepsze najniższe i.
  const N = 30
  const idx = Array.from({ length: N }, (_, i) => i)
  const c = cands({
    sun_pct: idx.map((i) => i),
    slope_deg: idx.map((i) => i),
    x_m: idx.map((i) => i * 100_000),
    y_m: idx.map(() => 0),
  }, N)
  const norms = normalizeAll(c)
  const all = new Uint8Array(N).fill(1)
  const rank = (w: Partial<Record<MetricKey, number>>) =>
    topN(computeScore(norms, w, N), all, c.col.x_m, c.col.y_m, { n: 10, radiusKm: 5 }).map((p) => p.index)

  it('waga na nasłonecznienie vs na nachylenie odwraca kolejność', () => {
    expect(rank({ sun_pct: 1 })).toEqual([29, 28, 27, 26, 25, 24, 23, 22, 21, 20])
    expect(rank({ slope_deg: 1 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('same remisy (stała metryka) → tie-breaker: niższy indeks, stabilnie i powtarzalnie', () => {
    const a = rank({ earth_pct: 1 })
    expect(a).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(rank({ earth_pct: 1 })).toEqual(a)
  })

  it('przesunięcie wagi przesuwa top-10 monotonicznie', () => {
    const top = rank({ sun_pct: 3, slope_deg: 1 })
    expect(top[0]).toBe(29)
    expect(top).toEqual([...top].sort((x, y) => y - x))
  })
})
