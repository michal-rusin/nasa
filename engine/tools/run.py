"""Pipeline entry point (to be written)."""
"""Engine pipeline: grid -> masks -> metrics -> validation -> files.
Run: python engine/tools/run.py [--n 100] [--fake-ephem]"""
import sys, time, argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from dem import Dem, DEM_NEAR, DEM_FAR, make_transformers, ROOT
from grid import build_grid, subsample
from masks import compute_masks
from metrics import compute_metrics
from validation import pick_validation_points, build_validation, write_validation
import writers

H_OBS = 2.0                                   # observer_height_m, same value everywhere
OUT = ROOT / "data/out/v1"
CACHE = ROOT / "data/cache"

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=0, help="random subsample of N points (0 = full grid)")
ap.add_argument("--fake-ephem", action="store_true", help="TEST ONLY, never delivered")
args = ap.parse_args()

t0 = time.time()
near, far = Dem(DEM_NEAR), Dem(DEM_FAR)
fwd, inv = make_transformers(near.crs)
grid = build_grid(near, far, fwd, inv)
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
    ephem = fake_ephem()
    out = ROOT / "data/mock/engine_fake"
    print("WARNING: FAKE EPHEMERIS, output goes to data/mock/engine_fake")
else:
    ephem = np.fromfile(OUT / "ephem.bin", dtype="<f4").reshape(-1, 6)
    out = OUT
out.mkdir(parents=True, exist_ok=True)
if args.fake_ephem:
    ephem.astype("<f4").tofile(out / "ephem.bin")   # real one is written by horizons.py

m = compute_metrics(grid["lat"], grid["lon"], grid["elev_m"], masks, ephem, h_obs=H_OBS)
print(f"metrics: done ({time.time() - t0:.0f}s), median sun {np.nanmedian(m[:, 0]):.1f}%")

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

# Writers (friend). Skipped with a message until they exist.
for name, call in [
    ("write_candidates", lambda f: f(out, grid, m)),
    ("write_masks",      lambda f: f(out, grid, masks)),
    ("write_meta",       lambda f: f(out, grid, len(ephem), near.crs, H_OBS)),
    ("write_meta",       lambda f: f(out, grid, len(ephem), near.crs, H_OBS, args.fake_ephem)),
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


print(f"done in {time.time() - t0:.0f}s -> {out}")