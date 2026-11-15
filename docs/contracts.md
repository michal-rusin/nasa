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
├── ephem.bin            # Słońce i Ziemia co godzinę w MOON_ME, lata 2028–2037 (float32 LE)
├── metrics_by_year.bin  # metryki każdego punktu osobno dla każdego roku 2028–2037 (float32 LE)
├── masks/
│   ├── index.json       # id punktu → kafelek + numer rekordu
│   └── tile_<i>_<j>.bin # maski horyzontu (int16 LE)
├── validation.json      # 3–5 punktów z pełnymi szeregami godzinowymi (do testów frontu)
├── sites.json           # (zespół danych) nazwane miejsca: Artemis, CLPS, Chang'e-7, Apollo
└── layers/              # (zespół danych) PNG-i rastrów, 4096×4096, bounds ±185 km (5.2)
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

- Zapisz CRS w `meta.json` dwa razy: jako WKT (`raster_crs_wkt`) i jako równoważny ciąg PROJ (`raster_proj4`, np. `+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m`; parametry muszą zgadzać się z plikiem DEM). Front rejestruje CRS w proj4js, który WKT parsuje niepewnie, więc ciąg PROJ jest obowiązkowy.
- **Test:** punkt na środku krateru Shackleton (~89.67°S, ~129.8°E) musi wypaść na kraterze na `basemap.png`.

### 1.4 Czas
- Okres metryk w `candidates.bin` i `validation.json`: **1 rok (2028), krok 1 h**, czyli **8784 kroki** (rok przestępny, 366 dni), kroki `0..8783`. W meta: `candidates_period = "2028"`.
- `ephem.bin` obejmuje **10 lat: 2028–2037**, czyli **87 672 kroki** (lata przestępne: 2028, 2032, 2036). Start, krok i liczba kroków zapisane w meta (`t0_utc`, `step_s`, `n_steps`); **liczbę kroków zawsze czytaj z `n_steps`, nie wpisuj na sztywno**.
- **Uwaga dla frontu:** `n_steps` to teraz długość całego `ephem.bin` (10 lat). Żeby porównać wynik z `candidates.bin` albo `validation.json`, licz tylko na krokach roku 2028 (`0..8783`), nie na całym pliku.
- Rok `Y` zaczyna się w kroku `(liczba dni od t0_utc do Y-01-01) · 24`, np. 2029 → 8784, 2030 → 17544.
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

- Dzięki temu front policzy oś czasu dla **dowolnego** punktu z jego maski, bez gigantycznych szeregów dla 26 tys. punktów (~2,1 MB dla 10 lat zamiast setek MB).

#### Źródło: JPL Horizons API (pobierane **offline przez silnik**, nie przez przeglądarkę)
Horizons dla Księżyca podaje współrzędne kartograficzne w **MOON_ME, długość wschodnia dodatnia** (w nagłówku odpowiedzi linia `Target pole/equ : MOON_ME {East-longitude positive}`, sprawdź ją). To ta sama ramka, co reszta kontraktu.

**Jedno zapytanie typu OBSERVER na każdy rok** (2028–2037), sklejone w kolejności lat:
- `COMMAND='301'` (cel: Księżyc), `CENTER='500@399'` (obserwator: środek Ziemi),
- `EPHEM_TYPE='OBSERVER'`, `STEP_SIZE='1 h'`, `START_TIME='YYYY-01-01 00:00'`, `STOP_TIME='YYYY-12-31 23:00'` (8760 wierszy, w roku przestępnym 8784; silnik to sprawdza),
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
- Surową odpowiedź Horizons zapisz w repo (`data/raw/horizons_<rok>.csv`, osobny plik na każdy rok), żeby dało się odtworzyć `ephem.bin` bez sieci.

