import { describe, expect, it } from 'vitest'
import { isVisibleOnSphere, latLonToVec3, vec3ToLatLon } from './geo'

function expectVec(v: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(v.x).toBeCloseTo(x, 10)
  expect(v.y).toBeCloseTo(y, 10)
  expect(v.z).toBeCloseTo(z, 10)
}

describe('latLonToVec3', () => {
  it('poles lie on the Y axis (three.js convention: Y up)', () => {
    expectVec(latLonToVec3(-90, 0), 0, -1, 0)
    expectVec(latLonToVec3(-90, 123), 0, -1, 0) // longitude at the pole is irrelevant
    expectVec(latLonToVec3(90, 0), 0, 1, 0)
  })

  /*
   * Texture orientation. three.js SphereGeometry computes vertices as
   *   x = -cos(phi) * sin(theta),  z = sin(phi) * sin(theta),  phi = u * 2π.
   * An equirectangular texture centered on longitude 0 places lon 0 at u = 0.5 and lon 90E at u = 0.75:
   *   u = 0.5  -> phi = π    -> (x, z) = (+1, 0)
   *   u = 0.75 -> phi = 3π/2 -> (x, z) = (0, -1)
   * A camera at +X looking at the center (up = +Y) has screen-right along -Z,
   * so east (Mare Tranquillitatis, Mare Serenitatis) appears on the right. No mesh rotation.
   */
  it('lon 0 -> +X (texture center), lon 90E -> -Z (right side for a camera at +X)', () => {
    expectVec(latLonToVec3(0, 0), 1, 0, 0)
    expectVec(latLonToVec3(0, 90), 0, 0, -1)
    expectVec(latLonToVec3(0, -90), 0, 0, 1)
    expectVec(latLonToVec3(0, 180), -1, 0, 0)
  })

  it('scales by radius and returns a vector of that length', () => {
    const v = latLonToVec3(26.132, 3.634, 2.5)
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(2.5, 10)
  })

  it('vec3ToLatLon reverses the conversion', () => {
    const r = vec3ToLatLon(latLonToVec3(-8.973, 15.5, 3))
    expect(r.lat).toBeCloseTo(-8.973, 9)
    expect(r.lon).toBeCloseTo(15.5, 9)
    expect(r.dist).toBeCloseTo(3, 9)
  })
})

describe('isVisibleOnSphere', () => {
  const camera = latLonToVec3(0, 0, 3) // above the center of the near side

  it('point beneath the camera is visible', () => {
    expect(isVisibleOnSphere(latLonToVec3(0, 0), camera)).toBe(true)
    expect(isVisibleOnSphere(latLonToVec3(20.191, 30.772), camera)).toBe(true) // Apollo 17
  })

  it('point on the far side is hidden', () => {
    expect(isVisibleOnSphere(latLonToVec3(0, 180), camera)).toBe(false)
    expect(isVisibleOnSphere(latLonToVec3(10, -150), camera)).toBe(false)
  })

  it('boundary is the horizon, not a hemisphere: at distance 3r the horizon is about 70.5° from the point beneath the camera', () => {
    // acos(1/3) ≈ 70,53°
    expect(isVisibleOnSphere(latLonToVec3(0, 69), camera)).toBe(true)
    expect(isVisibleOnSphere(latLonToVec3(0, 72), camera)).toBe(false) // still on the near hemisphere, but beyond the horizon
    expect(isVisibleOnSphere(latLonToVec3(-90, 0), camera)).toBe(false)
  })
})
