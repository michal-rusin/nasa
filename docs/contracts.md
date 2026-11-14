# Kontrakt danych: silnik → frontend (v1)

**Projekt:** Lunar Landing Site Navigator (NASA Space Apps 2026)
**Dla:** programista silnika (Python) i jego asystent AI
**Właściciel frontu:** Michał

Ten dokument opisuje **dokładnie**, jakie pliki silnik ma wyprodukować, w jakim formacie i z jakimi konwencjami. Front to statyczna strona bez backendu: czyta tylko te pliki. Każda zmiana formatu = podbicie `contract_version` w `meta.json` i informacja dla frontu.

> **Dla asystenta AI:** traktuj sekcje „Konwencje” i „Formaty binarne” jako wymagania twarde. Nie zmieniaj nazw pól, kolejności, jednostek ani endianness. Jeśli coś jest niejasne albo niewykonalne, zapytaj człowieka zamiast zgadywać.

---

## 0. Co silnik ma wyprodukować (podsumowanie)

```
data/out/v1/
├── meta.json            # metadane, kolejność kolumn, definicje, granice rastrów
├── candidates.bin       # metryki dla każdego punktu siatki (float32 LE)
├── ephem.bin            # Słońce i Ziemia co godzinę w MOON_ME (float32 LE)
├── masks/
│   ├── index.json       # id punktu → kafelek + numer rekordu
│   └── tile_<i>_<j>.bin # maski horyzontu (int16 LE)
├── validation.json      # 3–5 punktów z pełnymi szeregami godzinowymi (do testów frontu)
├── sites.json           # (zespół danych) nazwane miejsca: Artemis, CLPS, Chang'e-7, Apollo
└── layers/              # (zespół danych) PNG-i rastrów
    ├── basemap.png
    ├── slope.png
    ├── illumination.png
    └── psr.png
```

---

## 1. Konwencje (najważniejsza sekcja)

Większość błędów integracji bierze się stąd, że dwie strony przyjęły inną konwencję i nikt tego nie zauważył. Wszystko poniżej obowiązuje silnik i front jednakowo.

### 1.1 Układ odniesienia
- Ramka ciała: **MOON_ME** (w niej Horizons podaje współrzędne na Księżycu, patrz 3.3). Wszystkie wektory w km, w MOON_ME, z początkiem w środku Księżyca.
- Księżyc jako **kula, R = 1737.4 km** (zapisać w `meta.json` jako `moon_radius_km`). Jeśli używasz innej wartości, zapisz ją tam. Front weźmie ją z meta.
- Szerokość `lat` w stopniach, ujemna na południu. Długość `lon` w stopniach, **wschodnia, zakres [-180, 180)**.

### 1.2 Lokalny układ ENU punktu
Dla punktu o `lat = φ`, `lon = λ` (sferyczne, „góra” = kierunek radialny):

```
U = ( cosφ·cosλ,  cosφ·sinλ,  sinφ )     # up
E = ( -sinλ,      cosλ,       0    )     # east
N = ( -sinφ·cosλ, -sinφ·sinλ, cosφ )     # north
```

Pozycja obserwatora: `P = (R + elev_km + observer_height_m/1000) · U` (wysokość obserwatora z meta, domyślnie 2 m: panele/antena). Ta sama wysokość obowiązuje przy liczeniu maski w silniku i przy paralaksie Ziemi we froncie.

Dla wektora kierunku `v` (od punktu do obiektu):
- **azymut** = `atan2(v·E, v·N)` w stopniach, sprowadzony do `[0, 360)`. **0° = lokalna północ, rośnie zgodnie z ruchem wskazówek zegara (przez wschód).**
- **elewacja** = `asin(v·U / |v|)` w stopniach.

> Dlaczego to ważne: przy biegunie lokalna „północ” obraca się razem z długością. Jeśli maska będzie liczona z azymutem np. od kierunku +Y rzutu, panorama we froncie będzie przesunięta o kąt ≈ długości punktu i nikt tego nie wychwyci wzrokowo.