### 3.4 `metrics_by_year.bin`
- `float32`, układ `[n_points, n_years, n_columns]` (wiersz = punkt, w nim kolejne lata, w każdym roku kolejne kolumny).
- **Kolejność punktów identyczna jak w `candidates.bin`** (wiersz `i` tu = wiersz `i` tam, w tym punkty `level = 1`).
- Lata i kolumny z `meta.json → metrics_by_year`: `years = [2028, …, 2037]`, `columns = [sun_pct, longest_night_h, earth_pct, longest_comm_gap_h, power_track_wm2, power_fixed_wm2, power_fixed_az_deg]`.
- `sun_pct`, `earth_pct`: definicje jak w 2.3, średnia po krokach danego roku.
- `longest_night_h`, `longest_comm_gap_h`: **najdłuższy ciąg nakładający się na dany rok, liczony na całym 10-letnim szeregu (noc na przełomie lat liczy się w całości)**, czyli w obu latach, na które zachodzi. Powód: pory roku na Księżycu (rok zaćmieniowy 346,6 dnia) przesuwają się względem kalendarza, więc cięcie na 1 stycznia dzieliłoby długie noce na dwie krótsze. Wartość ograniczona do długości roku (8760 h, 8784 h w latach przestępnych 2028, 2032, 2036); równa długości roku = ciemno/brak łączności przez cały rok.
- `candidates.bin` zachowuje pierwotną definicję z 2.3: tylko rok 2028, ciąg ucięty na granicach roku. Dlatego `sun_pct` i `earth_pct` dla 2028 są tu równe `candidates.bin`, a `longest_*` dla 2028 mogą być tu **większe** niż w `candidates.bin`.
- **Moc z panelu** (`power_*`, W/m²). Dla każdego punktu i kroku godzinowego `k`:
  - `f`, `el`, `az`: jak w 2.1 (kierunek Słońca ze środka Księżyca, `el`/`az` środka tarczy w ENU punktu, `f` = widoczny ułamek tarczy).
  - `d` = liczba dni od 2000-01-03 00:00 UTC w chwili kroku (`t0 + k · 1 h`); `r = 1 − 0,0167 · cos(2π·d / 365,256)`; `S = 1361 / r²`.
  - `w = S · f · cos(el)` (pionowy panel obracany za Słońcem).
  - `power_track_wm2` = średnia `w` po krokach danego roku (noc liczy się jako 0).
  - Histogram azymutów: 72 przedziały po 5°, przedział `b = floor(az / 5)`, czyli `[5b, 5b + 5)`, środek `5b + 2,5`; `hist[b] += w`.
  - Panel nieruchomy: 72 kandydaty `A = 5k + 2,5` (`k = 0..71`, środki przedziałów); `fixed(A) = Σ_b hist[b] · max(0, cos(5b + 2,5 − A)) / liczba kroków roku`.
  - `power_fixed_wm2` = max po `A`; `power_fixed_az_deg` = `A` dające to maksimum (przy remisie najmniejsze `A`).
  - `power_fixed_az_deg = NaN, gdy power_fixed_wm2 = 0 (brak kierunku)`.
  - Wszystkie sumy (`w`, `hist`, średnie) w `float64`, zapis jak reszta pliku w `float32`. Zawsze `power_fixed_wm2 ≤ power_track_wm2`.
  - Liczone w tym samym przebiegu po 10-letnim szeregu co `longest_*`. `validation.json` ma te same trzy pola dla 2028 (sekcja 6).
- Rozmiar: `n_points · 10 · 7 · 4 B` (~11,3 MB dla ~40 tys. punktów).

