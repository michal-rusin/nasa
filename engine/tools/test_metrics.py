"""Metrics test with a FAKE ephemeris. Run: python engine/tools/test_metrics.py"""
import sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np
from dem import Dem, DEM_NEAR, DEM_FAR, make_transformers, local_north_east
from masks import compute_masks
from metrics import compute_metrics


def u(lat_deg, lon_deg):
    la, lo = np.radians(lat_deg), np.radians(lon_deg)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)


def fake_ephem(n_steps=8760):
    """FAKE: simplified Sun/Earth motion in the ephem.bin layout. Testing only."""
    d = np.arange(n_steps) / 24.0                                   # days
    sun_lat = 1.54 * np.sin(2 * np.pi * d / 346.6)                  # seasons
    sun_lon = (-360.0 * d / 29.53 + 180) % 360 - 180                # Sun moves west
    earth_lat = 6.68 * np.sin(2 * np.pi * d / 27.21)                # libration up/down
    earth_lon = 7.9 * np.sin(2 * np.pi * d / 27.55)                 # libration sideways
    return np.hstack([u(sun_lat, sun_lon), 384_400.0 * u(earth_lat, earth_lon)]).astype(np.float32)


near, far = Dem(DEM_NEAR), Dem(DEM_FAR)
fwd, inv = make_transformers(near.crs)
ephem = fake_ephem()

lat0, lon0 = -89.67, 129.8                    # Shackleton floor
x, y = fwd.transform(lon0, lat0)
n, _ = local_north_east(fwd, lat0, lon0)
lon_r, lat_r = inv.transform(x + 12_000 * n[0], y + 12_000 * n[1])   # rim crest
lats, lons = np.array([lat0, lat_r]), np.array([lon0, lon_r])

masks, elev = compute_masks(lats, lons, near, far, fwd)
m = compute_metrics(lats, lons, elev, masks, ephem)
for name, row in zip(["floor", "rim"], m):
    print(f"{name}: sun {row[0]:.1f}%, longest night {row[1]:.0f} h, "
          f"earth {row[2]:.1f}%, longest comm gap {row[3]:.0f} h")

rng = np.random.default_rng(0)
lats, lons = rng.uniform(-89.5, -85, 100), rng.uniform(-180, 180, 100)
masks, elev = compute_masks(lats, lons, near, far, fwd)
compute_metrics(lats, lons, elev, masks, ephem)        # warm-up (compile)
t = time.time()
compute_metrics(lats, lons, elev, masks, ephem)
dt = time.time() - t
print(f"metrics 100 points: {dt:.2f}s -> 18k ~ {dt * 180:.0f} s")

from metrics import series_one, enu, mask_at
U, E, N, P = enu(np.array([lat_r]), np.array([lon_r]), elev[:0] if False else
                 compute_masks(np.array([lat_r]), np.array([lon_r]), near, far, fwd)[1])
mk = compute_masks(np.array([lat_r]), np.array([lon_r]), near, far, fwd)[0][0]
e = ephem.astype(np.float64)
for t in range(0, 24 * 28, 24 * 2):       # every 2 days over one month
    v = e[t, 3:] - P[0]
    el = np.degrees(np.arcsin(v @ U[0] / np.linalg.norm(v)))
    az = np.degrees(np.arctan2(v @ E[0], v @ N[0])) % 360
    print(f"day {t // 24:2d}: earth el {el:5.2f}, az {az:6.1f}, mask there {mask_at(mk, az):5.2f}")

# second rim point, on the Earth-facing side of the crater
lon_n, lat_n = inv.transform(x - 12_000 * n[0], y - 12_000 * n[1])
mm, ee = compute_masks(np.array([lat_n]), np.array([lon_n]), near, far, fwd)
print("near-side rim:", compute_metrics(np.array([lat_n]), np.array([lon_n]), ee, mm, ephem)[0])