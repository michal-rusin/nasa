"""How much do individual points change between years? Run: python engine/tools/check_years.py"""
import json
from pathlib import Path
import numpy as np

out = Path(__file__).resolve().parents[2] / "data/out/v1"
meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
mb = meta["metrics_by_year"]
years = mb["years"]
y = np.fromfile(out / mb["file"], "<f4").reshape(-1, len(years), len(mb["columns"]))
sun, night = y[:, :, 0], y[:, :, 1]
lit = sun.mean(axis=1) > 10                                    # ignore always-dark points
for name, arr in [("sun_pct", sun[lit]), ("longest_night_h", night[lit])]:
    spread = arr.max(axis=1) - arr.min(axis=1)
    print(f"{name}: per-point spread across years, median {np.median(spread):.1f}, "
          f"90th percentile {np.percentile(spread, 90):.1f}, max {spread.max():.1f}")
i = int(np.argmax(sun[:, 0]))                                  # best point of 2028
print("best 2028 point, sun % per year:", np.round(sun[i], 1))
print("best 2028 point, longest night (days) per year:", np.round(night[i] / 24, 1))

spread = night.max(axis=1) - night.min(axis=1)
cand = np.where(sun.mean(axis=1) > 30)[0]                     # only spots worth landing on
for i in cand[np.argsort(-spread[cand])][:5]:
    print(f"point {i}: sun {sun[i].mean():.0f}% avg, longest night by year (days): "
          f"{np.round(night[i] / 24, 1)}")