```python
mby = np.fromfile('metrics_by_year.bin', '<f4').reshape(n_points, len(years), len(columns))
```

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
  "n_steps": 87672,

  "sun_radius_deg": 0.2666,
  "night_threshold": 0.01,
  "observer_height_m": 2.0,
  "mask_min_dist_m": 120,
  "slope_basis": "LDSM_80S_20MPP_ADJ",
  "dem_near": "LDEM_80S_80MPP_ADJ",
  "dem_far": "LDEM_60S_240MPP_ADJ",
  "psr_source": "...",

  "region": { "lat_min": -90, "lat_max": -84 },
  "candidates": {
    "count": 26000,
    "columns": ["id","lat","lon","x_m","y_m","elev_m","level",
                "sun_pct","longest_night_h","earth_pct","longest_comm_gap_h",
                "slope_deg","dist_psr_km"]
  },
  "candidates_period": "2028",
  "metrics_by_year": {
    "file": "metrics_by_year.bin",
    "years": [2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037],
    "columns": ["sun_pct", "longest_night_h", "earth_pct", "longest_comm_gap_h",
                "power_track_wm2", "power_fixed_wm2", "power_fixed_az_deg"],
    "dtype": "float32",
    "layout": "[n_points, n_years, n_columns]"
  },

  "raster_crs_wkt": "PROJCS[...]",
  "raster_proj4": "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m",
  "layers": {
    "bounds_m": { "min_x": -185000, "min_y": -185000, "max_x": 185000, "max_y": 185000 },
    "files": {
      "basemap": "layers/basemap.png",
      "slope": "layers/slope.png",
      "illumination": "layers/illumination.png",
      "psr": "layers/psr.png"
    }
  }
}
```

Wartości przykładowe, a `abcorr` i `ephem_source` uzupełnij tym, co realnie zwrócił Horizons. **Nie są przykładowe** i obowiązują dokładnie takie: `region.lat_max = -84` oraz `layers.bounds_m` (±185000 m), patrz 5.2 i 9.

---

## 5. Zespół danych: rastry, PSR i nazwane miejsca

Rola zespołu danych: wszystko, co nie jest geometrią horyzontu ani symulacją. Silnik dostaje od nich gotowe rastry i tylko próbkuje je w punktach siatki.

### 5.1 Źródła (PGDA product 90, Barker et al. 2023)
- **DEM do masek:** `LDEM_80S_80MPP_ADJ.TIF` (80 m/px, 80–90°S).
- **DEM dalekiego pola:** `LDEM_60S_240MPP_ADJ.TIF` (240 m/px, 60–90°S). Potrzebny, bo siatka sięga 84°S, a promień 150 km z jej brzegu wychodzi do ok. 79°S, czyli poza krawędź pliku 80 m (80°S). Promienie, które wychodzą poza plik 80 m, dalej próbkują plik 240 m. Dla odległego terenu taka rozdzielczość wystarcza.
- **Nachylenie:** `LDSM_80S_20MPP_ADJ.TIF`, gotowa mapa nachylenia w stopniach. Nie liczymy nachylenia sami, tylko próbkujemy ten plik. W meta: `slope_basis = "LDSM_80S_20MPP_ADJ"`.
- **PSR:** do potwierdzenia, które pliki PGDA dają mapę PSR. Z niej zespół danych robi **raster odległości do PSR** (`gdal_proximity.py`), a silnik go próbkuje → `dist_psr_km`.
- **Referencja do walidacji:** PGDA product 69 (Lunar Polar Illumination) ma mapy średniego oświetlenia i widoczności Ziemi dla bieguna południowego. Są uśrednione po 18,6 roku, więc liczby nie zgodzą się z naszym rokiem 1:1, ale **rozkład przestrzenny** (gdzie jasno, gdzie ciemno) musi się zgadzać. Dobra kontrola silnika i gotowa warstwa `illumination.png`.

### 5.2 Rastry (`layers/`)

- PNG, **wszystkie dokładnie z tymi samymi granicami** (`layers.bounds_m`) i w tym samym rzucie. Front nakłada je jeden na drugi bez przeliczania.
- **Granice są stałe: kwadrat ±185 000 m** (`min_x = min_y = −185000`, `max_x = max_y = 185000`). Obejmuje okrąg 84°S (promień `2R·tan(3°)` ≈ 182 100 m) z zapasem ok. 2,9 km. Nie dopasowujemy granic do siatki ani do wersji danych.
- **Rozmiar: 4096 × 4096 px** (≈ 90,3 m/px), każda warstwa tak samo. Mniejszy rozmiar dopuszczalny, byle kwadratowy i taki sam dla wszystkich czterech.
- **Granice to krawędzie pikseli, nie ich środki** (jak w `gdalwarp -te`): lewa krawędź kolumny 0 leży w `x = −185000`, górna krawędź wiersza 0 w `y = +185000`. **Wiersz 0 = góra (max_y), kolumna 0 = lewa strona (min_x).** Środek piksela `(i, j)` (`i` = kolumna, `j` = wiersz) ma `x = −185000 + (i + 0.5)·px`, `y = 185000 − (j + 0.5)·px`, gdzie `px = 370000 / 4096`.
- Warstwy tematyczne z kanałem alfa (przezroczyste tam, gdzie brak danych, np. poza okręgiem 84°S).
- Przydatne: `gdalwarp -te -185000 -185000 185000 185000 -ts 4096 4096` (wspólne granice i rozmiar), `gdaldem color-relief`, `gdal_proximity.py`, `gdal_translate -of PNG`.

### 5.3 `sites.json`: nazwane miejsca

Siatka to ~26 tys. anonimowych punktów. Jury będzie szukać konkretnych, znanych miejsc, więc zespół danych przygotowuje krótką listę ręcznie:

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
- `nearest_candidate_id` i `nearest_candidate_dist_km` (km po powierzchni) liczy silnik po wygenerowaniu siatki. `nearest_candidate_id` jest wypełniony, gdy najbliższy punkt siatki leży **≤ 4 km** od miejsca, w przeciwnym razie oba pola są `null` (m.in. miejsca poza siatką, np. Apollo). Próg chroni przed pokazaniem metryk punktu z innego fragmentu terenu jako metryk miejsca; front zawsze pokazuje odległość obok metryk.
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
    "earth_pct": 48.0,
    "power_track_wm2": 612.4,
    "power_fixed_wm2": 301.7,
    "power_fixed_az_deg": 42.5
  }
]
```

