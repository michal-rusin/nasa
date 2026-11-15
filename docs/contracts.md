# Data contract: engine → frontend (v1)

**Project:** Lunar Landing Site Navigator (NASA Space Apps 2026)
**Audience:** engine developer (Python) and their AI assistant
**Frontend owner:** Michał

This document specifies **exactly** which files the engine must produce, their formats, and the conventions they follow. The frontend is a static website without a backend: it only reads these files. Every format change requires incrementing `contract_version` in `meta.json` and notifying the frontend.

> **For the AI assistant:** treat “Conventions” and “Binary formats” as strict requirements. Do not change field names, ordering, units, or endianness. If anything is unclear or infeasible, ask a human instead of guessing.

---

## 0. Required engine output (summary)

```
data/out/v1/
├── meta.json            # metadata, column order, definitions, raster bounds
├── candidates.bin       # metrics for each grid point (float32 LE)
├── ephem.bin            # hourly Sun and Earth in MOON_ME, years 2028–2037 (float32 LE)
├── metrics_by_year.bin  # metrics for each point and each year 2028–2037 (float32 LE)
├── masks/
│   ├── index.json       # point ID → tile + record number
│   └── tile_<i>_<j>.bin # horizon masks (int16 LE)
├── validation.json      # 3–5 points with full hourly series (for frontend tests)
├── sites.json           # (data team) named sites: Artemis, CLPS, Chang'e-7, Apollo
└── layers/              # (data team) raster PNGs, 4096×4096, bounds ±185 km (5.2)
    ├── basemap.png
    ├── slope.png
    ├── illumination.png
    └── psr.png
```

---

## 1. Conventions (the most important section)

Most integration errors arise when the two sides adopt different conventions without noticing. Everything below applies equally to the engine and frontend.

### 1.1 Reference frame
- Body frame: **MOON_ME** (Horizons uses it for lunar coordinates; see 3.3). All vectors are in km, in MOON_ME, with the origin at the Moon's center.
- Model the Moon as a **sphere, R = 1737.4 km** (write this to `meta.json` as `moon_radius_km`). If using another value, record it there. The frontend reads it from metadata.
- Latitude `lat` in degrees, negative in the south. Longitude `lon` in degrees, **east-positive, range [-180, 180)**.

### 1.2 Local ENU frame at a point
For a point with `lat = φ`, `lon = λ` (spherical; “up” = radial direction):

```
U = ( cosφ·cosλ,  cosφ·sinλ,  sinφ )     # up
E = ( -sinλ,      cosλ,       0    )     # east
N = ( -sinφ·cosλ, -sinφ·sinλ, cosφ )     # north
```

Observer position: `P = (R + elev_km + observer_height_m/1000) · U` (observer height from metadata, default 2 m: panels/antenna). Use the same height for engine mask calculations and frontend Earth parallax.

For a direction vector `v` (from the point to the object):
- **azimuth** = `atan2(v·E, v·N)` in degrees, normalized to `[0, 360)`. **0° = local north, increasing clockwise (through east).**
- **elevation** = `asin(v·U / |v|)` in degrees.

> Why this matters: near the pole, local “north” rotates with longitude. If mask azimuth is measured, for example, from the projection's +Y direction, the frontend panorama will be offset by approximately the point's longitude, and this will be hard to notice visually.

### 1.3 Raster projection and `x_m, y_m`
- `x_m, y_m` = point coordinates in meters in **the same projection as the rasters** (LOLA / LROC DEM polar stereographic).
- Compute them with a library using the DEM file's CRS, not a custom formula:

```python
import rasterio
from pyproj import CRS, Transformer

with rasterio.open(DEM_PATH) as ds:
    dem_crs = CRS.from_user_input(ds.crs)

geo = dem_crs.geodetic_crs  # lunar geographic CRS consistent with the DEM
tr = Transformer.from_crs(geo, dem_crs, always_xy=True)
x_m, y_m = tr.transform(lon_deg, lat_deg)
```

- Store the CRS twice in `meta.json`: as WKT (`raster_crs_wkt`) and as an equivalent PROJ string (`raster_proj4`, e.g. `+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m`; parameters must match the DEM file). The frontend registers the CRS in proj4js, whose WKT parsing is unreliable, so the PROJ string is mandatory.
- **Test:** a point at the center of Shackleton crater (~89.67°S, ~129.8°E) must land on the crater in `basemap.png`.

