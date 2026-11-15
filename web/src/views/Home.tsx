import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { isVisibleOnSphere, latLonToVec3, vec3ToLatLon } from '../home/geo'
import { APOLLO_SITES, SOUTH_POLE_REGION_LAT, type ApolloSite } from '../home/sites'
import { useT } from '../i18n'

const ASSETS = `${import.meta.env.BASE_URL}assets/`
const COLOR_URL = `${ASSETS}moon_4k.jpg`
const BUMP_URL = `${ASSETS}moon_disp.jpg`
/** Mozaika LROC WAC bieguna płd. (rzut stereograficzny, 80–90°S); skrypt: scripts/prepare-south-pole-texture.py. */
const SOUTH_POLE_URL = `${ASSETS}south_pole_2k.jpg`
/** Krawędź mozaiki i pełna szerokość obrazu w metrach rzutu (6082 px × 100 m). */
const SP_EDGE_LAT = -80
const SP_SPAN_M = 6082 * 100
const MOON_R_M = 1737400

const FOV_DEG = 40
const MIN_DISTANCE = 1.5
/** three >= r151 liczy bump w przestrzeni ekranu; 1.5 daje czytelne krawędzie kraterów bez "plasteliny". */
const BUMP_SCALE = 1.5
const STARS_MIN_WIDTH = 600
const FLY_MS = 1200
const FADE_MS = 350
const TURN_MS = 1100
/** Odległość kamery po obrocie na misję: miejsce lądowania jest wyraźnie widoczne, ale kula nadal w kadrze. */
const SITE_VIEW_DIST = 2.6
const FLY_END_LAT = -88 // nie dokładnie -90: kamera z up=+Y nie może patrzeć idealnie wzdłuż osi Y
const FLY_END_DIST = 2.3
const AUTOROTATE_RESUME_MS = 6000
const CLICK_SLOP_PX = 5

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/** Odległość kamery, przy której cała kula (r = 1) mieści się w kadrze z zapasem. */
/** Przezroczystość czapy bieguna: pełna do 84°S, wygaszana ku krawędzi 80°S (kanał G = alpha). */
function capFadeTexture(): THREE.Texture {
  const size = 256
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size, size)
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    // Promień 0,6 obrazu ≈ 84°S (rzut stereograficzny): obszar badań w pełnej szczegółowości,
    // pas 84–80°S płynnie przechodzi w zwykłą teksturę globusa.
    g.addColorStop(0, '#fff')
    g.addColorStop(0.6, '#fff')
    g.addColorStop(0.985, '#000')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  return new THREE.CanvasTexture(cv)
}

function fitDistance(aspect: number): number {
  const halfV = (FOV_DEG / 2) * (Math.PI / 180)
  const halfH = Math.atan(Math.tan(halfV) * aspect)
  return 1 / Math.sin(Math.min(halfV, halfH) * 0.85)
}

