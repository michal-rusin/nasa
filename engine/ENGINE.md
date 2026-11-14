# Engine (Python, offline) – brief and status

Read the data contract (Michał's file, contract_version 1) first. Its
conventions and binary formats are hard requirements. The engine runs
offline once and writes data/out/v1/. The browser never calls Python
or Horizons.

Year 2028, 1 h steps, 8760 steps. Moon = sphere, R = 1737.4 km.

## Stack
Python 3.11+, numpy, rasterio, pyproj, numba, requests (Horizons API).

## Inputs
- Near DEM: LDEM_80S_80MPP_ADJ.TIF (80 m/px, 80–90°S)
- Far DEM: LDEM_60S_240MPP_ADJ.TIF (240 m/px, 60–90°S), used where
  rays leave the near DEM
- Slope: LDSM_80S_20MPP_ADJ.TIF (sampled, not computed)
- PSR distance raster: from data team (sampled)
- sites.json: from data team (engine fills nearest candidate fields)
- All from PGDA product 90; check both DEMs have identical CRS

## Mask algorithm (task 4)
- Per point: local north/east on the grid via pyproj finite
  differences (lat+0.001°, lon+0.001°), normalized
- 720 rays, az = k·0.5°, dir = sin(az)·E + cos(az)·N
- Shared sample distances: start 120 m; 80 m steps to 5 km,
  200 m to 30 km, 500 m to 150 km (~430 samples)
- Height: bilinear from near DEM, else far DEM; skip nodata
- angle = atan2(h − (h_site + h_obs) − d²/(2R), d); mask = max
- Store int16 = round(angle·100)
- Pending Michał's OK: observer_height_m = 2.0,
  mask_min_dist_m = 120 (both go into meta.json)

## Tasks (P0 = demo needs it, P1 = important, P2 = if time)
| # | Task | Owner | Pri | Status |
|---|---|---|---|---|
| 1 | Env + load DEMs + CRS transformer; Shackleton test (89.67S, 129.8E lands on the crater) | friend | P0 | todo |
| 2 | Horizons query -> data/raw/horizons_2028.csv -> ephem.bin; verify header (MOON_ME, east-positive); record abcorr in meta | friend | P0 | todo |
| 3 | Grid: points every 2 km in stereographic x/y, region -90..-84 (layer bounds ±185000 m); lat/lon, elev_m, ids, level=0 | friend | P0 | todo |
| 4 | Horizon masks (see algorithm above), numba parallel | Jacob | P0 | todo |
| 5 | Metrics: sun f (disc-segment formula), earth g (with parallax), sun_pct, longest_night_h, earth_pct, longest_comm_gap_h | Jacob | P0 | todo |
| 6 | Writers: candidates.bin, masks tiles + index.json, meta.json (exact contract format) | friend | P0 | todo |
| 7 | First delivery: ~100 points through the whole path; time it | Jacob + friend | P0 | todo |
| 8 | validation.json (3–5 points, full hourly series) | Jacob | P1 | todo |
| 9 | Sanity checks: Shackleton floor sun_pct ~0, best points on rims; compare pattern with PGDA product 69 | Jacob | P1 | todo |
| 10 | Sample slope_deg (LDSM file) and dist_psr_km (data team's raster) at grid points | friend | P1 | todo |
| 11 | Full 2 km grid (~26k points); fallback 87–90°S first if slow | Jacob | P1 | todo |
| 12 | sites.json: fill x_m, y_m (dem.make_transformers, same as candidates), nearest_candidate_id, nearest_candidate_dist_km; all four null for sites outside layers.bounds_m | friend | P1 | todo |
| 13 | Refinement to 250 m (level=1) | Jacob | P2 | todo |

## Rules
- Contract wins. If the code and the contract disagree, ask, don't guess.
- Working beats clean; mark shortcuts in comments.
- Time 100 points before running the full grid.
- Each delivery: bump generated_utc in meta.json.

## Status log
- (one line per milestone, newest last)
- 2026-11-14: grid extended to 84°S (confirmed by Michał): 26044 points, layers.bounds_m ±185000, IM-2 0.93 km from nearest point; full run 123 s