`power_*` jak w 3.4, identyczne z `metrics_by_year.bin` dla 2028 (wartości `float32`). `NaN` zapisany jako `null` (`JSON.parse` nie przyjmuje `NaN`).

Szeregi i wartości dotyczą roku 2028 (`candidates_period`), czyli 8784 kroków. Front policzy to samo z maski i pierwszych 8784 kroków `ephem.bin` i sprawdzi zgodność (cel: różnica `sun_pct` ≤ 1 pkt proc.). To jedyne zabezpieczenie przed tym, że logika widoczności w Pythonie i w JS rozjedzie się po cichu.

Kontrola zdrowego rozsądku po stronie silnika:
- punkty na dnie Shackletona: `sun_pct ≈ 0`,
- najlepiej oświetlone punkty powinny leżeć na grzbietach i krawędziach kraterów (np. okolice krawędzi Shackletona), nie na płaskim terenie.

---

## 7. Wydajność silnika (ważne przy ~23 h)

Maski to ~26 tys. punktów (siatka 2 km do 84°S) × 720 azymutów × promień 150 km. W czystym NumPy w pętli to się nie skończy na czas.

- **Numba** (`@njit(parallel=True)`, `prange` po punktach) na pętlę promieni.
- **Krok próbkowania rośnie z odległością:** np. 80 m do 5 km, 200 m do 30 km, 500 m dalej. Daleki teren zajmuje mały kąt, więc gęste próbkowanie tam nic nie daje.
- Najpierw zmierz czas dla 100 punktów i dopiero wtedy przelicz, ile zajmie pełna siatka.
- Plan awaryjny: najpierw 87–90°S, potem rozszerzenie do 84°S.
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
- [x] **Siatka sięga 84°S** (nie 85°S): regiony kandydackie Artemis leżą do ok. 6° od bieguna, więc 85° obcinałoby m.in. część Mons Mouton i lądowisko IM-2. Ok. 26 tys. punktów (siatka 2 km), `region.lat_max = −84`.
- [x] **`layers.bounds_m` = ±185000 m na stałe**, PNG 4096 × 4096, granice = krawędzie pikseli, wiersz 0 = góra, kolumna 0 = lewa strona (5.2).
- [x] **`sites.json`:** `nearest_candidate_id` wypełniany przy odległości ≤ 4 km, inaczej `null`; `nearest_candidate_dist_km` zawsze razem z nim (5.3).
- [x] **Efemerydy na 10 lat (2028–2037)** + `metrics_by_year.bin` (3.4). `candidates.bin` i `validation.json` zostają na 2028.

Do potwierdzenia:
- [ ] Nagłówek pierwszej prawdziwej odpowiedzi Horizons: `MOON_ME`, długość wschodnia, użyta poprawka aberracji.
- [ ] Źródło mapy PSR (pliki z product 90 albo inny produkt PGDA).
- [ ] Lista miejsc do `sites.json` ze źródłami.

---

## 10. Historia zmian

- **2026-11-14:** siatka do 84°S (było 85°S), `layers.bounds_m` ±185000 m na stałe, PNG 4096 × 4096 z konwencją krawędzi pikseli i orientacji wiersza/kolumny (5.2), próg 4 km dla `nearest_candidate_id` (5.3). Formaty binarne bez zmian, `contract_version` pozostaje 1.
- **2026-11-15:** `ephem.bin` na 10 lat 2028–2037 (`n_steps = 87672`), nowy plik `metrics_by_year.bin` (3.4), nowe pola w meta: `candidates_period`, `metrics_by_year`. `candidates.bin` i `validation.json` bez zmian (rok 2028). Front musi liczyć porównania na krokach `0..8783` (1.4). `contract_version` pozostaje 1.
- **2026-11-15:** `metrics_by_year.bin` ma 7 kolumn (było 4): dochodzą `power_track_wm2`, `power_fixed_wm2`, `power_fixed_az_deg` (3.4), układ `[n_points, 10, 7]`, ~11,3 MB. `longest_*` ograniczone do długości roku. `validation.json`: te same trzy pola dla 2028, `NaN` jako `null` (6). `meta.metrics_by_year.columns` zaktualizowane. `contract_version` pozostaje 1.
