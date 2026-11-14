"""Print DEM CRS and run the Shackleton test (to be written)."""
"""Sanity checks for the DEMs. Run: python engine/tools/check_dem.py"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from dem import Dem, DEM_NEAR, DEM_FAR, sample, make_transformers, local_north_east

near, far = Dem(DEM_NEAR), Dem(DEM_FAR)
print("same CRS:", near.crs == far.crs)
print("near:", near.h.shape, near.dx, "far:", far.h.shape, far.dx)

fwd, _ = make_transformers(near.crs)
lat, lon = -89.67, 129.8                      # Shackleton centre
x, y = fwd.transform(lon, lat)
n, e = local_north_east(fwd, lat, lon)
print("north", n, "east", e, "dot", float(n @ e))   # dot should be ~0

centre = sample(*near.params(), x, y)
print("Shackleton floor h:", centre)
for name, v in [("N", n), ("E", e), ("S", -n), ("W", -e)]:
    xr, yr = x + 10_000 * v[0], y + 10_000 * v[1]  # 10 km out = roughly the rim
    print(f"  {name} rim h:", sample(*near.params(), xr, yr))