### 1.3 Rzut rastrów i `x_m, y_m`
- `x_m, y_m` = współrzędne punktu w metrach w **tym samym rzucie co rastry** (stereograficzny biegunowy DEM LOLA / LROC).
- Licz je biblioteką z CRS-u wziętego z pliku DEM, nie własnym wzorem:

```python
import rasterio
from pyproj import CRS, Transformer

with rasterio.open(DEM_PATH) as ds:
    dem_crs = CRS.from_user_input(ds.crs)

geo = dem_crs.geodetic_crs  # geograficzny CRS Księżyca zgodny z DEM
tr = Transformer.from_crs(geo, dem_crs, always_xy=True)
x_m, y_m = tr.transform(lon_deg, lat_deg)
```

- Zapisz CRS (WKT) w `meta.json` (`raster_crs_wkt`).
- **Test:** punkt na środku krateru Shackleton (~89.67°S, ~129.8°E) musi wypaść na kraterze na `basemap.png`.

### 1.4 Czas
- Okres symulacji: **1 rok, krok 1 h**. Dla 2028 to **8784 kroki** (rok przestępny, 366 dni). Start, krok i liczba kroków zapisane w meta (`t0_utc`, `step_s`, `n_steps`); **liczbę kroków zawsze czytaj z `n_steps`, nie wpisuj na sztywno**.
- Horizons podaje efemerydy dla dowolnych dat, więc rok wybieramy pod narrację, nie pod źródło danych. Rozsądnie jest wziąć okno, w którym realnie planowane są lądowania przy biegunie (najbliższe lata). Ustalono: 2028 (sekcja 9).
- Rok to minimum, żeby objąć zmiany pór (nachylenie osi Księżyca ~1.5°). Dłuższy okres jest lepszy, ale liniowo zwiększa czas liczenia.
- Krok `k` odpowiada czasowi `t0_utc + k·step_s`.

---

## 2. Definicje metryk

Jedna definicja dla wszystkich. Front będzie z nich liczył oś czasu, a potem porównywał wyniki z silnikiem.

### 2.1 Ułamek tarczy Słońca `f` w kroku czasowym
- `e` = elewacja środka Słońca, `h` = wysokość maski horyzontu przy azymucie Słońca (**interpolacja liniowa** między próbkami co 0.5°), `r` = promień kątowy Słońca (stała **0.2666°**, zapisana w meta jako `sun_radius_deg`).
- `d = (e − h) / r`
- `f = 0` dla `d ≤ −1`, `f = 1` dla `d ≥ 1`, w przeciwnym razie:

```
f = ( acos(−d) + d·sqrt(1 − d²) ) / π
```

(Ułamek pola tarczy nad poziomą linią horyzontu. Upraszczamy horyzont do linii prostej na szerokości tarczy.)

Kierunek do Słońca bierz jako wektor ze środka Księżyca (`sun_dir` z `ephem.bin`). Paralaksa Słońca jest pomijalna (<0.001°).

### 2.2 Widoczność Ziemi `g` w kroku czasowym
- Wektor do Ziemi liczony **z pozycji punktu**: `v = Earth_pos − P` (paralaksa Ziemi to do ~0.26°, więc nie wolno jej pominąć).
- `g = 1`, jeśli elewacja **środka** Ziemi > maska przy jej azymucie, inaczej `g = 0`.

### 2.3 Metryki w `candidates.bin`
| Pole | Jednostka | Definicja |
|---|---|---|
| `sun_pct` | % | `100 · mean(f)` po wszystkich krokach |
| `longest_night_h` | h | najdłuższy ciąg kolejnych kroków z `f < night_threshold` (domyślnie **0.01**, w meta) × krok w godzinach |
| `earth_pct` | % | `100 · mean(g)` |
| `longest_comm_gap_h` | h | najdłuższy ciąg kolejnych kroków z `g = 0` × krok w godzinach |
| `slope_deg` | ° | nachylenie terenu, próbkowane z `LDSM_80S_20MPP_ADJ.TIF` (sekcja 5.1) |
| `dist_psr_km` | km | odległość do najbliższego piksela PSR (obszar wiecznego cienia), próbkowana z rastra odległości od zespołu danych. W meta zapisz źródło mapy PSR |
| `elev_m` | m | wysokość z DEM względem `moon_radius_km` |

