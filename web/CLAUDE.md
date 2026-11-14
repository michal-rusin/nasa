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
- `src/map/` – `createMap.ts` (OL, CRS, warstwy, klik), `PointsLayer.ts` (canvas, kubełki kolorów), `sitesLayer.ts`, `colors.ts`, `nearestPoint.ts`.
- `src/app/Sidebar.tsx` – sidebar (legenda, warstwy, debug punktu, lista miejsc).
