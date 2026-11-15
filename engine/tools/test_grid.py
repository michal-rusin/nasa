"""Grid sanity check. Run: python engine/tools/test_grid.py

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from dem import Dem, DEM_NEAR, DEM_FAR, make_transformers
from grid import build_grid

near, far = Dem(DEM_NEAR), Dem(DEM_FAR)
fwd, inv = make_transformers(near.crs)
print("map origin is at lat:", inv.transform(0.0, 0.0)[1])     # must be -90
t = time.time()
g = build_grid(near, far, fwd, inv)
print(f"{len(g['id'])} points in {time.time() - t:.1f}s")
print("lat", g["lat"].min(), g["lat"].max(), "| lon", g["lon"].min(), g["lon"].max())
print("elev", g["elev_m"].min(), g["elev_m"].max(), "| unique ids:", len(np.unique(g["id"])) == len(g["id"]))