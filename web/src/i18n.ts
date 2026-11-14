import { useCallback } from 'react'
import { useStore } from './store'

export type Lang = 'en' | 'pl'
export const LANGS: readonly Lang[] = ['en', 'pl']

const en: Record<string, string> = {
  'app.name': 'Lunar Navigator',
  'nav.home': 'Back to the globe',
  'lang.switch': 'Language',
  'home.title': 'The Moon',
  'home.hint': 'Drag to rotate, scroll to zoom',
  'home.cta': 'Explore the South Pole',
  'home.southPole': 'Lunar South Pole – Artemis region',
  'home.textureError': 'The Moon texture could not be loaded. Showing a plain sphere.',
  'home.webglError': 'Your browser could not start WebGL, so the 3D globe is unavailable.',
  'home.loading': 'Loading…',
  'card.close': 'Close',
  'card.landed': 'Landed',
  'site.apollo11.desc': 'First crewed landing. Mare Tranquillitatis, July 1969.',
  'site.apollo12.desc': 'Pinpoint landing in Oceanus Procellarum, next to the Surveyor 3 probe.',
  'site.apollo14.desc': 'Fra Mauro highlands, sampling ejecta from the Imbrium impact.',
  'site.apollo15.desc': 'Hadley Rille at the foot of the Apennines. First mission with the lunar rover.',
  'site.apollo16.desc': 'Descartes Highlands, the only landing in the central lunar highlands.',
  'site.apollo17.desc': 'Taurus–Littrow valley. The last crewed landing so far.',
}

const pl: Record<string, string> = {
  'app.name': 'Lunar Navigator',
  'nav.home': 'Wróć do globusa',
  'lang.switch': 'Język',
  'home.title': 'Księżyc',
  'home.hint': 'Przeciągnij, aby obrócić. Przewiń, aby przybliżyć',
  'home.cta': 'Poznaj biegun południowy',
  'home.southPole': 'Biegun południowy Księżyca – region Artemis',
  'home.textureError': 'Nie udało się wczytać tekstury Księżyca. Pokazujemy gładką kulę.',
  'home.webglError': 'Przeglądarka nie uruchomiła WebGL, więc globus 3D jest niedostępny.',
  'home.loading': 'Wczytywanie…',
  'card.close': 'Zamknij',
  'card.landed': 'Lądowanie',
  'site.apollo11.desc': 'Pierwsze załogowe lądowanie. Mare Tranquillitatis, lipiec 1969.',
  'site.apollo12.desc': 'Precyzyjne lądowanie na Oceanus Procellarum, tuż obok sondy Surveyor 3.',
  'site.apollo14.desc': 'Wyżyna Fra Mauro, próbki materiału wyrzuconego przy powstaniu Mare Imbrium.',
  'site.apollo15.desc': 'Rima Hadley u stóp Apeninów. Pierwsza misja z łazikiem księżycowym.',
  'site.apollo16.desc': 'Wyżyna Descartes, jedyne lądowanie na centralnych wyżynach Księżyca.',
  'site.apollo17.desc': 'Dolina Taurus–Littrow. Ostatnie jak dotąd załogowe lądowanie.',
}

export const dictionary: Record<Lang, Record<string, string>> = { en, pl }

/** Tłumaczenie dla podanego języka; brak w języku -> angielski -> sam klucz. */
export function translate(lang: Lang, key: string): string {
  return dictionary[lang][key] ?? dictionary.en[key] ?? key
}

/** Tłumaczenie w bieżącym języku ze store. Poza renderem Reacta; w komponentach użyj `useT`. */
export function t(key: string): string {
  return translate(useStore.getState().lang, key)
}

/** Hook: zwraca `t`, a komponent przerysuje się po zmianie języka. */
export function useT(): (key: string) => string {
  const lang = useStore((s) => s.lang)
  return useCallback((key: string) => translate(lang, key), [lang])
}
