"""Mask sanity test + timing. Run: python engine/tools/test_masks.py

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from dem import Dem, DEM_NEAR, DEM_FAR, make_transformers, local_north_east
from masks import compute_masks

near, far = Dem(DEM_NEAR), Dem(DEM_FAR)
fwd, inv = make_transformers(near.crs)

# Shackleton floor + a rim point 10 km "north" of it
lat0, lon0 = -89.67, 129.8
x, y = fwd.transform(lon0, lat0)
n, _ = local_north_east(fwd, lat0, lon0)
lon_r, lat_r = inv.transform(x + 10_000 * n[0], y + 10_000 * n[1])

t = time.time()
m, elev = compute_masks(np.array([lat0, lat_r]), np.array([lon0, lon_r]), near, far, fwd)
print(f"first run incl. compile: {time.time() - t:.1f}s")
for name, row, h in zip(["floor", "rim"], m, elev):
    deg = row / 100
    print(f"{name}: elev {h:.0f} m, mask min {deg.min():.2f} mean {deg.mean():.2f} max {deg.max():.2f}")

rng = np.random.default_rng(0)
lats, lons = rng.uniform(-89.5, -85, 100), rng.uniform(-180, 180, 100)
t = time.time()
compute_masks(lats, lons, near, far, fwd)
dt = time.time() - t
print(f"100 points: {dt:.1f}s -> 18k points ~ {dt * 180 / 60:.0f} min")

row = m[1] / 100
print("rim max at az", row.argmax() * 0.5, "min at az", row.argmin() * 0.5)
for km in (11, 12, 13, 14):
    lo, la = inv.transform(x + km * 1000 * n[0], y + km * 1000 * n[1])
    mm, ee = compute_masks(np.array([la]), np.array([lo]), near, far, fwd)
    print(f"{km} km: elev {ee[0]:.0f} m, mask mean {mm[0].mean() / 100:.2f}")