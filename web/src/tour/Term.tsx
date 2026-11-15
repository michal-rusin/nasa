// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { dictionary } from '../i18n'
import './tour.css'

const POP_W = 280
const EDGE = 12

/**
 * Termin ze słowniczka: kropkowane podkreślenie i dymek z jednym zdaniem wyjaśnienia
 * (klucz `gloss.<k>` w i18n.ts). Bez wpisu w słowniczku renderuje sam tekst.
 * Dymek idzie portalem do body: szklane panele (backdrop-filter) przycinałyby position: fixed.
 */
export function Term({ k, children }: { k: string; children: ReactNode }) {
  const text = dictionary[`gloss.${k}`]
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null)

  const open = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.min(Math.max(EDGE, r.left), Math.max(EDGE, window.innerWidth - POP_W - EDGE))
    // Mało miejsca pod spodem: dymek nad terminem.
    const up = r.bottom + 140 > window.innerHeight
    setPos({ left, top: up ? r.top - 8 : r.bottom + 8, up })
  }, [])
  const close = useCallback(() => setPos(null), [])

  // Otwarty dymek znika przy przewijaniu (jego pozycja jest liczona raz).
  useEffect(() => {
    if (!pos) return
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [pos, close])

  if (text === undefined) return <>{children}</>
  return (
    <>
      <span ref={ref} className="term" tabIndex={0} aria-describedby={pos ? id : undefined}
        onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}
        onClick={() => (pos ? close() : open())}
        onKeyDown={(e) => { if (e.key === 'Escape' && pos) { e.stopPropagation(); close() } }}>
        {children}
      </span>
      {pos && createPortal(
        <span id={id} role="tooltip" className={`term-pop${pos.up ? ' up' : ''}`}
          style={{ left: pos.left, top: pos.top, width: POP_W }}>{text}</span>,
        document.body,
      )}
    </>
  )
}