### 1.4 Time
- Metric period in `candidates.bin` and `validation.json`: **1 year (2028), 1 h steps**, i.e. **8784 steps** (leap year, 366 days), steps `0..8783`. In metadata: `candidates_period = "2028"`.
- `ephem.bin` covers **10 years: 2028–2037**, i.e. **87,672 steps** (leap years: 2028, 2032, 2036). Start, step size, and step count are stored in metadata (`t0_utc`, `step_s`, `n_steps`); **always read the count from `n_steps`, never hardcode it**.
- **Frontend note:** `n_steps` now describes the entire `ephem.bin` (10 years). To compare results with `candidates.bin` or `validation.json`, calculate only over the 2028 steps (`0..8783`), not the whole file.
- Year `Y` starts at step `(number of days from t0_utc to Y-01-01) · 24`, e.g. 2029 → 8784, 2030 → 17544.
- Horizons provides ephemerides for arbitrary dates, so choose the year to fit the narrative, not the data source. A reasonable window covers realistically planned polar landings in the coming years. Agreed: 2028 (section 9).
- One year is the minimum to cover seasonal changes (lunar axial tilt ~1.5°). A longer period is better but increases computation time linearly.
- Step `k` corresponds to `t0_utc + k·step_s`.

---

## 2. Metric definitions

Use one definition everywhere. The frontend will use these definitions to calculate the timeline and compare its results with the engine.

### 2.1 Visible fraction of the solar disk `f` at a time step
- `e` = elevation of the Sun's center, `h` = horizon mask height at the Sun's azimuth (**linear interpolation** between samples spaced 0.5° apart), `r` = Sun's angular radius (constant **0.2666°**, stored as `sun_radius_deg` in metadata).
- `d = (e − h) / r`
- `f = 0` for `d ≤ −1`, `f = 1` for `d ≥ 1`, otherwise:

```
f = ( acos(−d) + d·sqrt(1 − d²) ) / π
```

