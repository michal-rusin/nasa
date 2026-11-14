"""Writers for candidates.bin, mask tiles and meta.json (owner: friend)."""
"""Output files in Michał's exact format (logic mirrored from scripts/mock-data.py). Owner: Jacob."""
import json
from datetime import datetime, timezone
import numpy as np
from terrain import PSR_SOURCE

COLUMNS = ["id", "lat", "lon", "x_m", "y_m", "elev_m", "level",
           "sun_pct", "longest_night_h", "earth_pct", "longest_comm_gap_h",
           "slope_deg", "dist_psr_km"]
TILES = 8
R_KM = 1737.4
LAYER_HALF_M = 185_000

def _write_json(path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def _half(grid):
    """Half-width of the square around all candidates (used for tiles and layer bounds)."""
    return float(np.max(np.abs(np.concatenate([grid["x_m"], grid["y_m"]])))) + 1.0


def write_candidates(out, grid, metrics, slope=None, dist_psr=None):
    n = len(grid["id"])
    nan = np.full(n, np.nan)                       # slope/PSR: NaN until data team rasters exist
    cols = {**grid,
            "sun_pct": metrics[:, 0], "longest_night_h": metrics[:, 1],
            "earth_pct": metrics[:, 2], "longest_comm_gap_h": metrics[:, 3],
            "slope_deg": grid.get("slope_deg", nan) if slope is None else slope,
            "dist_psr_km": grid.get("dist_psr_km", nan) if dist_psr is None else dist_psr}
    arr = np.stack([np.asarray(cols[c], np.float32) for c in COLUMNS], axis=1).astype("<f4")
    arr.tofile(out / "candidates.bin")


def write_masks(out, grid, masks):
    mdir = out / "masks"
    mdir.mkdir(parents=True, exist_ok=True)
    for old in mdir.glob("tile_*.bin"):
        old.unlink()                               # no stale tiles from a previous run
    half = _half(grid)
    size = 2.0 * half / TILES
    ti = np.clip(np.floor((grid["x_m"] + half) / size).astype(int), 0, TILES - 1)
    tj = np.clip(np.floor((grid["y_m"] + half) / size).astype(int), 0, TILES - 1)
    records = {}
    for i in range(TILES):
        for j in range(TILES):
            sel = np.flatnonzero((ti == i) & (tj == j))
            if sel.size == 0:
                continue
            name = f"tile_{i}_{j}.bin"
            (mdir / name).write_bytes(masks[sel].astype("<i2").tobytes())
            for rec, k in enumerate(sel):
                records[str(int(grid["id"][k]))] = [name, rec]
    _write_json(mdir / "index.json", {"samples": 720, "step_deg": 0.5, "scale": 0.01,
                                      "dtype": "int16", "records": records})


def write_meta(out, grid, n_steps, crs, h_obs, mock=False, years=tuple(range(2028, 2038))):
    half = int(round(_half(grid)))
    meta = {
        "contract_version": 1,
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mock": mock,
        "moon_radius_km": R_KM,
        "frame": "MOON_ME",
        "ephem_source": "JPL Horizons API, COMMAND=301, CENTER=500@399, QUANTITIES=14,15,20",
        "abcorr": "apparent (light-time corrected), Horizons OBSERVER quantities 14, 15, 20",
        "t0_utc": "2028-01-01T00:00:00Z",
        "step_s": 3600,
        "n_steps": int(n_steps),
        "sun_radius_deg": 0.2666,
        "night_threshold": 0.01,
        "observer_height_m": h_obs,
        "mask_min_dist_m": 120,
        "slope_basis": "LDSM_80S_20MPP_ADJ",
        "dem_near": "LDEM_80S_80MPP_ADJ",
        "dem_far": "LDEM_60S_240MPP_ADJ",
        "psr_source": PSR_SOURCE,
        "region": {"lat_min": -90, "lat_max": -84},
        "candidates": {"count": len(grid["id"]), "columns": COLUMNS},
        "candidates_period": str(years[0]),
        "metrics_by_year": {"file": "metrics_by_year.bin", "years": list(years),
                            "columns": ["sun_pct", "longest_night_h", "earth_pct", "longest_comm_gap_h"],
                            "dtype": "float32", "layout": "[n_points, n_years, n_columns]"},
        "raster_crs_wkt": crs.to_wkt(),
        "raster_proj4": crs.to_proj4(),
        "layers": {
            "bounds_m": {"min_x": -LAYER_HALF_M, "min_y": -LAYER_HALF_M,
                         "max_x": LAYER_HALF_M, "max_y": LAYER_HALF_M},
            "files": {"basemap": "layers/basemap.png", "slope": "layers/slope.png",
                      "illumination": "layers/illumination.png", "psr": "layers/psr.png"},
        },
    }
    _write_json(out / "meta.json", meta)