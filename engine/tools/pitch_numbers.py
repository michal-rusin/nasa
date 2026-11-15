"""Headline numbers for the pitch, read from the delivered files. Run: python engine/tools/pitch_numbers.py

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from pyproj import CRS
from dem import ROOT, make_transformers

out = ROOT / "data/out/v1"
meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
cols = meta["candidates"]["columns"]
c = np.fromfile(out / "candidates.bin", "<f4").reshape(-1, len(cols))
col = lambda name: c[:, cols.index(name)]                     # read columns by name, like Michał
sun, earth, night = col("sun_pct"), col("earth_pct"), col("longest_night_h")
lvl0 = col("level") == 0   # region stats: regular 2 km grid only
fwd, _ = make_transformers(CRS.from_wkt(meta["raster_crs_wkt"]))

print(f"{len(c)} candidate points, 84-90°S, every 2 km, year 2028 hourly")
print(f"  < 10% sunlight: {np.mean(sun[lvl0] < 10) * 100:.0f}% of the region")
print(f"  never see Earth: {np.mean(earth[lvl0] == 0) * 100:.0f}%   |   dark all year: {np.mean(sun[lvl0] == 0) * 100:.0f}%")

print("\nTop 5 sunniest points:")
for i in np.argsort(-sun)[:5]:
    print(f"  {sun[i]:.1f}% sun, {earth[i]:.1f}% Earth, longest night {night[i] / 24:.1f} days"
          f"  @ {col('lat')[i]:.2f}, {col('lon')[i]:.1f}")


def nearest(lat, lon):
    x, y = fwd.transform(lon, lat)
    d = np.hypot(col("x_m") - x, col("y_m") - y)
    return int(np.argmin(d)), d.min() / 1000


i, dkm = nearest(-84.7906, 29.1957)
print(f"\nIM-2 landing site (nearest point {dkm:.1f} km): {sun[i]:.1f}% sun, "
      f"{earth[i]:.1f}% Earth, longest night {night[i] / 24:.1f} days")

# Same crater, different rim: points 10-14 km from Shackleton's centre that get decent sun
x0, y0 = fwd.transform(129.8, -89.67)
r = np.hypot(col("x_m") - x0, col("y_m") - y0) / 1000
rim = (r > 10) & (r < 14) & (sun > 30)
if rim.any():
    print(f"\nShackleton rim, {rim.sum()} sunlit points: Earth visibility from "
          f"{earth[rim].min():.0f}% to {earth[rim].max():.0f}%")