Przy ciągach na granicy okresu (np. noc na początku i na końcu roku) **nie** sklejaj ich, liczymy okres jako odcinek, nie pętlę.

---

## 3. Formaty binarne

Wszystko **little-endian**, bez nagłówków. Rozmiary i kolejność opisuje `meta.json`.

### 3.1 `candidates.bin`
- `float32`, układ wierszowy: `N` wierszy × `C` kolumn.
- Kolejność kolumn = `meta.json → candidates.columns`. Domyślna:

```
id, lat, lon, x_m, y_m, elev_m, level,
sun_pct, longest_night_h, earth_pct, longest_comm_gap_h,
slope_deg, dist_psr_km
```

- `id`: liczba całkowita zapisana jako float32 (dokładna do 16 777 216, wystarczy). Unikalny i stały między wersjami danych, jeśli siatka się nie zmienia.
- `level`: `0` = siatka 2 km, `1` = zagęszczenie 250 m.
- Brak wartości → `NaN` (nie `-9999`).

```python
import numpy as np
arr = np.stack([df[c].to_numpy(np.float32) for c in COLUMNS], axis=1)
arr.astype('<f4').tofile('data/out/v1/candidates.bin')
```

### 3.2 Maski horyzontu: `masks/`
- Na punkt: **720 × int16**, setne części stopnia (np. `523` = 5.23°), azymut `k · 0.5°` dla `k = 0..719`, konwencja z 1.2.
- Wartości **mogą być ujemne** (horyzont poniżej lokalnej poziomej, typowo na grzbietach i szczytach, gdzie teren opada we wszystkie strony). To int16 ze znakiem i front nie może zakładać, że maska jest ≥ 0.
- Maska zawiera już poprawkę na krzywiznę (promień przeszukiwania ok. 150 km).
- Maska liczona z wysokości `observer_height_m` nad gruntem. Promienie zaczynają się `mask_min_dist_m` od punktu, żeby szum DEM tuż obok punktu nie zasłaniał horyzontu.
- Kafelki: siatka **8×8** po `x_m, y_m` w granicach obszaru kandydatów. Plik `tile_<i>_<j>.bin` = rekordy punktów z tego kafelka sklejone jeden po drugim (1440 B na punkt).
- `masks/index.json`:

```json
{
  "samples": 720,
  "step_deg": 0.5,
  "scale": 0.01,
  "dtype": "int16",
  "records": { "12345": ["tile_3_4.bin", 17], "...": ["...", 0] }
}
```

`["tile_3_4.bin", 17]` → maska zaczyna się w tym pliku od bajtu `17 · 1440`.

### 3.3 `ephem.bin`
- `float32`, `n_steps` wierszy × 6 kolumn:

```
sun_dir_x, sun_dir_y, sun_dir_z,      # wektor jednostkowy ze środka Księżyca do Słońca, MOON_ME
earth_x,   earth_y,   earth_z         # położenie środka Ziemi w km, MOON_ME
```

- Dzięki temu front policzy oś czasu dla **dowolnego** punktu z jego maski, bez gigantycznych szeregów dla 18 tys. punktów (~210 KB zamiast setek MB).

#### Źródło: JPL Horizons API (pobierane **offline przez silnik**, nie przez przeglądarkę)
Horizons dla Księżyca podaje współrzędne kartograficzne w **MOON_ME, długość wschodnia dodatnia** (w nagłówku odpowiedzi linia `Target pole/equ : MOON_ME {East-longitude positive}`, sprawdź ją). To ta sama ramka, co reszta kontraktu.

