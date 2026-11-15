"""Check sites.json and dist_psr_km in the delivered files. Run: python engine/tools/check_sites.py

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from dem import ROOT

out = ROOT / "data/out/v1"
sites = json.loads((out / "sites.json").read_text(encoding="utf-8"))
print(f"{len(sites)} sites:")
for s in sites:
    print(f"  {s['id']:28s} {s['category']:13s} lat {s['lat']:8.3f}  "
          f"cand {str(s['nearest_candidate_id']):>8s}  dist {str(s['nearest_candidate_dist_km']):>6s} km  "
          f"{(s.get('note') or '')[:40]}")

meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
cols = meta["candidates"]["columns"]
c = np.fromfile(out / "candidates.bin", "<f4").reshape(-1, len(cols))
col = lambda name: c[:, cols.index(name)]
sun, psr = col("sun_pct"), col("dist_psr_km")

dark = sun == 0
print(f"\nmedian dist_psr_km: sun_pct == 0 -> {np.nanmedian(psr[dark]):.2f} km ({dark.sum()} points), "
      f"others -> {np.nanmedian(psr[~dark]):.2f} km ({(~dark).sum()} points)")
print(f"dist_psr_km: {np.isnan(psr).sum()} NaN, {(psr == 0.0).sum()} exactly 0.0 (of {len(psr)})")
