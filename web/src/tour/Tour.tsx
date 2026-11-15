import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { dictionary, fill, useT } from '../i18n'
import { clipRect, placeCard, type Point, type Rect, type Size } from './placement'
import { currentRoute, snapshot, STEPS, type Snapshot, type TourStep } from './steps'
import { useTour } from './store'
import './tour.css'

/** Ile czekamy na cel (np. dane bieguna się ładują), zanim pokażemy kartę bez podświetlenia. */
const WAIT_TARGET_MS = 1500
/** Po zaliczeniu akcji: krótka pauza, żeby było widać jej efekt. */
const ADVANCE_DELAY_MS = 450
/** Cel musi tyle stać w miejscu, zanim karta do niego podjedzie (nie goni go w trakcie przewijania). */
const STABLE_MS = 120
/** Strona musi tyle stać, zanim samouczek sam dociągnie cel w kadr (aplikacja kończy własne przewijanie). */
const SCROLL_IDLE_MS = 160
const HOLE_PAD = 6

type Phase = 'do' | 'info' | 'after'

function subscribeHash(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function findTarget(step: TourStep): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
  if (!el || el.getClientRects().length === 0) return null
  return getComputedStyle(el).visibility === 'hidden' ? null : el
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

function viewport(): Size {
  return { w: window.innerWidth, h: window.innerHeight }
}

function TourLayer() {
  const t = useT()
  const i = useTour((s) => s.i)
  const dir = useTour((s) => s.dir)
  const advanceFrom = useTour((s) => s.advanceFrom)
  const back = useTour((s) => s.back)
  const stop = useTour((s) => s.stop)
  const route = useSyncExternalStore(subscribeHash, currentRoute)
  const total = STEPS.length
  const step = STEPS[Math.min(i, total - 1)]!
  const away = route !== step.route

  const [phase, setPhase] = useState<Phase>('info')
  const [rect, setRect] = useState<Rect | null>(null)
  /** Krok, dla którego cel został już znaleziony (albo minął czas oczekiwania). */
  const [settled, setSettled] = useState(-1)
  const [hidden, setHidden] = useState(false)
  const [moving, setMoving] = useState(true)
  const [vp, setVp] = useState<Size>(viewport)
  const [pos, setPos] = useState<Point | null>(null)
  /** Prostokąt, przy którym stoi karta: aktualizowany dopiero, gdy cel się uspokoi (null = brak celu). */
  const [anchor, setAnchor] = useState<Rect | null>(null)
  /** Czy `anchor` został już choć raz ustalony; wcześniej karta nie ma położenia i jest niewidoczna. */
  const [anchorReady, setAnchorReady] = useState(false)
  /** Cel istnieje w DOM (może być chwilowo poza ekranem, gdy strona do niego jedzie). */
  const [exists, setExists] = useState(false)
  /** Płynny przejazd karty włączamy dopiero po pierwszym ustawieniu (inaczej wjeżdżałaby z rogu). */
  const [glide, setGlide] = useState(false)
  const base = useRef<Snapshot>({ colorBy: 'score', signals: {} })
  const rectRef = useRef<Rect | null>(null)
  const anchorRef = useRef<Rect | null>(null)
  const cardRef = useRef<HTMLElement>(null)

  /** Odczyt położenia celu: element (null = brak) i jego część widoczna w oknie. */
  const measure = (): { el: HTMLElement | null; rect: Rect | null } => {
    const el = away ? null : findTarget(step)
    const size = viewport()
    const next = el ? clipRect(el.getBoundingClientRect(), size) : null
    if (!sameRect(rectRef.current, next)) {
      rectRef.current = next
      setRect(next)
    }
    setVp((v) => (v.w === size.w && v.h === size.h ? v : size))
    setExists(el !== null)
    return { el, rect: next }
  }
  const moveCardTo = (r: Rect | null) => {
    anchorRef.current = r
    setAnchor(r)
    setAnchorReady(true)
  }

  // Wejście w krok: przygotuj stan aplikacji, zapamiętaj punkt odniesienia, ustal fazę.
  useLayoutEffect(() => {
    step.ensure?.()
    const b = snapshot()
    base.current = b
    const already = step.done?.(b) ?? false
    // Krok spełniony już przy wejściu: do przodu przeskakujemy, przy cofaniu pokazujemy go z „Next”.
    if (already && dir === 1) {
      advanceFrom(i, total)
      return
    }
    setPhase(step.done && !already ? 'do' : 'info')
    setHidden(false)
    setMoving(true)
    const m = measure()
    if (m.el) setSettled(i)
    // Pierwsza karta staje od razu przy celu; kolejne podjeżdżają, gdy cel się uspokoi (pętla niżej).
    if (m.rect && !anchorReady) moveCardTo(m.rect)
    const moveTimer = window.setTimeout(() => setMoving(false), 520)
    return () => window.clearTimeout(moveTimer)
    // Celowo tylko [i]: efekt opisuje wejście w krok, nie reaguje na zmiany w jego trakcie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  // Pętla kroku: śledzi cel (przewijanie, animacje, zmiana okna) i sprawdza warunek zaliczenia.
  useEffect(() => {
    let raf = 0
    let advanceTimer = 0
    let fired = false
    let adjusted = false
    const t0 = performance.now()
    let lastRect = rectRef.current
    let rectAt = t0
    let lastScroll = -1
    let scrollAt = t0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const m = measure()
      const waited = now - t0 > WAIT_TARGET_MS
      if (m.el || waited) setSettled(i)

      // Strona się przewija: podświetlenie trzyma się celu bez opóźnienia (wyłączamy jego przejazd).
      const scrollTop = document.querySelector('.sp-page')?.scrollTop ?? 0
      if (scrollTop !== lastScroll) {
        if (lastScroll >= 0) {
          scrollAt = now
          setMoving(false)
        }
        lastScroll = scrollTop
      }
      if (!sameRect(m.rect, lastRect)) {
        lastRect = m.rect
        rectAt = now
      }

      // Karta: jeden płynny przejazd, gdy cel stoi. Cel poza ekranem = karta czeka tam, gdzie była.
      if (m.el) {
        if (m.rect && now - rectAt >= STABLE_MS && !sameRect(anchorRef.current, m.rect)) moveCardTo(m.rect)
      } else if (waited) {
        moveCardTo(null)
      }

      // Ręczne przewijanie jest wyłączone, więc cel w kadr dociąga samouczek: raz na krok, po tym,
      // jak aplikacja skończy własne przewijanie (wybór miejsca, „Compare place”).
      if (!adjusted && m.el && !away && now - t0 > 250 && now - scrollAt > SCROLL_IDLE_MS) {
        adjusted = true
        const r = m.el.getBoundingClientRect()
        const fits = r.height < window.innerHeight * 0.8
        const inView = r.top >= 70 && r.bottom <= window.innerHeight - 10
        if (fits && !inView) m.el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      }

      setHidden(step.hideWhen?.(base.current) ?? false)
      if (phase === 'do' && !fired && step.done?.(base.current)) {
        fired = true
        if (step.after) setPhase('after')
        else advanceTimer = window.setTimeout(() => advanceFrom(i, total), ADVANCE_DELAY_MS)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(advanceTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, phase, away])

  // Esc kończy samouczek i nie trafia do widoku (tam Esc zamyka boxy miejsc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      stop()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [stop])

  // Ręczne przewijanie strony wyłączone na czas samouczka (tour.css): cel nie ucieka z kadru.
  useEffect(() => {
    document.documentElement.classList.add('tour-on')
    return () => document.documentElement.classList.remove('tour-on')
  }, [])

  // Położenie karty: z jej faktycznego rozmiaru i z `anchor` (nie z bieżącej pozycji celu).
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card || (!away && !anchorReady)) return
    const next = placeCard(away ? null : anchor, { w: card.offsetWidth, h: card.offsetHeight }, vp, { inside: step.inside, end: step.end })
    const rounded = { left: Math.round(next.left), top: Math.round(next.top) }
    setPos((p) => (p && p.left === rounded.left && p.top === rounded.top ? p : rounded))
  })
  useEffect(() => {
    if (!pos || glide) return
    const id = requestAnimationFrame(() => setGlide(true))
    return () => cancelAnimationFrame(id)
  }, [pos, glide])

  const last = i >= total - 1
  const prev = STEPS[i - 1]
  const canBack = !away && prev !== undefined && prev.route === step.route
  const visible = !hidden && settled === i && pos !== null
  const hole = !away && rect !== null
  const pad = step.inside ? 0 : HOLE_PAD
  const key = (suffix: string) => `tour.${step.id}.${suffix}`
  // Tło jest zablokowane: klikać da się tylko podświetlony element i kartę. Cztery pasy wokół
  // „dziury” łapią kliknięcia i kółko myszy; bez celu jeden pas zakrywa (i przyciemnia) wszystko.
  const hx = hole ? Math.max(0, rect.left - pad) : 0
  const hy = hole ? Math.max(0, rect.top - pad) : 0
  const hr = hole ? Math.min(vp.w, rect.left + rect.width + pad) : 0
  const hb = hole ? Math.min(vp.h, rect.top + rect.height + pad) : 0
  const blockers: CSSProperties[] = hole
    ? [
      { left: 0, top: 0, width: vp.w, height: hy },
      { left: 0, top: hb, width: vp.w, height: Math.max(0, vp.h - hb) },
      { left: 0, top: hy, width: hx, height: hb - hy },
      { left: hr, top: hy, width: Math.max(0, vp.w - hr), height: hb - hy },
    ]
    : [{ left: 0, top: 0, width: vp.w, height: vp.h }]
  // Pełne przyciemnienie tylko, gdy celu naprawdę nie ma (nie wtedy, gdy strona do niego jedzie).
  const dimAll = !hole && (away || !exists)
  /** Klik w zablokowane tło: karta lekko drga, żeby było jasne, gdzie jest polecenie. */
  const nudge = () => {
    if (reducedMotion()) return
    cardRef.current?.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }],
      { duration: 320, easing: 'ease-out' },
    )
  }
  const body = phase === 'after' && key('after') in dictionary ? t(key('after')) : t(key('body'))

  return (
    <div className={`tour${visible ? '' : ' off'}${moving ? ' moving' : ''}`}>
      {blockers.map((style, n) => (
        <div key={n} className={`tour-block${dimAll ? ' full' : ''}`} style={style} aria-hidden="true" onPointerDown={nudge} />
      ))}
      {hole && (
        <div
          className={`tour-hole${step.inside ? ' wide' : ''}${phase === 'do' ? ' pulse' : ''}`}
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }}
          aria-hidden="true"
        />
      )}
      <section ref={cardRef} className={`tour-card${glide ? ' glide' : ''}`} aria-label={t('tour.aria')}
        style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}>
        <div className="tour-progress" aria-hidden="true">
          <span style={{ '--p': (i + 1) / total } as CSSProperties} />
        </div>
        <header className="tour-head">
          <span className="tour-count">{fill(t('tour.count'), { i: i + 1, n: total })}</span>
          <button type="button" className="tour-x" aria-label={t('tour.end')} title={t('tour.end')} onClick={stop}>×</button>
        </header>
        {away ? (
          <>
            <h2>{t('tour.away.title')}</h2>
            <p>{t('tour.away.body')}</p>
            <footer className="tour-foot">
              <span />
              <button type="button" className="tour-btn primary" onClick={() => { window.location.hash = '#/south-pole' }}>
                {t('tour.away.go')}
              </button>
            </footer>
          </>
        ) : (
          <>
            <h2>{t(key('title'))}</h2>
            <p aria-live="polite">{body}</p>
            {phase === 'do' && (
              <p className="tour-todo"><span className="tour-dot" aria-hidden="true" />{t(key('do'))}</p>
            )}
            <footer className="tour-foot">
              {canBack ? <button type="button" className="tour-btn" onClick={back}>{t('tour.back')}</button> : <span />}
              {phase === 'do' ? (
                <button type="button" className="tour-btn quiet" onClick={() => advanceFrom(i, total)}>{t('tour.skipStep')}</button>
              ) : (
                <button type="button" className="tour-btn primary" onClick={() => advanceFrom(i, total)}>
                  {t(last ? 'tour.finish' : 'tour.next')}
                </button>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  )
}

/** Samouczek: montowany raz w App, ponad trasami (przetrwa przejście z globusa na biegun). */
export function Tour() {
  const active = useTour((s) => s.active)
  // Klucz: ponowny start w trakcie samouczka zaczyna od świeżej warstwy (bez stanu poprzedniego kroku).
  const epoch = useTour((s) => s.epoch)
  return active ? <TourLayer key={epoch} /> : null
}