(The fraction of the disk's area above a horizontal horizon line. Approximate the horizon as a straight line across the disk.)

Use the direction to the Sun from the Moon's center (`sun_dir` in `ephem.bin`). Solar parallax is negligible (<0.001°).

### 2.2 Earth visibility `g` at a time step
- Compute the Earth vector **from the point's position**: `v = Earth_pos − P` (Earth parallax reaches ~0.26°, so it must not be omitted).
- `g = 1` if the elevation of Earth's **center** > the mask at its azimuth; otherwise `g = 0`.

### 2.3 Metrics in `candidates.bin`
| Field | Unit | Definition |
|---|---|---|
| `sun_pct` | % | `100 · mean(f)` over all steps |
| `longest_night_h` | h | longest run of consecutive steps with `f < night_threshold` (default **0.01**, in metadata) × step size in hours |
| `earth_pct` | % | `100 · mean(g)` |
| `longest_comm_gap_h` | h | longest run of consecutive steps with `g = 0` × step size in hours |
| `slope_deg` | ° | terrain slope sampled from `LDSM_80S_20MPP_ADJ.TIF` (section 5.1) |
| `dist_psr_km` | km | distance to the nearest PSR (permanently shadowed region) pixel, sampled from the data team's distance raster. Record the PSR map source in metadata |
| `elev_m` | m | DEM elevation relative to `moon_radius_km` |

Do **not** join runs across the period boundaries (e.g. night at the start and end of the year). Treat the period as an interval, not a loop.

---

## 3. Binary formats

Everything is **little-endian**, without headers. `meta.json` describes dimensions and ordering.

### 3.1 `candidates.bin`
- `float32`, row-major: `N` rows × `C` columns.
- Column order = `meta.json → candidates.columns`. Default:

```
id, lat, lon, x_m, y_m, elev_m, level,
sun_pct, longest_night_h, earth_pct, longest_comm_gap_h,
slope_deg, dist_psr_km
```

- `id`: integer stored as float32 (exact up to 16,777,216, which is sufficient). Unique and stable between data versions if the grid does not change.
- `level`: `0` = 2 km grid, `1` = 250 m refinement.
- Missing value → `NaN` (not `-9999`).

```python
import numpy as np
arr = np.stack([df[c].to_numpy(np.float32) for c in COLUMNS], axis=1)
arr.astype('<f4').tofile('data/out/v1/candidates.bin')
```

### 3.2 Horizon masks: `masks/`
- Per point: **720 × int16**, hundredths of a degree (e.g. `523` = 5.23°), azimuth `k · 0.5°` for `k = 0..719`, following 1.2.
- Values **may be negative** (horizon below the local horizontal, typically on ridges and peaks where terrain falls away in every direction). This is signed int16; the frontend must not assume the mask is ≥ 0.
- The mask already includes curvature correction (search radius about 150 km).
- Compute the mask at `observer_height_m` above ground. Rays start `mask_min_dist_m` from the point so nearby DEM noise does not obscure the horizon.
- Tiles: **8×8** grid over `x_m, y_m` within candidate-region bounds. File `tile_<i>_<j>.bin` = concatenated point records from that tile (1440 B per point).
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

`["tile_3_4.bin", 17]` → the mask starts at byte `17 · 1440` in that file.

### 3.3 `ephem.bin`
- `float32`, `n_steps` rows × 6 columns:

```
sun_dir_x, sun_dir_y, sun_dir_z,      # unit vector from the Moon's center to the Sun, MOON_ME
earth_x,   earth_y,   earth_z         # position of Earth's center in km, MOON_ME
```

- This lets the frontend calculate a timeline for **any** point from its mask, without enormous series for 26,000 points (~2.1 MB for 10 years instead of hundreds of MB).

#### Source: JPL Horizons API (fetched **offline by the engine**, not the browser)
Horizons provides lunar cartographic coordinates in **MOON_ME, east-positive longitude** (response header line `Target pole/equ : MOON_ME {East-longitude positive}`; verify it). This is the same frame used throughout the contract.

**One OBSERVER query per year** (2028–2037), concatenated in chronological order:
- `COMMAND='301'` (target: Moon), `CENTER='500@399'` (observer: Earth's center),
- `EPHEM_TYPE='OBSERVER'`, `STEP_SIZE='1 h'`, `START_TIME='YYYY-01-01 00:00'`, `STOP_TIME='YYYY-12-31 23:00'` (8760 rows, or 8784 in a leap year; verified by the engine),
- `QUANTITIES='14,15,20'`, `CSV_FORMAT='YES'`, `ANG_FORMAT='DEG'`:
  - **14** – sub-observer (= sub-Earth) point on the Moon: `lon_E, lat_E`,
  - **15** – subsolar point on the Moon: `lon_S, lat_S`,
  - **20** – observer–target distance `delta` (au → km: × 149,597,870.7).

Conversion (spherical, `u(lat, lon) = (cos lat·cos lon, cos lat·sin lon, sin lat)`):

```
sun_dir   = u(lat_S, lon_S)
earth_pos = delta_km · u(lat_E, lon_E)
```

Notes:
- Check the header for east-positive longitudes and understand which aberration correction Horizons used (record it in metadata as `ephem_source` and `abcorr`). Differences of a fraction of an arcminute are insignificant for this project.
- If a year at 1 h resolution exceeds the response line limit, split the period into multiple queries and concatenate them.
- Do **not** query Horizons from the browser during the demo: depending on an external server and network during a presentation is an unnecessary risk, and cross-domain API access (CORS) has not been verified. The engine downloads once, saves `ephem.bin`, and the frontend reads the file.
- Save raw Horizons responses in the repository (`data/raw/horizons_<year>.csv`, a separate file for each year), so `ephem.bin` can be reproduced without network access.

### 3.4 `metrics_by_year.bin`
- `float32`, layout `[n_points, n_years, n_columns]` (each row is a point, containing successive years, each containing successive columns).
- **Point order is identical to `candidates.bin`** (row `i` here = row `i` there, including `level = 1` points).
- Years and columns come from `meta.json → metrics_by_year`: `years = [2028, …, 2037]`, `columns = [sun_pct, longest_night_h, earth_pct, longest_comm_gap_h]`.
- `sun_pct`, `earth_pct`: definitions from 2.3, averaged over that year's steps.
- `longest_night_h`, `longest_comm_gap_h`: **the longest run overlapping that year, calculated over the entire 10-year series (a night crossing a year boundary counts in full)**, thus counting in both overlapping years. Reason: lunar seasons (eclipse year of 346.6 days) shift relative to the calendar, so cutting at January 1 would split long nights into two shorter ones. Cap the value at the year's duration (8760 h, or 8784 h in leap years 2028, 2032, 2036); a value equal to the year's duration means darkness/no communication throughout the year.
- `candidates.bin` retains the original definition from 2.3: only 2028, with runs clipped at year boundaries. Thus `sun_pct` and `earth_pct` for 2028 equal those in `candidates.bin`, while `longest_*` for 2028 may be **larger** here.
- Size: `n_points · 10 · 4 · 4 B` (~6.5 MB for ~40,000 points).

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
  "abcorr": "as specified in the Horizons header",

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
    "columns": ["sun_pct", "longest_night_h", "earth_pct", "longest_comm_gap_h"],
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

Values are examples; fill `abcorr` and `ephem_source` with what Horizons actually returned. The following are **not examples** and must be used exactly: `region.lat_max = -84` and `layers.bounds_m` (±185000 m); see 5.2 and 9.

---

## 5. Data team: rasters, PSR, and named sites

The data team handles everything other than horizon geometry and simulation. The engine receives prepared rasters and only samples them at grid points.

### 5.1 Sources (PGDA product 90, Barker et al. 2023)
- **DEM for masks:** `LDEM_80S_80MPP_ADJ.TIF` (80 m/px, 80–90°S).
- **Far-field DEM:** `LDEM_60S_240MPP_ADJ.TIF` (240 m/px, 60–90°S). Required because the grid extends to 84°S and a 150 km radius from its edge reaches about 79°S, beyond the 80 m file's boundary (80°S). Rays leaving the 80 m file continue sampling the 240 m file. This resolution is sufficient for distant terrain.
- **Slope:** `LDSM_80S_20MPP_ADJ.TIF`, a ready-made slope map in degrees. Do not calculate slope ourselves; sample this file. In metadata: `slope_basis = "LDSM_80S_20MPP_ADJ"`.
- **PSR:** confirm which PGDA files provide the PSR map. The data team uses it to create a **distance-to-PSR raster** (`gdal_proximity.py`), which the engine samples → `dist_psr_km`.
- **Validation reference:** PGDA product 69 (Lunar Polar Illumination) provides mean illumination and Earth visibility maps for the south pole. They average over 18.6 years, so the numbers will not match our single year exactly, but the **spatial distribution** (bright versus dark areas) must agree. Useful as an engine check and a ready-made `illumination.png` layer.

### 5.2 Rasters (`layers/`)

- PNG, **all with exactly the same bounds** (`layers.bounds_m`) and projection. The frontend overlays them without transformation.
- **Fixed bounds: a square of ±185,000 m** (`min_x = min_y = −185000`, `max_x = max_y = 185000`). This covers the 84°S circle (radius `2R·tan(3°)` ≈ 182,100 m) with about 2.9 km of margin. Do not fit bounds to the grid or data version.
- **Size: 4096 × 4096 px** (≈ 90.3 m/px), identical for every layer. Smaller sizes are allowed if square and identical for all four layers.
- **Bounds refer to pixel edges, not centers** (as in `gdalwarp -te`): column 0's left edge is at `x = −185000`, row 0's top edge at `y = +185000`. **Row 0 = top (max_y), column 0 = left (min_x).** Pixel `(i, j)` (`i` = column, `j` = row) has center `x = −185000 + (i + 0.5)·px`, `y = 185000 − (j + 0.5)·px`, where `px = 370000 / 4096`.
- Thematic layers include an alpha channel (transparent where data is missing, e.g. outside the 84°S circle).
- Useful tools: `gdalwarp -te -185000 -185000 185000 185000 -ts 4096 4096` (shared bounds and size), `gdaldem color-relief`, `gdal_proximity.py`, `gdal_translate -of PNG`.

### 5.3 `sites.json`: named sites

The grid contains ~26,000 anonymous points. Judges will look for specific, known locations, so the data team prepares a short list manually:

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
    "note": "Short description and source",
    "nearest_candidate_id": 12345,
    "nearest_candidate_dist_km": 0.8
  }
]
```

- `category`: `artemis` (Artemis candidate regions), `clps` (e.g. IM-2), `international` (e.g. Chang'e-7), `apollo` (historical context), `reference` (reference points, e.g. Malapert).
- Example `lat/lon` values are illustrative. **Every site must cite a source**, not rely on memory.
- The engine computes `nearest_candidate_id` and `nearest_candidate_dist_km` (km along the surface) after generating the grid. Populate `nearest_candidate_id` when the nearest grid point is **≤ 4 km** away; otherwise both fields are `null` (including locations outside the grid, such as Apollo). The threshold prevents presenting metrics from a different terrain area as the site's metrics; the frontend always displays distance alongside the metrics.
- `x_m`, `y_m`: site coordinates in meters in the raster projection, computed as for candidates (pyproj using the DEM file's CRS, section 1.3). The frontend positions markers using these fields because it does not know the projection and does not transform `lat/lon`. Sites outside raster bounds (`layers.bounds_m`), e.g. Apollo, have both fields set to `null`; the frontend shows them in the list but does not draw them on the map.
- The frontend displays sites as a separate labeled layer. Clicking opens the nearest grid point's panel with a distance note.

---

## 6. Validation (`validation.json`)

Full hourly series for 3–5 points of different types: a well-lit ridge, a crater floor in a PSR, and an intermediate point:

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

Series and values cover 2028 (`candidates_period`), i.e. 8784 steps. The frontend calculates the same values from the mask and first 8784 steps of `ephem.bin`, then checks agreement (target: `sun_pct` difference ≤ 1 percentage point). This is the only safeguard against the Python and JS visibility logic silently diverging.

Engine sanity checks:
- points on Shackleton's floor: `sun_pct ≈ 0`,
- the best-lit points should lie on ridges and crater rims (e.g. near Shackleton's rim), not on flat terrain.

---

## 7. Engine performance (important with ~23 h available)

Masks require ~26,000 points (2 km grid to 84°S) × 720 azimuths × a 150 km radius. Loops in pure NumPy will not finish in time.

- Use **Numba** (`@njit(parallel=True)`, `prange` over points) for the ray loop.
- **Increase sampling step with distance:** e.g. 80 m out to 5 km, 200 m out to 30 km, 500 m beyond that. Distant terrain subtends a small angle, so dense sampling adds no benefit there.
- Time 100 points first, then estimate the full-grid runtime.
- Fallback plan: start with 87–90°S, then extend to 84°S.
- **250 m refinement (`level = 1`) is optional.** Do it only after the full 2 km grid is complete and validated.

## 8. Delivery order

1. **Now:** confirm conventions (section 1) and formats (section 3). The frontend creates test data in the identical format.
2. **As soon as possible:** ~100 real points, all files, even with a simplified algorithm. The goal is an end-to-end test, not accuracy.
3. **Then:** full 2 km grid + `ephem.bin` + `validation.json`.
4. **Optional, last:** 250 m refinement (`level = 1`), using the same format.

Place each delivery in a new version directory or update `generated_utc`, so the frontend knows the data has changed.

---

## 9. Decisions and open questions

Agreed:
- [x] **Year: 2028**, 1 year, 1 h steps. NASA is targeting the first crewed Artemis landing (Artemis IV) for 2028.
- [x] **DEM for masks:** `LDEM_80S_80MPP_ADJ.TIF` + far field from `LDEM_60S_240MPP_ADJ.TIF`.
- [x] **Slope:** `LDSM_80S_20MPP_ADJ.TIF` (ready-made slope map, PGDA product 90).
- [x] **`night_threshold = 0.01`.**
- [x] **Conventions (section 1) and binary formats (section 3) confirmed by the engine.**
- [x] **`observer_height_m = 2.0`, `mask_min_dist_m = 120`** (added by the engine, binary formats unchanged).
- [x] **Grid extends to 84°S** (not 85°S): Artemis candidate regions lie up to about 6° from the pole, so 85° would exclude, among other areas, part of Mons Mouton and the IM-2 landing site. About 26,000 points (2 km grid), `region.lat_max = −84`.
- [x] **Fixed `layers.bounds_m` = ±185000 m**, PNG 4096 × 4096, bounds = pixel edges, row 0 = top, column 0 = left (5.2).
- [x] **`sites.json`:** populate `nearest_candidate_id` at distances ≤ 4 km, otherwise `null`; `nearest_candidate_dist_km` is always populated or null together with it (5.3).
- [x] **10-year ephemerides (2028–2037)** + `metrics_by_year.bin` (3.4). `candidates.bin` and `validation.json` remain limited to 2028.

To confirm:
- [ ] Header of the first real Horizons response: `MOON_ME`, east-positive longitude, aberration correction used.
- [ ] PSR map source (product 90 files or another PGDA product).
- [ ] Site list for `sites.json`, with sources.

---

## 10. Change history

- **2026-11-14:** grid extended to 84°S (previously 85°S), fixed `layers.bounds_m` ±185000 m, PNG 4096 × 4096 with pixel-edge bounds and row/column orientation (5.2), 4 km threshold for `nearest_candidate_id` (5.3). Binary formats unchanged; `contract_version` remains 1.
- **2026-11-15:** `ephem.bin` extended to 10 years, 2028–2037 (`n_steps = 87672`), new `metrics_by_year.bin` file (3.4), new metadata fields: `candidates_period`, `metrics_by_year`. `candidates.bin` and `validation.json` unchanged (year 2028). The frontend must calculate comparisons over steps `0..8783` (1.4). `contract_version` remains 1.