Wystarczy **jedno zapytanie typu OBSERVER na cały okres**:
- `COMMAND='301'` (cel: Księżyc), `CENTER='500@399'` (obserwator: środek Ziemi),
- `EPHEM_TYPE='OBSERVER'`, `STEP_SIZE='1 h'`, `START_TIME`/`STOP_TIME` = okres z meta,
- `QUANTITIES='14,15,20'`, `CSV_FORMAT='YES'`, `ANG_FORMAT='DEG'`:
  - **14** – punkt sub-obserwatora (= sub-Ziemi) na Księżycu: `lon_E, lat_E`,
  - **15** – punkt podsłoneczny na Księżycu: `lon_S, lat_S`,
  - **20** – odległość obserwator–cel `delta` (au → km: × 149 597 870.7).

Przeliczenie (sferycznie, `u(lat, lon) = (cos lat·cos lon, cos lat·sin lon, sin lat)`):

```
sun_dir   = u(lat_S, lon_S)
earth_pos = delta_km · u(lat_E, lon_E)
```

Uwagi:
- Sprawdź w nagłówku, czy długości są wschodnie, i czy rozumiesz, której poprawki aberracji użył Horizons (zapisz w meta jako `ephem_source` i `abcorr`). Różnice rzędu ułamków minuty kątowej są dla nas nieistotne.
- Jeśli rok w kroku 1 h przekroczy limit linii odpowiedzi, podziel okres na kilka zapytań i sklej.
- **Nie** odpytujemy Horizons z przeglądarki w trakcie demo: zależność od zewnętrznego serwera i sieci na prezentacji to niepotrzebne ryzyko, a nie sprawdzaliśmy, czy API pozwala na zapytania z innej domeny (CORS). Silnik pobiera raz, zapisuje `ephem.bin`, front czyta plik.
- Surową odpowiedź Horizons zapisz w repo (`data/raw/horizons_<okres>.csv`), żeby dało się odtworzyć `ephem.bin` bez sieci.

---

## 4. `meta.json`

```json
{
  "contract_version": 1,
  "generated_utc": "2026-11-14T18:00:00Z",
  "moon_radius_km": 1737.4,
  "frame": "MOON_ME",
  "ephem_source": "JPL Horizons API, COMMAND=301, CENTER=500@399, QUANTITIES=14,15,20",
  "abcorr": "jak w nagłówku Horizons",

  "t0_utc": "2028-01-01T00:00:00Z",
  "step_s": 3600,
  "n_steps": 8784,

  "sun_radius_deg": 0.2666,
  "night_threshold": 0.01,
  "observer_height_m": 2.0,
  "mask_min_dist_m": 120,
  "slope_basis": "LDSM_80S_20MPP_ADJ",
  "dem_near": "LDEM_80S_80MPP_ADJ",
  "dem_far": "LDEM_60S_240MPP_ADJ",
  "psr_source": "...",

  "region": { "lat_min": -90, "lat_max": -85 },
  "candidates": {
    "count": 18000,
    "columns": ["id","lat","lon","x_m","y_m","elev_m","level",
                "sun_pct","longest_night_h","earth_pct","longest_comm_gap_h",
                "slope_deg","dist_psr_km"]
  },

  "raster_crs_wkt": "PROJCS[...]",
  "layers": {
    "bounds_m": { "min_x": 0, "min_y": 0, "max_x": 0, "max_y": 0 },
    "files": {
      "basemap": "layers/basemap.png",
      "slope": "layers/slope.png",
      "illumination": "layers/illumination.png",
      "psr": "layers/psr.png"
    }
  }
}
```

Wartości przykładowe, a `abcorr` i `ephem_source` uzupełnij tym, co realnie zwrócił Horizons.

---

## 5. Zespół danych: rastry, PSR i nazwane miejsca

Rola zespołu danych: wszystko, co nie jest geometrią horyzontu ani symulacją. Silnik dostaje od nich gotowe rastry i tylko próbkuje je w punktach siatki.

