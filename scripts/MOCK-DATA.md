# Generator danych testowych (`scripts/mock-data.py`)

Dokumentacja dla asystenta AI (Claude) pracującego nad frontem lub silnikiem. Nadrzędny jest `docs/contracts.md` (v1). Ten plik opisuje tylko generator i jego pułapki.

## Do czego to służy
Skrypt zapisuje komplet plików z kontraktu z danymi SYNTETYCZNYMI, ale wewnętrznie spójnymi. Metryki w `candidates.bin` i `validation.json` są policzone fizyką z sekcji 1.2 i 2 kontraktu, z syntetycznych masek i efemeryd. Dzięki temu:
- front może pisać test „moja fizyka w JS == dane z generatora” (kryterium: różnica `sun_pct` ≤ 1 pp),
- kod fizyki w skrypcie (`visibility`, `mask_height_deg`, `longest_run`, `enu_basis`) jest referencją do portu na TypeScript.

Dane NIE są prawdziwe. `meta.json` ma `"mock": true`, pola źródeł mają wartość `"MOCK"`, nazwy miejsc w `sites.json` zaczynają się od `[MOCK]`. Nigdy nie traktuj tych liczb jako wyników naukowych.

## Uruchamianie
```
python scripts/mock-data.py [--out DIR] [--lat-min -85] [--seed 42] [--generated-utc ...]
```
- Zależności: tylko `numpy` i `Pillow`. Nie dodawaj innych (scipy, numba, pyproj).
- Nie używaj `python -I`: na tej maszynie numpy jest w katalogu użytkownika.
- `--out`: domyślnie `web/public/data`. `--lat-min`: szerokość zewnętrznej krawędzi siatki (siatka obejmuje -90..lat_min). `-85` = 18 073 punkty (ok. 50 s, ok. 30 MB), `-89` = 725 punktów (ok. 4 s, ok. 2,6 MB, nadaje się do repo).
- Wynik jest deterministyczny bit w bit przy tym samym `--seed`. Dlatego `generated_utc` to stała (`2026-11-14T00:00:00Z`), a nie zegar. Nie zamieniaj jej na `datetime.now()`.
- Kod wyjścia ≠ 0, gdy samokontrola wykryje błąd. Ostrzeżenia o rozrzucie i histogramie `sun_pct` nie są błędami.

## Konwencje, które łatwo zepsuć
- **Rzut:** stereograficzny biegunowy południowy, `rho = 2R·tan(π/4 + lat/2)`, `x = rho·sin(lon)`, `y = rho·cos(lon)`. To konwencja TYLKO mocka. Prawdziwy silnik liczy `x_m, y_m` przez pyproj z CRS pliku DEM.
- **Siatka:** co 2000 m w (x, y), z punktem (0, 0) na biegunie. `id` to indeks kolejny, kolejność po x, potem po y. `level = 0`.
- **Azymut:** `atan2(v·E, v·N)`, 0° = lokalna północ, rośnie przez wschód (kontrakt 1.2). Maska: 720 próbek, `k·0.5°`, interpolacja liniowa, cyklicznie.
- **Fizyka liczy z wartości po rzutowaniu na float32** (lat, lon, elev), czyli takich, jakie front odczyta z pliku. Maska jest kwantyzowana do `int16` (setne stopnia) PRZED fizyką.
- **Słońce:** kierunek ze środka Księżyca, bez paralaksy. **Ziemia:** wektor `earth_pos − P` z paralaksą, `P = (R + elev_km + 0.002)·U`. Elewacja środka tarczy, bez promienia.
- **Ciągi** (`longest_night_h`, `longest_comm_gap_h`) liczone jako odcinki, bez sklejania początku z końcem okresu.
- **Czas:** `n_steps = 8784` (2028 przestępny), stała `N_STEPS` w jednym miejscu. Sekcja 1.4 kontraktu nadal mówi 8760, co jest nieaktualne.
- **Rastry:** 1024×1024, wspólne `bounds_m` = ±160000 m, wiersz 0 = górny = `max_y`. Warstwy tematyczne są przezroczyste poza regionem siatki. `illumination.png`: piksel → najbliższa komórka 2 km.
- **Kafelki masek:** siatka 8×8 w kwadracie `±rho(lat_min)`, `i` po x, `j` po y, rekordy rosnąco po `id`, 1440 B na rekord, puste kafelki bez pliku.
- **`sites.json`:** miejsce z `rho` większym niż promień siatki dostaje `nearest_candidate_id` i `nearest_candidate_dist_km` równe `null` (jak Apollo). Dlatego w próbce `-89` więcej miejsc ma `null`.
- **`sites.json`, `x_m`/`y_m`:** położenie miejsca w metrach w rzucie mocka (`latlon_to_xy`, kontrakt 5.3), liczone z niezaokrąglonych `lat`/`lon`, zaokrąglone do 0,1 m. Miejsce poza granicami rastrów (`|x|` lub `|y|` > `LAYER_HALF_M`, np. Apollo na −20°) ma oba pola `null`. To niezależne od `nearest_candidate_*`, które zależy od promienia siatki (`--lat-min`), więc w małej próbce miejsce może mieć `x_m`/`y_m`, a `nearest_candidate_*` równe `null`.

