# Test data generator (`scripts/mock-data.py`)

Documentation for an AI assistant (Claude) working on the frontend or engine. `docs/contracts.md` (v1) takes precedence. This file describes only the generator and its pitfalls.

## Purpose
The script writes the complete set of contract files with SYNTHETIC but internally consistent data. Metrics in `candidates.bin` and `validation.json` use the physics in contract sections 1.2 and 2, with synthetic masks and ephemerides. This allows:
- the frontend to test “my JS physics == generator data” (criterion: `sun_pct` difference ≤ 1 percentage point),
- the script's physics code (`visibility`, `mask_height_deg`, `longest_run`, `enu_basis`) to serve as a reference for the TypeScript port.

The data is NOT real. `meta.json` contains `"mock": true`, source fields contain `"MOCK"`, and location names in `sites.json` begin with `[MOCK]`. Never treat these numbers as scientific results.

## Running
```
python scripts/mock-data.py [--out DIR] [--lat-min -84] [--seed 42] [--generated-utc ...]
```
- Dependencies: only `numpy` and `Pillow`. Do not add others (scipy, numba, pyproj).
- Do not use `python -I`: numpy is installed in the user directory on this machine.
- `--out`: defaults to `web/public/data`. `--lat-min`: latitude of the grid's outer edge (the grid covers -90..lat_min). `-84` (default, as in the contract) = 26,045 points (about 50 s, about 42 MB); `-89` = 725 points (about 4 s, about 2.6 MB, suitable for the repository).
- Output is bit-for-bit deterministic for the same `--seed`. Therefore `generated_utc` is a constant (`2026-11-14T00:00:00Z`), not the current time. Do not replace it with `datetime.now()`.
- Exit code ≠ 0 if the self-check detects an error. Warnings about the range and histogram of `sun_pct` are not errors.

## Conventions that are easy to break
- **Projection:** south polar stereographic, `rho = 2R·tan(π/4 + lat/2)`, `x = rho·sin(lon)`, `y = rho·cos(lon)`. This convention applies ONLY to mock data. The real engine computes `x_m, y_m` through pyproj using the DEM file's CRS.
- **Grid:** every 2000 m in (x, y), with (0, 0) at the pole. `id` is a sequential index, ordered by x, then y. `level = 0`.
- **Azimuth:** `atan2(v·E, v·N)`, 0° = local north, increasing through east (contract 1.2). Mask: 720 samples, `k·0.5°`, linear interpolation with wraparound.
- **Physics uses values after casting to float32** (lat, lon, elev), exactly as the frontend reads them from the file. The mask is quantized to `int16` (hundredths of a degree) BEFORE the physics calculations.
- **Sun:** direction from the Moon's center, without parallax. **Earth:** vector `earth_pos − P` with parallax, `P = (R + elev_km + 0.002)·U`. Elevation refers to the disk center, excluding its radius.
- **Runs** (`longest_night_h`, `longest_comm_gap_h`) are treated as intervals without joining the start and end of the period.
- **Time:** `n_steps = 8784` (2028 is a leap year), with the `N_STEPS` constant defined in one place. Contract section 1.4 still says 8760, which is outdated.
- **Rasters:** default 1024×1024 (`--layer-px`; the contract recommends 4096 for real data), shared `bounds_m` = ±185000 m (contract 5.2); bounds refer to pixel edges, row 0 = top = `max_y`. Thematic layers are transparent outside the grid region. `illumination.png`: pixel → nearest 2 km cell.
- **Mask tiles:** 8×8 grid in the square `±rho(lat_min)`, `i` along x, `j` along y, records sorted by increasing `id`, 1440 B per record; empty tiles have no file.
- **`sites.json`:** a location with `rho` greater than the grid radius gets `null` for both `nearest_candidate_id` and `nearest_candidate_dist_km` (as with Apollo). Therefore more locations have `null` in the `-89` sample.
- **`sites.json`, `x_m`/`y_m`:** location in meters in the mock projection (`latlon_to_xy`, contract 5.3), calculated from unrounded `lat`/`lon`, rounded to 0.1 m. Locations outside raster bounds (`|x|` or `|y|` > `LAYER_HALF_M`, e.g. Apollo at −20°) have both fields set to `null`. This is independent of `nearest_candidate_*`, which depends on the grid radius (`--lat-min`); in a small sample, a location may therefore have `x_m`/`y_m` while `nearest_candidate_*` is `null`.

## Synthetic terrain
The `Terrain` class consists entirely of (x, y) functions with parameters derived from the seed:
- 5 craters (one near 89.7°S, radii 3–15 km); PSR = crater interior, `dist_psr_km = max(0, d − r)/1000` (minimum over craters),
- `elev_m`: background ±1500 m + crater floors + rims + slight noise,
- `slope_deg` 0–25°, steep near rims,
- horizon mask: a base that is a CONTINUOUS function of position (`Terrain.horizon_base_deg`) + 3 azimuth components with point-dependent phase + noise, range [-3, 7]° (`MASK_MIN_DEG`, `MASK_MAX_DEG`), signed `int16`, unchanged `round(deg·100)` quantization. Outside craters, the base depends on `t` (normalized background terrain, 1 = ridge): ridges around −2° (`RIDGE_DEG`), flat terrain around 0°, background depressions up to +5° (`FLOOR_DEG`); on crater slopes it smoothly rises to `CRATER_DEG` = 6° (weight `crater_weight`). A negative horizon means the point is elevated above its surroundings.

## `sun_pct` distribution and tuning
With a nonnegative mask, `sun_pct` did not exceed about 55% (the Sun's elevation near the pole is about `−δ(t)`, δ = ±1.54°). Masks therefore span [−3, 7]°: a negative horizon on ridges raises `sun_pct` to about 80%, while a high horizon in craters yields 0.

Current distribution (full grid, seed 42): `sun_pct` 0–79.9 (median 47.0), `earth_pct` 0–90.9. The histogram in 10-percentage-point bins rises from about 8% to a peak around 26% in the 50–60% bin, then drops to about 5% in 70–80%. Craters may dominate the 0–10% bin, but no other bin exceeds 35%.

Tuning: constants `RIDGE_DEG`, `FLOOR_DEG`, `CRATER_DEG` and `np.interp` nodes in `horizon_base_deg`. After a change, check the histogram printed by the self-check. A warning appears if the conditions `min(sun_pct) < 5` and `max(sun_pct) > 70` do not both hold, or if any bin other than 0–10% contains more than 35% of points. The small `-89` sample (725 points) passes without warnings.

## Self-check (at the end of the script)
Checks: `candidates.bin` size = N·13·4 and readback, multiples of 1440 B in tiles, record counts in `index.json` and tiles, `ephem.bin` size, identical PNG dimensions, absence of NaN, ranges [0, 100]. Prints a min/median/max table, the `sun_pct` histogram, execution time, and file sizes.

## Making changes
- Changing physics or format requires a contract change (`contract_version`) and notification to the frontend. Do not change column order or endianness.
- After a change, run twice with the same seed and compare hashes (`sha256sum`) to preserve determinism.
- `web/public/data` is not in `.gitignore`. The full set is about 30 MB, so commit the `-89` variant or add the directory to `.gitignore`.
