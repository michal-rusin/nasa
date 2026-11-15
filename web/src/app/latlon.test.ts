import { describe, expect, it } from 'vitest'
import { parseLatLon } from './latlon'

describe('parseLatLon', () => {
  it('commas, spaces, signs', () => {
    expect(parseLatLon('-89.5, 129')).toEqual({ ok: true, lat: -89.5, lon: 129 })
    expect(parseLatLon('  -89.5   129 ')).toEqual({ ok: true, lat: -89.5, lon: 129 })
    expect(parseLatLon('-89.5,-45.25')).toEqual({ ok: true, lat: -89.5, lon: -45.25 })
    expect(parseLatLon('+12; 3')).toEqual({ ok: true, lat: 12, lon: 3 })
  })

  it('N/S/E/W letters and degrees', () => {
    expect(parseLatLon('89.5S 129E')).toEqual({ ok: true, lat: -89.5, lon: 129 })
    expect(parseLatLon('89.5°S, 10°W')).toEqual({ ok: true, lat: -89.5, lon: -10 })
    expect(parseLatLon('-89.5S, 10')).toEqual({ ok: false, reason: 'format' })
  })

  it('lon 0..360 normalized to (−180, 180]', () => {
    expect(parseLatLon('-88, 270')).toEqual({ ok: true, lat: -88, lon: -90 })
    expect(parseLatLon('-88, 180')).toEqual({ ok: true, lat: -88, lon: 180 })
  })

  it('out of range and invalid format', () => {
    expect(parseLatLon('-91, 0')).toEqual({ ok: false, reason: 'range' })
    expect(parseLatLon('-89, 400')).toEqual({ ok: false, reason: 'range' })
    expect(parseLatLon('-89.5')).toEqual({ ok: false, reason: 'format' })
    expect(parseLatLon('abc')).toEqual({ ok: false, reason: 'format' })
    expect(parseLatLon('')).toEqual({ ok: false, reason: 'format' })
  })
})
