"""Pipeline entry point (to be written).

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
"""Engine pipeline: grid -> masks -> metrics -> validation -> files.
Run: python engine/tools/run.py [--n 100] [--fake-ephem]"""
import sys, time, argparse, json
from datetime import date
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from dem import Dem, DEM_NEAR, DEM_FAR, make_transformers, ROOT
from grid import build_grid, subsample, refine_grid, merge_grids
from masks import compute_masks
from metrics import compute_metrics, longest_by_year
from validation import pick_validation_points, build_validation, write_validation
from terrain import sample_terrain_layers
from sites import process_sites_file, enrich_sites
from ranking import ranking_parents
import writers

H_OBS = 2.0                                   # observer_height_m, same value everywhere
OUT = ROOT / "data/out/v1"
CACHE = ROOT / "data/cache"
T0 = date(2028, 1, 1)                         # meta t0_utc, 1 h steps
YEARS = range(2028, 2038)


def year_slices(n_steps):
    """(year, first step, end step) for every full year the ephemeris covers."""
    out = []
    for y in YEARS:
        s = (date(y, 1, 1) - T0).days * 24
        e = (date(y + 1, 1, 1) - T0).days * 24
        if e <= n_steps:
            out.append((y, s, e))
    return out

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=0, help="random subsample of N points (0 = full grid)")
ap.add_argument("--fake-ephem", action="store_true", help="TEST ONLY, never delivered")
ap.add_argument("--refine", type=int, default=0, help="250 m level-1 grid around the N sunniest points (0 = off)")
ap.add_argument("--refine-ranking", action="store_true",
                help="250 m level-1 grid around frontend-ranking top-10s + named sites")
args = ap.parse_args()

t0 = time.time()
near, far = Dem(DEM_NEAR), Dem(DEM_FAR)
fwd, inv = make_transformers(near.crs)
grid = build_grid(near, far, fwd, inv, lat_edge=-84.0)
if args.n:
    grid = subsample(grid, args.n)
print(f"grid: {len(grid['id'])} points")

# Masks: slowest step -> cached, reused only if the point ids are identical
cache = CACHE / f"masks_{len(grid['id'])}.npz"
if cache.exists() and np.array_equal(np.load(cache)["id"], grid["id"]):
    masks = np.load(cache)["masks"]
    print("masks: from cache")
else:
    masks, _ = compute_masks(grid["lat"], grid["lon"], near, far, fwd, H_OBS)
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez(cache, id=grid["id"], masks=masks)
    print(f"masks: computed ({time.time() - t0:.0f}s)")

if args.fake_ephem:
    from fake import fake_ephem
    ephem_all = fake_ephem()
    out = ROOT / "data/mock/engine_fake"
    print("WARNING: FAKE EPHEMERIS, output goes to data/mock/engine_fake")
else:
    ephem_all = np.fromfile(OUT / "ephem.bin", dtype="<f4").reshape(-1, 6)
    out = OUT
out.mkdir(parents=True, exist_ok=True)
if args.fake_ephem:
    ephem_all.astype("<f4").tofile(out / "ephem.bin")   # real one is written by horizons.py
slices = year_slices(len(ephem_all))
ephem = ephem_all[slices[0][1]:slices[0][2]]   # 2028 only: candidates, refinement, validation
print(f"ephem: {len(ephem_all)} steps, years {[y for y, _, _ in slices]}; candidates on {slices[0][0]}")

m = compute_metrics(grid["lat"], grid["lon"], grid["elev_m"], masks, ephem, h_obs=H_OBS)
print(f"metrics: done ({time.time() - t0:.0f}s), median sun {np.nanmedian(m[:, 0]):.1f}%")

grid = sample_terrain_layers(grid, near_crs=near.crs)   # level 0; the ranking needs slope/PSR

sites_raw = ROOT / "data/raw/sites_raw.json"
parents = None
if args.refine_ranking:
    rank_p = ranking_parents(grid, m)
    site_p = np.array([], np.int64)
    if sites_raw.exists():
        enriched = enrich_sites(json.loads(sites_raw.read_text(encoding="utf-8")), grid, fwd)
        id_to_idx = {int(g): i for i, g in enumerate(grid["id"])}
        site_p = np.array([id_to_idx[s["nearest_candidate_id"]] for s in enriched
                           if s["nearest_candidate_id"] is not None], np.int64)
    parents = np.union1d(rank_p, site_p)
    print(f"refine parents: {len(rank_p)} from ranking, {len(np.unique(site_p))} from sites "
          f"({len(np.setdiff1d(site_p, rank_p))} not already in ranking), total {len(parents)}")
elif args.refine > 0:
    parents = np.argsort(-m[:, 0])[:args.refine]

if parents is not None:
    # Level-1 masks are not cached: the parent set depends on the metrics of this run
    fine = refine_grid(grid, parents, near, far, inv)
    fine_masks, _ = compute_masks(fine["lat"], fine["lon"], near, far, fwd, H_OBS)
    fine_m = compute_metrics(fine["lat"], fine["lon"], fine["elev_m"], fine_masks, ephem, h_obs=H_OBS)
    fine = sample_terrain_layers(fine, near_crs=near.crs)   # same keys as grid for merge_grids
    print(f"refine: {len(fine['id'])} level-1 points, best sun {fine_m[:, 0].max():.1f}% "
          f"(level 0 best {m[:, 0].max():.1f}%)")
    grid = merge_grids(grid, fine)
    masks = np.vstack([masks, fine_masks])
    m = np.vstack([m, fine_m])

order = np.argsort(-m[:, 0])[:5]
for i in order:
    print(f"top sun {m[i, 0]:.1f}% at lat {grid['lat'][i]:.2f}, lon {grid['lon'][i]:.1f}")
dark = (m[:, 0] == 0) & (m[:, 2] == 0)
print(f"sun=0 and earth=0: {dark.sum()} points; lowest mask value there, median "
      f"{np.median(masks[dark].min(axis=1)) / 100:.1f} deg")

idx = pick_validation_points(m)
write_validation(out / "validation.json",
                 build_validation(idx, grid["id"], grid["lat"], grid["lon"],
                                  grid["elev_m"], masks, ephem, h_obs=H_OBS))

# Per-year metrics on the final grid (level 0 + 1), same row order as candidates.bin
by_year = np.stack([compute_metrics(grid["lat"], grid["lon"], grid["elev_m"], masks,
                                    ephem_all[s:e], h_obs=H_OBS) for _, s, e in slices], axis=1)
# longest_* (cols 1, 3): runs found on the full series, so a night across Jan 1 isn't cut in two
runs = longest_by_year(grid["lat"], grid["lon"], grid["elev_m"], masks, ephem_all,
                       [s for _, s, _ in slices], [e for _, _, e in slices], h_obs=H_OBS, t0=T0)
year_h = np.array([e - s for _, s, e in slices], np.float64)   # 1 h steps: 8760 or 8784
by_year[:, :, 1] = np.minimum(runs[:, :, 0], year_h)          # cap: = year length means dark all year
by_year[:, :, 3] = np.minimum(runs[:, :, 1], year_h)
# cols 4-6: power_track_wm2, power_fixed_wm2, power_fixed_az_deg (same pass as longest_*)
by_year = np.concatenate([by_year, runs[:, :, 2:5]], axis=2)
by_year.astype("<f4").tofile(out / "metrics_by_year.bin")
years = [y for y, _, _ in slices]
print(f"metrics_by_year: {by_year.shape}, max |2028 - candidates| (sun_pct, earth_pct) = "
      f"{np.nanmax(np.abs(by_year[:, 0, [0, 2]] - m[:, [0, 2]])):.2g}")
for k, y in enumerate(years):
    lit = by_year[:, k, 0] > 10
    print(f"  {y}: median sun {np.nanmedian(by_year[:, k, 0]):.2f}%, "
          f"median power_track {np.median(by_year[lit, k, 4]):.1f} W/m2 ({lit.sum()} points with sun > 10%)")
b = int(np.argmax(by_year[:, 0, 0]))
print(f"best 2028 point (id {grid['id'][b]}): track {by_year[b, 0, 4]:.1f} W/m2, "
      f"fixed {by_year[b, 0, 5]:.1f} W/m2 facing A = {by_year[b, 0, 6]:.1f} deg")
excess = by_year[:, :, 5] - by_year[:, :, 4]
print(f"power_fixed <= power_track everywhere: {bool((excess <= 1e-9 * by_year[:, :, 4]).all())} "
      f"(max fixed - track {excess.max():.3g} W/m2); "
      f"az NaN exactly where fixed == 0: {bool((np.isnan(by_year[:, :, 6]) == (by_year[:, :, 5] == 0)).all())}")
vtext = (out / "validation.json").read_text()
vrec = json.loads(vtext, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
row = {int(g): i for i, g in enumerate(grid["id"])}
vpw = np.array([[np.nan if r[c] is None else r[c] for c in
                 ["power_track_wm2", "power_fixed_wm2", "power_fixed_az_deg"]] for r in vrec], np.float32)
bpw = by_year[[row[r["id"]] for r in vrec], 0, 4:7].astype(np.float32)
print(f"validation.json: no bare NaN: {'NaN' not in vtext}; power identical to metrics_by_year 2028: "
      f"{np.array_equal(vpw, bpw, equal_nan=True)}")

# Writers (friend). Skipped with a message until they exist.
for name, call in [
    ("write_candidates", lambda f: f(out, grid, m)),
    ("write_masks",      lambda f: f(out, grid, masks)),
    ("write_meta",       lambda f: f(out, grid, len(ephem_all), near.crs, H_OBS, years=years)),
    ("write_meta",       lambda f: f(out, grid, len(ephem_all), near.crs, H_OBS, args.fake_ephem, years=years)),
]:
    if hasattr(writers, name):
        call(getattr(writers, name))
    else:
        print(f"skip: writers.{name} not written yet")


from PIL import Image
# Quick look: one pixel per grid point (grid is regular, 2 km spacing). North-up as on the map.
ix = np.round((grid["x_m"] - grid["x_m"].min()) / 2000).astype(int)
iy = np.round((grid["y_m"].max() - grid["y_m"]) / 2000).astype(int)   # image rows go down
for col, name in [(0, "sun"), (2, "earth")]:
    img = np.zeros((iy.max() + 1, ix.max() + 1), np.uint8)
    img[iy, ix] = np.clip(m[:, col] * 2.55, 0, 255).astype(np.uint8)  # 0-100% -> 0-255
    Image.fromarray(img).resize((img.shape[1] * 4, img.shape[0] * 4), Image.NEAREST) \
        .save(out / f"preview_{name}.png")

if sites_raw.exists():
    process_sites_file(sites_raw, out / "sites.json", grid, near.crs)
else:
    print("skip: sites_raw.json not delivered yet")

print(f"done in {time.time() - t0:.0f}s -> {out}")