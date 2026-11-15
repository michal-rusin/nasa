// Stan samouczka: który krok, w którą stronę weszliśmy i sygnały z widoków (np. „globus obrócony”).
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { create } from 'zustand'

const SEEN_KEY = 'ln.tour.seen'

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch { /* tryb prywatny: zaproszenie pokaże się ponownie, nic więcej */ }
}

interface TourState {
  active: boolean
  /** Indeks kroku w STEPS. */
  i: number
  /** 1 = weszliśmy do kroku do przodu, -1 = przyciskiem „Back”. */
  dir: 1 | -1
  /** Liczniki zdarzeń zgłaszanych przez widoki; krok porównuje je ze stanem z wejścia. */
  signals: Record<string, number>
  /** Rośnie przy każdym starcie: App używa go jako klucza widoku, więc start montuje widok od nowa. */
  epoch: number
  /** Samouczek ukończony albo pominięty (zaproszenie na globusie już się nie pokazuje). */
  seen: boolean
  start: (i: number) => void
  /** Przejście dalej tylko z podanego kroku (chroni przed podwójnym wywołaniem). */
  advanceFrom: (from: number, total: number) => void
  back: () => void
  stop: () => void
  signal: (name: string) => void
}

export const useTour = create<TourState>()((set, get) => ({
  active: false,
  i: 0,
  dir: 1,
  signals: {},
  epoch: 0,
  seen: readSeen(),
  start: (i) => set((s) => ({ active: true, i, dir: 1, signals: {}, epoch: s.epoch + 1 })),
  advanceFrom: (from, total) => {
    const s = get()
    if (!s.active || s.i !== from) return
    if (from + 1 >= total) s.stop()
    else set({ i: from + 1, dir: 1 })
  },
  back: () => set((s) => (s.i > 0 ? { i: s.i - 1, dir: -1 } : {})),
  stop: () => {
    writeSeen()
    set({ active: false, seen: true })
  },
  signal: (name) => {
    const s = get()
    if (!s.active) return
    set({ signals: { ...s.signals, [name]: (s.signals[name] ?? 0) + 1 } })
  },
}))

/** Zgłoszenie zdarzenia z widoku; poza samouczkiem nic nie robi. */
export function tourSignal(name: string): void {
  useTour.getState().signal(name)
}
