"""Fill x_m, y_m, nearest_candidate_id, nearest_candidate_dist_km in sites.json (Task 12)."""
import argparse
import json
from pathlib import Path
import numpy as np
from pyproj import CRS

from dem import Dem, DEM_NEAR, ROOT, make_transformers

DEFAULT_PROJ4 = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m"

# Ustalony na sztywno zakres warstw PNG (layers.bounds_m)
BOUNDS_M = {
    "min_x": -152000.0,
    "min_y": -152000.0,
    "max_x": 152000.0,
    "max_y": 152000.0,
}

# Maksymalna odległość przypisania kandydata (<= 4 km -> wypełniamy, > 4 km -> null)
MAX_NEAREST_KM = 4.0


def _in_bounds(x_m: float, y_m: float, bounds_m: dict) -> bool:
    return (
        np.isfinite(x_m)
        and np.isfinite(y_m)
        and bounds_m["min_x"] <= x_m <= bounds_m["max_x"]
        and bounds_m["min_y"] <= y_m <= bounds_m["max_y"]
    )


def enrich_sites(
    sites: list[dict],
    grid: dict,
    fwd,
    bounds_m: dict = BOUNDS_M,
    max_nearest_km: float = MAX_NEAREST_KM,
) -> list[dict]:
    """Compute map coordinates and nearest grid candidate for each site (contract 5.3).

    - Sites outside `bounds_m` (±152 000 m) get null for all four fields.
    - Sites inside `bounds_m` get `x_m`, `y_m`, and nearest candidate if dist <= `max_nearest_km`.
    """
    cand_ids = np.asarray(grid["id"], dtype=np.int64)
    cand_x = np.asarray(grid["x_m"], dtype=np.float64)
    cand_y = np.asarray(grid["y_m"], dtype=np.float64)

    enriched = []
    for site in sites:
        item = dict(site)
        lat = float(item["lat"])
        lon = float(item["lon"])

        x_val, y_val = fwd.transform(lon, lat)
        x_m, y_m = float(x_val), float(y_val)

        if not _in_bounds(x_m, y_m, bounds_m):
            item["x_m"] = None
            item["y_m"] = None
            item["nearest_candidate_id"] = None
            item["nearest_candidate_dist_km"] = None
            enriched.append(item)
            continue

        item["x_m"] = round(x_m, 2)
        item["y_m"] = round(y_m, 2)

        if cand_ids.size == 0:
            item["nearest_candidate_id"] = None
            item["nearest_candidate_dist_km"] = None
            enriched.append(item)
            continue

        dists_m = np.hypot(cand_x - x_m, cand_y - y_m)
        best_idx = int(np.argmin(dists_m))
        dist_km = float(dists_m[best_idx]) / 1000.0

        if dist_km <= max_nearest_km:
            item["nearest_candidate_id"] = int(cand_ids[best_idx])
            item["nearest_candidate_dist_km"] = round(dist_km, 3)
        else:
            item["nearest_candidate_id"] = None
            item["nearest_candidate_dist_km"] = None

        enriched.append(item)

    return enriched


def process_sites_file(
    input_path: Path | str,
    output_path: Path | str,
    grid: dict,
    crs: CRS,
    bounds_m: dict = BOUNDS_M,
    max_nearest_km: float = MAX_NEAREST_KM,
) -> list[dict]:
    """Read raw sites.json, fill spatial & nearest-candidate fields, and write output JSON."""
    fwd, _ = make_transformers(crs)
    raw_sites = json.loads(Path(input_path).read_text(encoding="utf-8"))
    out_sites = enrich_sites(
        raw_sites, grid, fwd, bounds_m=bounds_m, max_nearest_km=max_nearest_km
    )
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out_sites, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[OK] Zapisano {out_path} ({len(out_sites)} miejsc)")
    return out_sites


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Enrich sites.json with x_m, y_m, nearest_candidate_*")
    ap.add_argument(
        "--sites-in",
        type=Path,
        default=ROOT / "web/public/data/sample/sites.json",
        help="Input sites.json from data team",
    )
    ap.add_argument(
        "--sites-out",
        type=Path,
        default=ROOT / "data/out/v1/sites.json",
        help="Output sites.json path",
    )
    ap.add_argument(
        "--candidates",
        type=Path,
        default=ROOT / "web/public/data/sample/candidates.bin",
        help="candidates.bin used when running standalone",
    )
    ap.add_argument(
        "--meta",
        type=Path,
        default=ROOT / "web/public/data/sample/meta.json",
        help="meta.json with CRS",
    )
    args = ap.parse_args()

    meta = json.loads(args.meta.read_text(encoding="utf-8"))
    cols = meta["candidates"]["columns"]
    raw_cand = np.fromfile(args.candidates, dtype="<f4").reshape(-1, len(cols))
    sample_grid = {
        "id": raw_cand[:, cols.index("id")].astype(np.int64),
        "x_m": raw_cand[:, cols.index("x_m")],
        "y_m": raw_cand[:, cols.index("y_m")],
    }

    if DEM_NEAR.exists():
        crs = Dem(DEM_NEAR).crs
    else:
        crs = CRS.from_user_input(meta.get("raster_proj4") or meta.get("raster_crs_wkt", DEFAULT_PROJ4))

    result = process_sites_file(args.sites_in, args.sites_out, sample_grid, crs, bounds_m=BOUNDS_M)
    for s in result:
        print(
            f"  {s['id']:22s} -> x={s['x_m']}, y={s['y_m']}, "
            f"cand={s['nearest_candidate_id']}, dist_km={s['nearest_candidate_dist_km']}"
        )