export default function Home() {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const markerRefs = useRef(new Map<string, HTMLButtonElement>())
  const poleLabelRef = useRef<HTMLButtonElement>(null)
  const exploreRef = useRef<() => void>(() => {
    window.location.hash = '#/south-pole'
  })
  /** Obraca globus tak, żeby podany punkt (lat, lon) był na środku kadru. Ustawiane w efekcie three.js. */
  const rotateRef = useRef<(lat: number, lon: number) => void>(() => {})
  const selectSite = (s: ApolloSite) => {
    setSelected(s)
    rotateRef.current(s.lat, s.lon)
  }
  const [selected, setSelected] = useState<ApolloSite | null>(null)
  const [textureFailed, setTextureFailed] = useState(false)
  const [glFailed, setGlFailed] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setGlFailed(true)
      return
    }

    let disposed = false
    const disposables: { dispose: () => void }[] = []
    const track = <T extends { dispose: () => void }>(o: T): T => {
      disposables.push(o)
      return o
    }

    let width = Math.max(1, host.clientWidth)
    let height = Math.max(1, host.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(FOV_DEG, width / height, 0.1, 200)
    const startDist = fitDistance(width / height)
    // Start nad stroną widoczną, lekko od południa, żeby obszar bieguna był od razu w kadrze.
    const start = latLonToVec3(-25, 10, startDist)
    camera.position.set(start.x, start.y, start.z)
    camera.lookAt(0, 0, 0)

    // --- Księżyc -------------------------------------------------------------
    const moonMaterial = track(new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 1, metalness: 0 }))
    const moon = new THREE.Mesh(track(new THREE.SphereGeometry(1, 128, 64)), moonMaterial)
    scene.add(moon)

    const loader = new THREE.TextureLoader()
    loader.load(
      COLOR_URL,
      (tex) => {
        if (disposed) return tex.dispose()
        track(tex)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
        moonMaterial.map = tex
        moonMaterial.color.set(0xffffff)
        moonMaterial.needsUpdate = true
      },
      undefined,
      () => {
        if (!disposed) setTextureFailed(true)
      },
    )

    // Relief opcjonalny. Serwer deweloperski dla brakującego pliku oddaje index.html z kodem 200,
    // więc sprawdzamy też content-type.
    fetch(BUMP_URL, { method: 'HEAD' })
      .then((r) => {
        if (disposed || !r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return
        loader.load(BUMP_URL, (tex) => {
          if (disposed) return tex.dispose()
          track(tex)
          moonMaterial.bumpMap = tex
          moonMaterial.bumpScale = BUMP_SCALE
          moonMaterial.needsUpdate = true
        }, undefined, () => { /* brak reliefu nie jest błędem */ })
      })
      .catch(() => { /* jw. */ })

    // --- Czapa bieguna płd.: szczegółowa mozaika nałożona na globus ---------
    // Osobna siatka tuż nad powierzchnią; UV liczone z tego samego rzutu biegunowego co obraz
    // (lon 0 u góry, 90°E w prawo), krawędź miękko wygaszona, żeby nie było widać szwu.
    const spCap = (90 + SP_EDGE_LAT) * (Math.PI / 180)
    const spGeo = track(new THREE.SphereGeometry(1.0006, 256, 32, 0, Math.PI * 2, Math.PI - spCap, spCap))
    {
      const pos = spGeo.getAttribute('position')
      const uv = spGeo.getAttribute('uv')
      for (let i = 0; i < pos.count; i++) {
        const ll = vec3ToLatLon({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) })
        const rho = 2 * MOON_R_M * Math.tan(((90 + ll.lat) / 2) * (Math.PI / 180))
        const lon = ll.lon * (Math.PI / 180)
        uv.setXY(i, 0.5 + (rho * Math.sin(lon)) / SP_SPAN_M, 0.5 + (rho * Math.cos(lon)) / SP_SPAN_M)
      }
      uv.needsUpdate = true
    }
    const spMaterial = track(new THREE.MeshStandardMaterial({
      roughness: 1, metalness: 0, transparent: true, opacity: 0, depthWrite: false,
      alphaMap: track(capFadeTexture()),
    }))
    const spMesh = new THREE.Mesh(spGeo, spMaterial)
    spMesh.visible = false
    scene.add(spMesh)
    loader.load(SOUTH_POLE_URL, (tex) => {
      if (disposed) return tex.dispose()
      track(tex)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
      spMaterial.map = tex
      spMaterial.opacity = 1
      spMaterial.needsUpdate = true
      spMesh.visible = true
    }, undefined, () => { /* bez mozaiki zostaje zwykła tekstura globusa */ })

    // --- Światło: z boku względem kamery, żeby terminator był zawsze w kadrze --
    scene.add(new THREE.AmbientLight(0xffffff, 0.07))
    const sun = new THREE.DirectionalLight(0xffffff, 3.2)
    scene.add(sun)

    // --- Obszar bieguna południowego (okrąg 84°S + delikatne wypełnienie) -----
    const capAngle = (90 + SOUTH_POLE_REGION_LAT) * (Math.PI / 180)
    const capFill = new THREE.Mesh(
      track(new THREE.SphereGeometry(1.003, 64, 6, 0, Math.PI * 2, Math.PI - capAngle, capAngle)),
      track(new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.06, depthWrite: false })),
    )
    scene.add(capFill)
    const ringPts: THREE.Vector3[] = []
    for (let i = 0; i < 128; i++) {
      const p = latLonToVec3(SOUTH_POLE_REGION_LAT, (i / 128) * 360, 1.004)
      ringPts.push(new THREE.Vector3(p.x, p.y, p.z))
    }
    scene.add(new THREE.LineLoop(
      track(new THREE.BufferGeometry().setFromPoints(ringPts)),
      track(new THREE.LineBasicMaterial({ color: 0x9fe2ff })),
    ))
    const capMinY = Math.sin(SOUTH_POLE_REGION_LAT * (Math.PI / 180)) // punkt kuli jest w obszarze, gdy y < capMinY

    // --- Gwiazdy (pomijane na wąskich ekranach) ------------------------------
    if (width >= STARS_MIN_WIDTH) {
      const n = 1400
      const pos = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1
        const a = Math.random() * Math.PI * 2
        const s = Math.sqrt(1 - u * u)
        pos[i * 3] = 60 * s * Math.cos(a)
        pos[i * 3 + 1] = 60 * u
        pos[i * 3 + 2] = 60 * s * Math.sin(a)
      }
      const geo = track(new THREE.BufferGeometry())
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      scene.add(new THREE.Points(geo, track(new THREE.PointsMaterial({
        color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.55,
      }))))
    }

    // --- Sterowanie ----------------------------------------------------------
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.enableDamping = true
    controls.minDistance = MIN_DISTANCE
    controls.maxDistance = Math.max(6, startDist * 1.3)
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.35
    let resumeTimer = 0
    const onControlStart = () => {
      turn = null
      window.clearTimeout(resumeTimer)
      controls.autoRotate = false
    }
    const onControlEnd = () => {
      window.clearTimeout(resumeTimer)
      resumeTimer = window.setTimeout(() => { controls.autoRotate = true }, AUTOROTATE_RESUME_MS)
    }
    controls.addEventListener('start', onControlStart)
    controls.addEventListener('end', onControlEnd)

    // --- Przelot nad biegun --------------------------------------------------
    let flight: { t0: number; dur: number; lat: number; lon: number; dist: number } | null = null
    let flightDone = false
    let leaveTimer = 0
    const explore = () => {
      if (flight || flightDone) return
      window.clearTimeout(resumeTimer)
      controls.enabled = false
      controls.autoRotate = false
      setSelected(null)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      flight = { t0: performance.now(), dur: reduce ? 0 : FLY_MS, ...vec3ToLatLon(camera.position) }
    }
    exploreRef.current = explore

    // --- Obrót na wybraną misję ---------------------------------------------
    // Kamera płynie po łuku do kierunku misji (najkrótszą drogą po długości geograficznej).
    let turn: {
      t0: number; dur: number; lat0: number; lon0: number; dist0: number; lat1: number; lon1: number; dist1: number
    } | null = null
    rotateRef.current = (lat, lon) => {
      if (flight || flightDone) return
      window.clearTimeout(resumeTimer)
      controls.autoRotate = false
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const cur = vec3ToLatLon(camera.position)
      turn = {
        t0: performance.now(), dur: reduce ? 0 : TURN_MS,
        lat0: cur.lat, lon0: cur.lon, dist0: cur.dist,
        lat1: Math.max(-80, Math.min(80, lat)), lon1: lon,
        dist1: Math.max(MIN_DISTANCE, Math.min(cur.dist, SITE_VIEW_DIST)),
      }
    }

    // --- Klik / kursor nad obszarem bieguna ----------------------------------
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const overPoleRegion = (ev: PointerEvent): boolean => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(ndc, camera)
      const hit = raycaster.intersectObject(moon, false)[0]
      return hit !== undefined && hit.point.y < capMinY
    }
    let downX = 0
    let downY = 0
    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX
      downY = ev.clientY
    }
    const onPointerUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > CLICK_SLOP_PX) return // to było przeciąganie
      if (overPoleRegion(ev)) explore()
      else setSelected(null)
    }
    const onPointerMove = (ev: PointerEvent) => {
      if (ev.buttons !== 0) return
      renderer.domElement.style.cursor = overPoleRegion(ev) ? 'pointer' : 'grab'
    }
    const canvas = renderer.domElement
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointermove', onPointerMove)

    // --- Nakładka HTML: markery i etykieta bieguna ---------------------------
    const sitePos = APOLLO_SITES.map((s) => {
      const p = latLonToVec3(s.lat, s.lon)
      return { id: s.id, v: new THREE.Vector3(p.x, p.y, p.z) }
    })
    const proj = new THREE.Vector3()
    const place = (el: HTMLElement | null | undefined, v: THREE.Vector3) => {
      if (!el) return
      if (!isVisibleOnSphere(v, camera.position)) {
        el.style.visibility = 'hidden'
        return
      }
      proj.copy(v).project(camera)
      el.style.visibility = 'visible'
      el.style.transform = `translate(${((proj.x + 1) / 2) * width}px, ${((1 - proj.y) / 2) * height}px)`
    }
    const poleAnchor = new THREE.Vector3()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()

    // --- Pętla renderowania (wstrzymywana, gdy karta jest ukryta) -------------
    let raf = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)

      if (flight) {
        const k = flight.dur > 0 ? Math.min(1, (now - flight.t0) / flight.dur) : 1
        const e = easeInOutCubic(k)
        const p = latLonToVec3(lerp(flight.lat, FLY_END_LAT, e), flight.lon, lerp(flight.dist, FLY_END_DIST, e))
        camera.position.set(p.x, p.y, p.z)
        camera.lookAt(0, 0, 0)
        if (k >= 1) {
          flight = null
          flightDone = true
          setLeaving(true)
          leaveTimer = window.setTimeout(() => { window.location.hash = '#/south-pole' }, FADE_MS)
        }
      } else if (!flightDone) {
        if (turn) {
          const k = turn.dur > 0 ? Math.min(1, (now - turn.t0) / turn.dur) : 1
          const e = easeInOutCubic(k)
          const dLon = ((turn.lon1 - turn.lon0 + 540) % 360) - 180
          const p = latLonToVec3(lerp(turn.lat0, turn.lat1, e), turn.lon0 + dLon * e, lerp(turn.dist0, turn.dist1, e))
          camera.position.set(p.x, p.y, p.z)
          camera.lookAt(0, 0, 0)
          if (k >= 1) {
            turn = null
            controls.update() // OrbitControls przejmuje kamerę od bieżącej pozycji
            window.clearTimeout(resumeTimer)
            resumeTimer = window.setTimeout(() => { controls.autoRotate = true }, AUTOROTATE_RESUME_MS)
          }
        } else {
          controls.update()
        }
      }
      camera.updateMatrixWorld()

      // Słońce z prawej strony kadru i lekko zza kamery: oświetlone ok. 55% tarczy.
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      up.setFromMatrixColumn(camera.matrixWorld, 1)
      sun.position.copy(right).multiplyScalar(5).addScaledVector(up, 1.5)
        .addScaledVector(proj.copy(camera.position).normalize(), 1.2)

      for (const s of sitePos) place(markerRefs.current.get(s.id), s.v)
      // Etykieta bieguna: punkt okręgu 84°S najbliższy kamerze.
      const a = latLonToVec3(SOUTH_POLE_REGION_LAT, vec3ToLatLon(camera.position).lon)
      place(poleLabelRef.current, poleAnchor.set(a.x, a.y, a.z))

      renderer.render(scene, camera)
    }
    const onVisibility = () => {
      cancelAnimationFrame(raf)
      raf = 0
      if (!document.hidden) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()

    const resizeObserver = new ResizeObserver(() => {
      width = Math.max(1, host.clientWidth)
      height = Math.max(1, host.clientHeight)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    resizeObserver.observe(host)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.clearTimeout(resumeTimer)
      window.clearTimeout(leaveTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      resizeObserver.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      controls.removeEventListener('start', onControlStart)
      controls.removeEventListener('end', onControlEnd)
      controls.dispose()
      for (const d of disposables) d.dispose()
      renderer.dispose()
      canvas.remove()
      exploreRef.current = () => { window.location.hash = '#/south-pole' }
      rotateRef.current = () => {}
    }
  }, [])

  return (
    <div className={`home${leaving ? ' leaving' : ''}`}>
      <div className="globe-host" ref={hostRef} />

      {!glFailed && (
        <div className="globe-overlay">
          {APOLLO_SITES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`globe-marker${selected?.id === s.id ? ' active' : ''}`}
              style={{ visibility: 'hidden' }}
              ref={(el) => {
                if (el) markerRefs.current.set(s.id, el)
                else markerRefs.current.delete(s.id)
              }}
              onClick={() => selectSite(s)}
            >
              <span className="globe-marker-dot" />
              <span className="globe-marker-label">{s.name}</span>
            </button>
          ))}
          <button
            type="button"
            className="globe-pole-label"
            style={{ visibility: 'hidden' }}
            ref={poleLabelRef}
            onClick={() => exploreRef.current()}
          >
            {t('home.southPole')}
          </button>
        </div>
      )}

      {(glFailed || textureFailed) && (
        <div className="home-notice" role="status">
          {t(glFailed ? 'home.webglError' : 'home.textureError')}
        </div>
      )}

      {selected && (
        <aside className="site-card">
          <button type="button" className="site-card-close" aria-label={t('card.close')} onClick={() => setSelected(null)}>
            ×
          </button>
          <div className="site-card-meta mono">{t('card.landed')} · {selected.year}</div>
          <h2>{selected.name}</h2>
          <p>{t(`site.${selected.id}.desc`)}</p>
        </aside>
      )}

      <section className="home-hero" aria-labelledby="home-title">
        <img className="hero-logo" src={`${ASSETS}logo.svg`} alt="" width={84} height={77} />
        <h1 id="home-title" className="display">
          <span>{t('home.titleA')}</span>
          <span>{t('home.titleB')}</span>
        </h1>
        <div className="hairline" aria-hidden="true" />
        <p className="home-lead">{t('home.lead')}</p>
        <button type="button" className="btn-glow" onClick={() => exploreRef.current()}>
          {t('home.cta')}
          <span aria-hidden="true">→</span>
        </button>
        <p className="home-hint">{t('home.hint')}</p>
        <details className="home-missions">
          <summary>{t('home.missions')}</summary>
          <ul>
            {APOLLO_SITES.map((s) => (
              <li key={s.id}>
                <button type="button" aria-pressed={selected?.id === s.id} onClick={() => selectSite(s)}>
                  <span>{s.name}</span>
                  <span className="mono">{s.year}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <dl className="home-stats" aria-label={t('home.statsTitle')}>
        <dt className="home-stats-title">{t('home.statsTitle')}</dt>
        <dd />
        <dt>{t('home.stat.apollo')}</dt>
        <dd>{APOLLO_SITES.length}</dd>
        <dt>{t('home.stat.years')}</dt>
        <dd>{Math.min(...APOLLO_SITES.map((s) => s.year))}–{Math.max(...APOLLO_SITES.map((s) => s.year))}</dd>
        <dt>{t('home.stat.region')}</dt>
        <dd>{Math.abs(SOUTH_POLE_REGION_LAT)}°S–90°S</dd>
      </dl>
    </div>
  )
}