### 5.1 Źródła (PGDA product 90, Barker et al. 2023)
- **DEM do masek:** `LDEM_80S_80MPP_ADJ.TIF` (80 m/px, 80–90°S).
- **DEM dalekiego pola:** `LDEM_60S_240MPP_ADJ.TIF` (240 m/px, 60–90°S). Potrzebny, bo siatka sięga 85°S, a promień 150 km kończy się przy ~80°S, czyli dokładnie na krawędzi pliku 80 m. Promienie, które wychodzą poza plik 80 m, dalej próbkują plik 240 m. Dla odległego terenu taka rozdzielczość wystarcza.
- **Nachylenie:** `LDSM_80S_20MPP_ADJ.TIF`, gotowa mapa nachylenia w stopniach. Nie liczymy nachylenia sami, tylko próbkujemy ten plik. W meta: `slope_basis = "LDSM_80S_20MPP_ADJ"`.
- **PSR:** do potwierdzenia, które pliki PGDA dają mapę PSR. Z niej zespół danych robi **raster odległości do PSR** (`gdal_proximity.py`), a silnik go próbkuje → `dist_psr_km`.
- **Referencja do walidacji:** PGDA product 69 (Lunar Polar Illumination) ma mapy średniego oświetlenia i widoczności Ziemi dla bieguna południowego. Są uśrednione po 18,6 roku, więc liczby nie zgodzą się z naszym rokiem 1:1, ale **rozkład przestrzenny** (gdzie jasno, gdzie ciemno) musi się zgadzać. Dobra kontrola silnika i gotowa warstwa `illumination.png`.

### 5.2 Rastry (`layers/`)

- PNG, **wszystkie dokładnie z tymi samymi granicami** (`layers.bounds_m`) i w tym samym rzucie. Front nakłada je jeden na drugi bez przeliczania.
- Warstwy tematyczne z kanałem alfa (przezroczyste tam, gdzie brak danych).
- Rozmiar rozsądny dla przeglądarki: do ~4096 px na bok.
- Przydatne: `gdalwarp -te <bounds>` (wspólne granice), `gdaldem color-relief`, `gdal_proximity.py`, `gdal_translate -of PNG`.

### 5.3 `sites.json`: nazwane miejsca

Siatka to ~18 tys. anonimowych punktów. Jury będzie szukać konkretnych, znanych miejsc, więc zespół danych przygotowuje krótką listę ręcznie:

```json
[
  {
    "id": "artemis-connecting-ridge",
    "name": "Connecting Ridge",
    "category": "artemis",
    "lat": -89.4,
    "lon": -137.0,
    "x_m": 1234.5,
    "y_m": -5678.9,
    "note": "Krótki opis i źródło",
    "nearest_candidate_id": 12345,
    "nearest_candidate_dist_km": 0.8
  }
]
```

