import { describe, expect, it } from 'vitest'
import { isVisibleOnSphere, latLonToVec3, vec3ToLatLon } from './geo'

function expectVec(v: { x: number; y: number; z: number }, x: number, y: number, z: number) {
  expect(v.x).toBeCloseTo(x, 10)
  expect(v.y).toBeCloseTo(y, 10)
  expect(v.z).toBeCloseTo(z, 10)
}

describe('latLonToVec3', () => {
  it('bieguny leżą na osi Y (konwencja three.js: Y do góry)', () => {
    expectVec(latLonToVec3(-90, 0), 0, -1, 0)
    expectVec(latLonToVec3(-90, 123), 0, -1, 0) // długość na biegunie nie ma znaczenia
    expectVec(latLonToVec3(90, 0), 0, 1, 0)
  })

  /*
   * Orientacja tekstury. SphereGeometry w three.js liczy wierzchołek jako
   *   x = -cos(phi) * sin(theta),  z = sin(phi) * sin(theta),  phi = u * 2π.
   * Tekstura equirectangular wyśrodkowana na południku 0 ma lon 0 w u = 0.5 i lon 90E w u = 0.75:
   *   u = 0.5  -> phi = π    -> (x, z) = (+1, 0)
   *   u = 0.75 -> phi = 3π/2 -> (x, z) = (0, -1)
   * Kamera na +X patrząca na środek (up = +Y) ma prawą stronę kadru w kierunku -Z,
   * więc wschód (Mare Tranquillitatis, Mare Serenitatis) wypada po prawej. Bez obrotu siatki.
   */
  it('lon 0 -> +X (środek tekstury), lon 90E -> -Z (prawa strona dla kamery na +X)', () => {
    expectVec(latLonToVec3(0, 0), 1, 0, 0)
    expectVec(latLonToVec3(0, 90), 0, 0, -1)
    expectVec(latLonToVec3(0, -90), 0, 0, 1)
    expectVec(latLonToVec3(0, 180), -1, 0, 0)
  })

  it('skaluje promieniem i daje wektor o tej długości', () => {
    const v = latLonToVec3(26.132, 3.634, 2.5)
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(2.5, 10)
  })

  it('vec3ToLatLon odwraca konwersję', () => {
    const r = vec3ToLatLon(latLonToVec3(-8.973, 15.5, 3))
    expect(r.lat).toBeCloseTo(-8.973, 9)
    expect(r.lon).toBeCloseTo(15.5, 9)
    expect(r.dist).toBeCloseTo(3, 9)
  })
})

describe('isVisibleOnSphere', () => {
  const camera = latLonToVec3(0, 0, 3) // nad środkiem strony widocznej

  it('punkt pod kamerą jest widoczny', () => {
    expect(isVisibleOnSphere(latLonToVec3(0, 0), camera)).toBe(true)
    expect(isVisibleOnSphere(latLonToVec3(20.191, 30.772), camera)).toBe(true) // Apollo 17
  })

  it('punkt po drugiej stronie kuli jest ukryty', () => {
    expect(isVisibleOnSphere(latLonToVec3(0, 180), camera)).toBe(false)
    expect(isVisibleOnSphere(latLonToVec3(10, -150), camera)).toBe(false)
  })

  it('granicą jest horyzont, nie półkula: z odległości 3r horyzont leży ok. 70,5° od punktu podkamerowego', () => {
    // acos(1/3) ≈ 70,53°
    expect(isVisibleOnSphere(latLonToVec3(0, 69), camera)).toBe(true)
    expect(isVisibleOnSphere(latLonToVec3(0, 72), camera)).toBe(false) // nadal "przednia półkula", ale za horyzontem
    expect(isVisibleOnSphere(latLonToVec3(-90, 0), camera)).toBe(false)
  })
})
