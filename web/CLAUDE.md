# Front (web/)

Kontrakt danych: `docs/contracts.md`. Dane testowe w `web/public/data/` generuje `scripts/mock-data.py` (opis: `scripts/MOCK-DATA.md`). Nie edytuj ich ręcznie i nie uzależniaj kodu od konkretnych wartości ani liczby punktów.

## Zasady
- Mapa: OpenLayers. CRS rastrów rejestrujemy w proj4 z `meta.raster_proj4`. Dane (x_m, y_m) są już w metrach tego CRS i NIE przeliczamy ich z lat/lon. Punkty rysujemy własną warstwą canvas, hit-test na własnym indeksie.
- Kolejność kolumn `candidates.bin` wyłącznie z `meta.candidates.columns`; żadnych stałych indeksów kolumn. `id` ≠ indeks wiersza (mapa `idToIndex` w store).
- Binaria czytamy przez `DataView` z jawnym little-endian.
- TS strict + `noUncheckedIndexedAccess`, bez `any`. Czyste funkcje (kolory, najbliższy punkt, parsowanie) mają testy vitest.

## Mapa kodu
- `src/data/` – typy kontraktu i loader (`load.ts`: `loadMeta`, `loadCandidates`, `loadSites`, `getProjString`).
- `src/store.ts` – stan aplikacji (zustand).
- `src/map/` – `createMap.ts` (OL, CRS, okrąg 84°S, warstwy, hover/klik), `PointsLayer.ts` (canvas, kubełki kolorów czerwony→zielony; odfiltrowane punkty nie są rysowane), `projection.ts` (lat/lon → metry CRS na kuli), `sitesLayer.ts`, `colors.ts`, `nearestPoint.ts`.
- `src/views/SouthPole.tsx` – widok bieguna to strona z przewijaniem: pierwszy ekran to mapa z nakładkami (`app/SearchBox`, `app/TopCard`, `app/Legend`) i szuflada `app/AdvancedDrawer`; pod mapą `panel/Places` z szklanymi boxami miejsc. Style w `views/south-pole.css`, tokeny w `index.css`.
- Miejsca A/B: `store.selectedIndex` (A), `compareIndex` (B), `picking` (czekamy na wybór B po „Porównaj miejsce”). Punkt z mapy/rankingu/wyszukiwarki idzie przez `pickPoint`/`focusIndex`, które wybierają A albo B. Współrzędne zamiast id: `app/coords.ts`.
- `src/panel/` – `PlaceBox` (box miejsca), `SkyPanorama` + `skyDraw.ts` (canvas), `sky.ts` (czysta geometria nieba: Słońce, Ziemia z fazą i rozmiarem, gwiazdy; testy), `analysis.ts` (maska i szeregi dla A i B, wspólny kursor czasu i wspólny widok), `stars.ts` (katalog `public/assets/stars.json`, Hipparcos do 6 mag).
- Panorama: orientacja gwiazd jest przybliżona (obrót wokół osi Z dopasowany do Słońca z efemeryd, błąd ok. 1–2°, bo oś Księżyca ≈ biegun ekliptyki). Brak Drogi Mlecznej i tekstury terenu (sylwetka z maski 720 binów).
- Start widoku bieguna: sama rzeźba terenu. Kolory rankingu (od czerwonego = słabo do zielonego = najlepiej, `map/colors.ts`) i Top 10 pojawiają się dopiero po „Pokaż ranking” (`store.rankingShown`, animacja w `PointsLayer.setRevealed`). Nazwane miejsca są domyślnie ukryte (przełącznik na mapie, `layers.sites`).
- Mapa (`createMap.ts`): przy pełnym oddaleniu nie da się jej przesuwać (`constrainOnlyCenter: false` + wyłączony DragPan), a kółko w dół przewija stronę. Wybór punktu płynnie przewija do boxów pod mapą.
- Punkty kandydatów (`map/PointsLayer.ts`): poziom 0 (siatka 2 km) jako gładkie pole (`map/grid.ts`), poziom 1 (zagęszczenie 250 m) jako drobne kwadraty na wierzchu; Top 10 jako plakietki z numerem.
- Teksty UI przez `t()`/`fill()` z `src/i18n.ts`. Napisy na osi czasu (miesiące, Słońce/Ziemia) też idą przez język interfejsu.
- Wpisy sites.json z „[MOCK]” w nazwie są ukrywane (`app/sites.ts`).