- `category`: `artemis` (regiony kandydackie Artemis), `clps` (np. IM-2), `international` (np. Chang'e-7), `apollo` (kontekst historyczny), `reference` (punkty kontrolne, np. Malapert).
- Wartości `lat/lon` w przykładzie są poglądowe. **Każde miejsce z podanym źródłem**, nie z pamięci.
- `nearest_candidate_id` i `nearest_candidate_dist_km` liczy silnik po wygenerowaniu siatki. Miejsca poza obszarem siatki (np. Apollo) mają oba pola `null`.
- `x_m`, `y_m`: położenie miejsca w metrach w rzucie rastrów, liczone tak samo jak dla kandydatów (pyproj z CRS pliku DEM, sekcja 1.3). Front stawia marker po tych polach, bo nie zna rzutu i nie przelicza `lat/lon`. Miejsca poza granicami rastrów (`layers.bounds_m`), np. Apollo, mają oba pola `null`; front nie rysuje ich na mapie, tylko pokazuje na liście.
- Front pokazuje je jako osobną warstwę z etykietami. Po kliknięciu otwiera się panel najbliższego punktu siatki z dopiskiem o odległości.

---

## 6. Walidacja (`validation.json`)

Dla 3–5 punktów (różne typy: dobrze oświetlony grzbiet, dno krateru w PSR, punkt pośredni) pełne szeregi godzinowe:

```json
[
  {
    "id": 12345,
    "sun_f": [0.0, 0.12, 1.0, "..."],
    "earth_g": [1, 1, 0, "..."],
    "sun_pct": 71.3,
    "earth_pct": 48.0
  }
]
```

Front policzy to samo z maski i `ephem.bin` i sprawdzi zgodność (cel: różnica `sun_pct` ≤ 1 pkt proc.). To jedyne zabezpieczenie przed tym, że logika widoczności w Pythonie i w JS rozjedzie się po cichu.

Kontrola zdrowego rozsądku po stronie silnika:
- punkty na dnie Shackletona: `sun_pct ≈ 0`,
- najlepiej oświetlone punkty powinny leżeć na grzbietach i krawędziach kraterów (np. okolice krawędzi Shackletona), nie na płaskim terenie.

---

## 7. Wydajność silnika (ważne przy ~23 h)

Maski to ~18 tys. punktów × 720 azymutów × promień 150 km. W czystym NumPy w pętli to się nie skończy na czas.

- **Numba** (`@njit(parallel=True)`, `prange` po punktach) na pętlę promieni.
- **Krok próbkowania rośnie z odległością:** np. 80 m do 5 km, 200 m do 30 km, 500 m dalej. Daleki teren zajmuje mały kąt, więc gęste próbkowanie tam nic nie daje.
- Najpierw zmierz czas dla 100 punktów i dopiero wtedy przelicz, ile zajmie pełna siatka.
- Plan awaryjny: najpierw 87–90°S, potem rozszerzenie do 85°S.
- **Zagęszczenie 250 m (`level = 1`) jest opcjonalne.** Robimy je tylko wtedy, gdy pełna siatka 2 km jest gotowa i zwalidowana.

## 8. Kolejność dostaw

1. **Teraz:** potwierdzenie konwencji (sekcja 1) i formatów (sekcja 3). Front robi na tym dane testowe w identycznym formacie.
2. **Jak najszybciej:** ~100 prawdziwych punktów, wszystkie pliki, nawet z uproszczonym algorytmem. Cel: test całej ścieżki, nie dokładność.
3. **Potem:** pełna siatka 2 km + `ephem.bin` + `validation.json`.
4. **Opcjonalnie, na końcu:** zagęszczenie 250 m (`level = 1`), tym samym formatem.

Każdą dostawę wrzucaj jako nowy katalog wersji albo podbijaj `generated_utc`, żeby front wiedział, że dane się zmieniły.

---

## 9. Decyzje i otwarte pytania

Ustalone:
- [x] **Rok: 2028**, 1 rok, krok 1 h. NASA celuje w pierwsze załogowe lądowanie Artemis (Artemis IV) właśnie w 2028.
- [x] **DEM do masek:** `LDEM_80S_80MPP_ADJ.TIF` + daleko pole z `LDEM_60S_240MPP_ADJ.TIF`.
- [x] **Nachylenie:** `LDSM_80S_20MPP_ADJ.TIF` (gotowa mapa nachylenia, PGDA product 90).
- [x] **`night_threshold = 0.01`.**
- [x] **Konwencje (sekcja 1) i formaty binarne (sekcja 3) potwierdzone przez silnik.**
- [x] **`observer_height_m = 2.0`, `mask_min_dist_m = 120`** (dopisane przez silnik, formaty binarne bez zmian).

Do potwierdzenia:
- [ ] Nagłówek pierwszej prawdziwej odpowiedzi Horizons: `MOON_ME`, długość wschodnia, użyta poprawka aberracji.
- [ ] Źródło mapy PSR (pliki z product 90 albo inny produkt PGDA).
- [ ] Lista miejsc do `sites.json` ze źródłami.