## Syntetyczny teren
Klasa `Terrain`, wszystko to funkcje (x, y) z parametrami z seeda:
- 5 kraterów (jeden ok. 89,7°S, promienie 3–15 km); PSR = wnętrze krateru, `dist_psr_km = max(0, d − r)/1000` (min po kraterach),
- `elev_m`: tło ±1500 m + dna kraterów + wały + lekki szum,
- `slope_deg` 0–25°, stromo przy wałach,
- maska horyzontu: baza będąca CIĄGŁĄ funkcją położenia (`Terrain.horizon_base_deg`) + 3 składowe po azymucie z fazą zależną od punktu + szum, zakres [-3, 7]° (`MASK_MIN_DEG`, `MASK_MAX_DEG`), `int16` ze znakiem, kwantyzacja `round(deg·100)` bez zmian. Baza poza kraterami zależy od `t` (znormalizowane tło terenu, 1 = grzbiet): grzbiet ok. −2° (`RIDGE_DEG`), płaskie ok. 0°, zagłębienia tła do +5° (`FLOOR_DEG`); na stokach kraterów płynnie rośnie do `CRATER_DEG` = 6° (waga `crater_weight`). Ujemny horyzont oznacza punkt wyniesiony ponad otoczenie.

## Rozkład `sun_pct` i strojenie
Przy masce nieujemnej `sun_pct` nie przekraczało ok. 55% (Słońce przy biegunie ma wysokość ok. `−δ(t)`, δ = ±1,54°). Dlatego maski mają zakres [−3, 7]°: ujemny horyzont na grzbietach podnosi `sun_pct` do ok. 80%, a wysoki w kraterach daje 0.

Obecny rozkład (pełna siatka, seed 42): `sun_pct` 0–79,9 (mediana 47,0), `earth_pct` 0–90,9. Histogram w 10-procentowych przedziałach rośnie od ok. 8% do szczytu ok. 26% w przedziale 50–60%, potem spada do ok. 5% w 70–80%. Przedział 0–10% mogą dominować kratery, ale żaden inny nie przekracza 35%.

Strojenie: stałe `RIDGE_DEG`, `FLOOR_DEG`, `CRATER_DEG` oraz węzły `np.interp` w `horizon_base_deg`. Po zmianie sprawdź histogram wypisywany przez samokontrolę. Ostrzeżenie pojawia się, gdy nie jest `min(sun_pct) < 5` i `max(sun_pct) > 70` albo gdy jakikolwiek przedział poza 0–10% ma więcej niż 35% punktów. Mała próbka `-89` (725 punktów) przechodzi bez ostrzeżeń.

## Samokontrola (na końcu skryptu)
Sprawdza: rozmiar `candidates.bin` = N·13·4 i odczyt zwrotny, wielokrotności 1440 B w kafelkach, liczbę rekordów w `index.json` i kafelkach, rozmiar `ephem.bin`, jednakowy rozmiar PNG-ów, brak NaN, zakresy [0, 100]. Drukuje tabelkę min/mediana/max, histogram `sun_pct`, czas i rozmiary plików.

## Jak go zmieniać
- Zmiana fizyki lub formatu = zmiana kontraktu (`contract_version`) i informacja dla frontu. Nie zmieniaj kolejności kolumn ani endianness.
- Po zmianie uruchom dwa razy z tym samym seedem i porównaj hashe (`sha256sum`), żeby nie stracić determinizmu.
- `web/public/data` nie jest w `.gitignore`. Pełny komplet to ok. 30 MB, więc do repo wrzucaj wariant `-89` albo dopisz katalog do `.gitignore`.
