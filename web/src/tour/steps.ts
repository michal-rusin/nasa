// Kroki samouczka. Każdy wskazuje element przez atrybut data-tour i (opcjonalnie) warunek zaliczenia
// liczony ze stanu aplikacji: użytkownik wykonuje prawdziwą akcję, a krok sam się zamyka.
// Teksty: klucze `tour.<id>.title`, `tour.<id>.body`, opcjonalnie `tour.<id>.after` w i18n.ts.
//
// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import { useAnalysis } from '../panel/analysis'
import { useStore, type ColorKey } from '../store'
import { useTour } from './store'

export type TourRoute = 'home' | 'south-pole'

/** Stan zapamiętany przy wejściu do kroku; warunki porównują z nim stan bieżący. */
export interface Snapshot {
  colorBy: ColorKey
  signals: Record<string, number>
}

export interface TourStep {
  id: string
  route: TourRoute
  /** Wartość atrybutu data-tour podświetlanego elementu. */
  target: string
  /** Brak = krok informacyjny z przyciskiem „Next”. */
  done?: (base: Snapshot) => boolean
  /** Po zaliczeniu krok zostaje z tekstem `after` i przyciskiem „Next” (np. żeby obejrzeć animację). */
  after?: boolean
  /** Doprowadza aplikację do stanu, w którym cel istnieje. */
  ensure?: () => void
  /** Kartę chowamy, gdy aplikacja sama coś animuje (przelot nad biegun). */
  hideWhen?: (base: Snapshot) => boolean
  /** Duży cel (globus, mapa): karta w jego dolnej części zamiast obok. */
  inside?: boolean
  /** Karta dosunięta do prawej krawędzi celu (nie zasłania środka panoramy nad paskiem czasu). */
  end?: boolean
}

export function currentRoute(): TourRoute {
  return window.location.hash === '#/south-pole' ? 'south-pole' : 'home'
}

export function snapshot(): Snapshot {
  return { colorBy: useStore.getState().colorBy, signals: { ...useTour.getState().signals } }
}

const sig = (name: string): number => useTour.getState().signals[name] ?? 0
const fired = (name: string, base: Snapshot): boolean => sig(name) > (base.signals[name] ?? 0)
const showRanking = (): void => useStore.getState().setRankingShown(true)
/** Kroki o boxie miejsca: gdy użytkownik pominął wybór, otwieramy najlepsze miejsce z rankingu. */
const ensurePlace = (): void => {
  const s = useStore.getState()
  const best = s.top[0]
  if (s.selectedIndex === null && best) s.focusIndex(best.index)
}

export const STEPS: readonly TourStep[] = [
  {
    id: 'rotate', route: 'home', target: 'globe', inside: true,
    done: (b) => fired('globe', b) || currentRoute() === 'south-pole',
  },
  {
    id: 'pole', route: 'home', target: 'cta',
    done: () => currentRoute() === 'south-pole',
    hideWhen: (b) => fired('explore', b),
  },
  {
    id: 'rank', route: 'south-pole', target: 'rank-cta',
    done: () => useStore.getState().rankingShown,
  },
  { id: 'legend', route: 'south-pole', target: 'legend', ensure: showRanking },
  {
    id: 'modes', route: 'south-pole', target: 'modes', ensure: showRanking,
    done: (b) => useStore.getState().colorBy !== b.colorBy,
  },
  {
    id: 'top', route: 'south-pole', target: 'top', ensure: showRanking,
    done: () => useStore.getState().selectedIndex !== null,
  },
  { id: 'sky', route: 'south-pole', target: 'sky', ensure: ensurePlace, done: (b) => fired('sky', b) },
  {
    id: 'play', route: 'south-pole', target: 'time', after: true, end: true, ensure: ensurePlace,
    done: () => useAnalysis.getState().playing,
  },
  { id: 'numbers', route: 'south-pole', target: 'numbers', ensure: ensurePlace },
  {
    id: 'compare', route: 'south-pole', target: 'compare', ensure: ensurePlace,
    done: () => useStore.getState().picking || useStore.getState().compareIndex !== null,
  },
  {
    id: 'pick', route: 'south-pole', target: 'map', inside: true,
    ensure: () => {
      ensurePlace()
      const s = useStore.getState()
      if (!s.picking && s.compareIndex === null) s.startCompare()
    },
    done: () => useStore.getState().compareIndex !== null,
  },
  {
    id: 'versus', route: 'south-pole', target: 'places', inside: true,
    ensure: () => {
      ensurePlace()
      const s = useStore.getState()
      if (s.compareIndex !== null) return
      // Krok pominięty bez wyboru: drugie miejsce bierzemy z rankingu (pierwsze inne niż A).
      const other = s.top.find((p) => p.index !== s.selectedIndex)
      if (!other) return
      s.startCompare()
      s.pickPoint(other.index)
    },
  },
  { id: 'finish', route: 'south-pole', target: 'help' },
]

/**
 * Stan początkowy aplikacji: bez wybranych miejsc i rankingu, domyślne wagi, filtry, warstwy
 * i wersja rankingu, pierwszy rok, czas zatrzymany na początku roku. Stan widoku bieguna żyje
 * w store także po wyjściu na globus, więc bez tego samouczek zastawał „już zrobione” kroki.
 */
function resetApp(): void {
  const s = useStore.getState()
  s.setSelectedIndex(null)
  s.setHoverIndex(null)
  s.setRankingShown(false)
  s.resetAdvanced()
  const firstYear = s.byYear?.years[0]
  if (firstYear !== undefined) s.setYear(firstYear)
  const a = useAnalysis.getState()
  a.setPlaying(false)
  a.setCursor(0) // setCursor przycina do wybranego roku, czyli do jego pierwszego kroku
}

/**
 * Start samouczka: zawsze od zera. Czyści stan aplikacji, wraca na globus i zaczyna od kroku 1;
 * `start` podbija `epoch`, przez co App montuje widok od nowa (zamknięta szuflada, przewinięcie
 * na górę, kamera globusa w pozycji startowej).
 */
export function startTour(): void {
  resetApp()
  if (currentRoute() !== 'home') window.location.hash = '#/'
  useTour.getState().start(0)
}
