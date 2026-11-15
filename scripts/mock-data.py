#!/usr/bin/env python3
"""Test data generator for the frontend (Lunar Landing Site Navigator).

Writes the complete file set from docs/contracts.md (v1) with SYNTHETIC but
internally consistent data: metrics in candidates.bin and validation.json use
the physics from contract sections 1.2 and 2 with synthetic masks and ephemerides.
The script is a reference for porting physics to TypeScript ("my JS physics == data
from the generator").

Dependencies: numpy and Pillow only.

    python scripts/mock-data.py [--out DIR] [--lat-min -84] [--seed 42] [--layer-px 1024]

NOTE ON --lat-min: latitude of the outer grid edge (the grid
covers -90..lat_min). In meta.json this is region {lat_min: -90, lat_max: <arg>},
as in the example in contract section 4.

Results are deterministic for the same --seed (including file bytes).
Therefore generated_utc defaults to a CONSTANT (--generated-utc), not the clock.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

# --------------------------------------------------------------------------- #
# Contract constants
# --------------------------------------------------------------------------- #
R_KM = 1737.4                    # moon_radius_km
R_M = R_KM * 1000.0
GRID_STEP_M = 2000.0             # level 0 grid
OBSERVER_HEIGHT_M = 2.0
MASK_MIN_DIST_M = 120
SUN_RADIUS_DEG = 0.2666
NIGHT_THRESHOLD = 0.01
STEP_S = 3600
# 2028 is a leap year (366 days). The ONLY source of the step count.
N_STEPS = 8784
T0_UTC = "2028-01-01T00:00:00Z"
MASK_SAMPLES = 720
MASK_STEP_DEG = 0.5
MASK_SCALE = 0.01
MASK_REC_BYTES = MASK_SAMPLES * 2          # 1440 B
TILES = 8
LAYER_PX = 1024
LAYER_HALF_M = 185000.0                    # bounds_m = square ±185000 m (contract 5.2)
COLUMNS = ["id", "lat", "lon", "x_m", "y_m", "elev_m", "level",
           "sun_pct", "longest_night_h", "earth_pct", "longest_comm_gap_h",
           "slope_deg", "dist_psr_km"]
PROJ_STRING = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m"
DEFAULT_GENERATED_UTC = "2026-11-14T00:00:00Z"
MASK_MIN_DEG, MASK_MAX_DEG = -3.0, 7.0     # mask range [deg]
# Horizon base tuning (deg): ridge, background depression floor, crater interior.
RIDGE_DEG, FLOOR_DEG, CRATER_DEG = -2.0, 5.0, 6.0
CHUNK = 256                                # points per physics batch


# --------------------------------------------------------------------------- #
# South polar stereographic projection
# --------------------------------------------------------------------------- #
# NOTE: this convention is ONLY for mocks (true scale at the pole, sphere R).
# The real engine computes x_m, y_m with pyproj using the DEM CRS (contract 1.3),
# not a custom formula. The mock has no DEM and must assume a projection.
def lat_to_rho(lat_rad):
    """rho [m] for latitude (rad, negative): rho = 2R tan(pi/4 + lat/2)."""
    return 2.0 * R_M * np.tan(np.pi / 4.0 + np.asarray(lat_rad) / 2.0)


def xy_to_latlon(x, y):
    """(x, y) [m] -> (lat, lon) in DEGREES, lon in [-180, 180)."""
    rho = np.hypot(x, y)
    lat = 2.0 * np.arctan(rho / (2.0 * R_M)) - np.pi / 2.0
    lon = np.degrees(np.arctan2(x, y))
    lon = (lon + 180.0) % 360.0 - 180.0
    return np.degrees(lat), lon


def latlon_to_xy(lat_deg, lon_deg):
    rho = lat_to_rho(np.radians(lat_deg))
    lon = np.radians(lon_deg)
    return rho * np.sin(lon), rho * np.cos(lon)


# --------------------------------------------------------------------------- #
# Synthetic terrain (x, y [m] functions; parameters from the seed)
# --------------------------------------------------------------------------- #
class Terrain:
    def __init__(self, rng: np.random.Generator):
        # Craters: (rho_km from pole, radius_km, depth_m). The first lies at
        # ~89.7°S (rho ~9 km). Angle and small parameter variations come from the seed.
        polar_rho_km = float(lat_to_rho(np.radians(-89.7))) / 1000.0
        specs = [(polar_rho_km, 6.0, 2200.0),
                 (24.0, 4.0, 1500.0),
                 (55.0, 15.0, 3000.0),
                 (90.0, 10.0, 2400.0),
                 (125.0, 12.0, 2700.0)]
        cx, cy, cr, cd = [], [], [], []
        for rho_km, r_km, depth in specs:
            ang = rng.uniform(0, 2 * np.pi)
            rho = rho_km * 1000.0 * rng.uniform(0.92, 1.08)
            cx.append(rho * np.cos(ang))
            cy.append(rho * np.sin(ang))
            cr.append(r_km * 1000.0 * rng.uniform(0.92, 1.08))
            cd.append(depth)
        self.cx, self.cy = np.array(cx), np.array(cy)
        self.cr, self.cd = np.array(cr), np.array(cd)
        self.biggest = int(np.argmax(self.cr))

        # Background +-1500 m: four plane waves (amplitudes sum to 1500).
        self.bg_amp = np.array([600.0, 450.0, 300.0, 150.0])
        th = rng.uniform(0, 2 * np.pi, 4)
        wl = rng.uniform(40e3, 150e3, 4)
        self.bg_k = np.stack([np.cos(th), np.sin(th)], axis=1) * (2 * np.pi / wl)[:, None]
        self.bg_ph = rng.uniform(0, 2 * np.pi, 4)
        # Terrain and slope noise (constant, no RNG at call time).
        self.nz_ph = rng.uniform(0, 2 * np.pi, 4)
        # Horizon component parameters: position-dependent phase.
        self.hz_c = rng.uniform(0, 2 * np.pi, 3)
        self.hz_lx = rng.uniform(25e3, 60e3, 3)
        self.hz_ly = rng.uniform(25e3, 60e3, 3)

    # --- auxiliary fields --------------------------------------------------- #
    def _dists(self, x, y):
        return [np.hypot(x - self.cx[i], y - self.cy[i]) for i in range(len(self.cr))]

    def background(self, x, y):
        out = np.zeros(np.shape(x))
        for a, k, p in zip(self.bg_amp, self.bg_k, self.bg_ph):
            out = out + a * np.sin(x * k[0] + y * k[1] + p)
        return out

    def elev(self, x, y):
        e = self.background(x, y)
        for i, d in enumerate(self._dists(x, y)):
            r, depth = self.cr[i], self.cd[i]
            u = d / r
            e = e - depth * np.where(u < 1.0, 1.0 - u * u, 0.0)       # floor
            e = e + 0.12 * depth * np.exp(-(((d - r) / (0.12 * r)) ** 2))  # rim
        e = e + 25.0 * np.sin(x / 2300.0 + self.nz_ph[0]) * np.sin(y / 1900.0 + self.nz_ph[1])
        return e

    def slope(self, x, y):
        s = 1.5 + 2.5 * np.abs(np.sin(x / 7300.0 + self.nz_ph[2])
                               * np.cos(y / 6100.0 + self.nz_ph[3]))
        for i, d in enumerate(self._dists(x, y)):
            r = self.cr[i]
            s = s + 21.0 * np.exp(-(((d - r) / (0.22 * r)) ** 2))
        return np.clip(s, 0.0, 25.0)

    def dist_psr_km(self, x, y):
        best = None
        for i, d in enumerate(self._dists(x, y)):
            v = np.maximum(0.0, d - self.cr[i]) / 1000.0
            best = v if best is None else np.minimum(best, v)
        return best

    def in_psr(self, x, y):
        m = np.zeros(np.shape(x), dtype=bool)
        for i, d in enumerate(self._dists(x, y)):
            m |= d < self.cr[i]
        return m

    def crater_weight(self, x, y):
        """1 inside the crater, fading outside the rim (0..1)."""
        w = np.zeros(np.shape(x))
        for i, d in enumerate(self._dists(x, y)):
            r = self.cr[i]
            wi = np.where(d < r, 1.0, np.exp(-(((d - r) / (0.35 * r)) ** 2)))
            w = np.maximum(w, wi)
        return w

    # --- horizon masks --------------------------------------------------- #
    def horizon_base_deg(self, x, y):
        """Continuous horizon base [deg] as a function of position.

        Outside craters: ridge (t -> 1) near RIDGE_DEG, flat (t ~ 0.5) near 0,
        depressions (t -> 0) at FLOOR_DEG. On crater slopes it smoothly rises to
        CRATER_DEG (weight w = 1 inside the crater, fading beyond the rim).
        """
        w = self.crater_weight(x, y)
        t = np.clip((self.background(x, y) + 1500.0) / 3000.0, 0.0, 1.0)  # 1 = ridge
        outside = np.interp(t, [0.0, 0.25, 0.5, 0.75, 1.0],
                            [FLOOR_DEG, 0.5 * FLOOR_DEG, 0.0, 0.6 * RIDGE_DEG, RIDGE_DEG])
        return outside * (1.0 - w) + CRATER_DEG * w, w

    def horizon_masks(self, x, y, rng: np.random.Generator):
        """(n, 720) int16, hundredths of a degree, azimuth k*0.5 deg (convention 1.2).

        Base (continuous position function) + 3 sinusoidal azimuth components
        with point-dependent phase + slight noise. Range [-3, 7] deg (signed
        int16). Negative horizon = point elevated above its surroundings.
        """
        n = len(x)
        base, w = self.horizon_base_deg(x, y)
        az = np.radians(np.arange(MASK_SAMPLES) * MASK_STEP_DEG)[None, :]
        amps = [0.25 + 1.1 * w, 0.15 + 0.7 * w, 0.10 + 0.4 * w]
        h = base[:, None]
        for k in range(3):
            ph = self.hz_c[k] + x / self.hz_lx[k] + y / self.hz_ly[k]
            h = h + amps[k][:, None] * np.sin((k + 1) * az + ph[:, None])
        h = h + rng.normal(0.0, 0.05, size=(n, MASK_SAMPLES))
        h = np.clip(h, MASK_MIN_DEG, MASK_MAX_DEG)
        return np.round(h * 100.0).astype('<i2')


# --------------------------------------------------------------------------- #
# Ephemerides (plausible mock)
# --------------------------------------------------------------------------- #
def u_vec(lat, lon):
    cl = np.cos(lat)
    return np.stack([cl * np.cos(lon), cl * np.sin(lon), np.sin(lat)], axis=-1)


def make_ephem(alpha0: float):
    """(n_steps, 6) float32: sun_dir_xyz, earth_xyz [km]. Contract 3.3."""
    t_d = np.arange(N_STEPS) * (STEP_S / 86400.0)           # days since t0
    alpha = alpha0 - 2 * np.pi * t_d / 29.530589
    delta = np.radians(1.54) * np.sin(2 * np.pi * t_d / 346.62)
    sun = np.stack([np.cos(delta) * np.cos(alpha),
                    np.cos(delta) * np.sin(alpha),
                    np.sin(delta)], axis=1)
    lon_e = np.radians(7.9) * np.sin(2 * np.pi * t_d / 27.5546)
    lat_e = np.radians(6.7) * np.sin(2 * np.pi * t_d / 27.2122 + 1.0)
    dist = 384400.0 - 21000.0 * np.cos(2 * np.pi * t_d / 27.5546)
    earth = dist[:, None] * u_vec(lat_e, lon_e)
    return np.concatenate([sun, earth], axis=1).astype('<f4')


# --------------------------------------------------------------------------- #
# Metric physics (contract 1.2, 2.1, 2.2, 2.3), vectorized
# --------------------------------------------------------------------------- #
def enu_basis(lat_deg, lon_deg):
    phi, lam = np.radians(lat_deg), np.radians(lon_deg)
    U = np.stack([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)], axis=1)
    E = np.stack([-np.sin(lam), np.cos(lam), np.zeros_like(lam)], axis=1)
    N = np.stack([-np.sin(phi) * np.cos(lam), -np.sin(phi) * np.sin(lam), np.cos(phi)], axis=1)
    return U, E, N


def mask_height_deg(mask_i16, az_deg):
    """Interpolacja liniowa maski po azymucie (cyklicznie, krok 0.5 deg). (n,T)."""
    pos = (az_deg % 360.0) / MASK_STEP_DEG
    fl = np.floor(pos)
    frac = pos - fl
    i0 = fl.astype(np.int64) % MASK_SAMPLES
    i1 = (i0 + 1) % MASK_SAMPLES
    m = mask_i16.astype(np.float64) * MASK_SCALE
    return (np.take_along_axis(m, i0, axis=1) * (1.0 - frac)
            + np.take_along_axis(m, i1, axis=1) * frac)


def az_el(vE, vN, vU_over_norm):
    az = np.degrees(np.arctan2(vE, vN)) % 360.0           # 0 = N, increasing through E
    el = np.degrees(np.arcsin(np.clip(vU_over_norm, -1.0, 1.0)))
    return az, el


def visibility(lat_deg, lon_deg, elev_m, mask_i16, eph):
    """Returns (f, g): f (n,T) float64 solar disk fraction, g (n,T) bool."""
    sun = eph[:, 0:3].astype(np.float64)
    earth = eph[:, 3:6].astype(np.float64)
    U, E, N = enu_basis(lat_deg, lon_deg)
    r_obs = R_KM + elev_m / 1000.0 + OBSERVER_HEIGHT_M / 1000.0     # |P| in km, P = r*U

    # Sun: direction from the Moon's center, without parallax.
    s_az, s_el = az_el(E @ sun.T, N @ sun.T, U @ sun.T)
    h = mask_height_deg(mask_i16, s_az)
    d = (s_el - h) / SUN_RADIUS_DEG
    dc = np.clip(d, -1.0, 1.0)
    f = (np.arccos(-dc) + dc * np.sqrt(1.0 - dc * dc)) / np.pi
    f = np.where(d <= -1.0, 0.0, np.where(d >= 1.0, 1.0, f))

    # Earth: v = Earth_pos - P, with parallax. Orthonormal basis => P.E = P.N = 0.
    eU = U @ earth.T                                                 # (n,T)
    vU = eU - r_obs[:, None]
    e_norm2 = np.sum(earth * earth, axis=1)[None, :]
    vnorm = np.sqrt(e_norm2 - 2.0 * r_obs[:, None] * eU + r_obs[:, None] ** 2)
    e_az, e_el = az_el(E @ earth.T, N @ earth.T, vU / vnorm)
    g = e_el > mask_height_deg(mask_i16, e_az)
    return f, g


def longest_run(b):
    """Longest True run in each row; an interval without joining endpoints."""
    idx = np.arange(b.shape[1])[None, :]
    last_false = np.maximum.accumulate(np.where(b, -1, idx), axis=1)
    return (idx - last_false).max(axis=1)


def metrics_for(lat, lon, elev, masks, eph):
    n = len(lat)
    out = np.empty((n, 4), dtype=np.float64)
    step_h = STEP_S / 3600.0
    for a in range(0, n, CHUNK):
        sl = slice(a, min(a + CHUNK, n))
        f, g = visibility(lat[sl], lon[sl], elev[sl], masks[sl], eph)
        out[sl, 0] = 100.0 * f.mean(axis=1)
        out[sl, 1] = longest_run(f < NIGHT_THRESHOLD) * step_h
        out[sl, 2] = 100.0 * g.mean(axis=1)
        out[sl, 3] = longest_run(~g) * step_h
    return out


# --------------------------------------------------------------------------- #
# Writing files
# --------------------------------------------------------------------------- #
def write_json(path: Path, obj):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def clean_num(v):
    v = float(v)
    return int(v) if v.is_integer() else v


def write_masks(out: Path, ids, x, y, masks, half):
    mdir = out / "masks"
    mdir.mkdir(parents=True, exist_ok=True)
    for old in mdir.glob("tile_*.bin"):
        old.unlink()
    size = 2.0 * half / TILES
    ti = np.clip(np.floor((x + half) / size).astype(int), 0, TILES - 1)
    tj = np.clip(np.floor((y + half) / size).astype(int), 0, TILES - 1)
    records = {}
    for i in range(TILES):
        for j in range(TILES):
            sel = np.flatnonzero((ti == i) & (tj == j))     # ascending ID order (ID = index)
            if sel.size == 0:
                continue                                    # empty tile: no file
            name = f"tile_{i}_{j}.bin"
            (mdir / name).write_bytes(masks[sel].astype('<i2').tobytes())
            for rec, k in enumerate(sel):
                records[str(int(ids[k]))] = [name, rec]
    write_json(mdir / "index.json", {"samples": MASK_SAMPLES, "step_deg": MASK_STEP_DEG,
                                     "scale": MASK_SCALE, "dtype": "int16",
                                     "records": records})
    return records


def pixel_centers():
    px = 2.0 * LAYER_HALF_M / LAYER_PX
    c = -LAYER_HALF_M + (np.arange(LAYER_PX) + 0.5) * px
    X, Y = np.meshgrid(c, c[::-1])        # row 0 = top = max_y
    return X, Y, px


def lerp_cmap(t, stops):
    t = np.clip(t, 0.0, 1.0)
    pos = [s[0] for s in stops]
    return np.stack([np.interp(t, pos, [s[1][ch] for s in stops]) for ch in range(3)], axis=-1)


def write_layers(out: Path, terrain: Terrain, x, y, sun_pct, rho_max):
    ldir = out / "layers"
    ldir.mkdir(parents=True, exist_ok=True)
    X, Y, px = pixel_centers()
    rho = np.hypot(X, Y)
    in_region = rho <= rho_max

    # basemap: gray relief + latitude circles every 1° + meridians every 30°
    g = np.clip(150.0 + 0.025 * terrain.elev(X, Y), 40.0, 230.0)
    g = np.where(in_region, g, g * 0.8)
    line = np.zeros(X.shape, dtype=bool)
    for lat in range(-89, -80):
        rk = float(lat_to_rho(np.radians(lat)))
        line |= np.abs(rho - rk) < 0.75 * px
    lon = np.degrees(np.arctan2(X, Y))
    dm = np.abs(((lon + 15.0) % 30.0) - 15.0)              # angular distance to a 30° meridian
    line |= rho * np.sin(np.radians(dm)) < 0.75 * px
    gray = np.where(line, 245.0, g).astype(np.uint8)
    Image.fromarray(np.stack([gray] * 3, axis=-1), "RGB").save(ldir / "basemap.png")

    # slope: colored, alpha increases with slope, transparent outside the region
    sl = terrain.slope(X, Y)
    rgb = lerp_cmap(sl / 25.0, [(0.0, (60, 180, 75)), (0.5, (240, 220, 60)), (1.0, (215, 50, 40))])
    a = np.where(in_region, 80.0 + 175.0 * np.clip(sl / 25.0, 0, 1), 0.0)
    Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), "RGBA").save(ldir / "slope.png")

    # illumination: pixel -> nearest 2 km grid cell; transparent outside the grid
    K = int(math.ceil(rho_max / GRID_STEP_M)) + 1
    lut = np.full((2 * K + 1, 2 * K + 1), np.nan)
    gi = np.rint(x / GRID_STEP_M).astype(int) + K
    gj = np.rint(y / GRID_STEP_M).astype(int) + K
    lut[gi, gj] = sun_pct
    pi_ = np.rint(X / GRID_STEP_M).astype(int)
    pj_ = np.rint(Y / GRID_STEP_M).astype(int)
    inside = (np.abs(pi_) <= K) & (np.abs(pj_) <= K)
    val = np.full(X.shape, np.nan)
    val[inside] = lut[pi_[inside] + K, pj_[inside] + K]
    lo, hi = float(np.min(sun_pct)), float(np.max(sun_pct))
    rgb = lerp_cmap((val - lo) / max(hi - lo, 1e-9),
                    [(0.0, (15, 15, 60)), (0.5, (150, 55, 130)), (1.0, (255, 235, 120))])
    a = np.where(np.isnan(val), 0.0, 210.0)
    rgb = np.nan_to_num(rgb)
    Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), "RGBA").save(ldir / "illumination.png")

    # psr: translucent mask
    psr = terrain.in_psr(X, Y)
    rgba = np.zeros(X.shape + (4,), dtype=np.uint8)
    rgba[psr] = (70, 150, 255, 140)
    Image.fromarray(rgba, "RGBA").save(ldir / "psr.png")


def great_circle_km(lat1, lon1, lat2, lon2):
    d = np.sum(u_vec(np.radians(lat1), np.radians(lon1)) * u_vec(np.radians(lat2), np.radians(lon2)), axis=-1)
    return R_KM * np.arccos(np.clip(d, -1.0, 1.0))


def make_sites(terrain: Terrain, lat, lon, ids, rho_max):
    """8 [MOCK] sites. Outside the grid (rho > rho_max) => nearest-point fields are null."""
    def at(cx, cy, off_m, ang):
        return xy_to_latlon(cx + off_m * math.cos(ang), cy + off_m * math.sin(ang))

    b = terrain.biggest
    cx, cy, r = terrain.cx[b], terrain.cy[b], terrain.cr[b]
    out_ang = math.atan2(cy, cx)                    # direction outward from the pole
    px_, py_ = terrain.cx[0], terrain.cy[0]
    defs = [
        ("artemis", "Near the largest crater", *at(cx, cy, r + 3000.0, out_ang)),
        ("artemis", "Near the polar crater", *at(px_, py_, terrain.cr[0] + 2500.0, out_ang + 0.6)),
        ("clps", "Plain A", *xy_to_latlon(0.6 * rho_max * math.cos(1.0), 0.6 * rho_max * math.sin(1.0))),
        ("clps", "Plain B", *xy_to_latlon(0.8 * rho_max * math.cos(3.6), 0.8 * rho_max * math.sin(3.6))),
        ("international", "Ridge", *xy_to_latlon(0.4 * rho_max * math.cos(5.0), 0.4 * rho_max * math.sin(5.0))),
        ("apollo", "Historical context", np.float64(-20.0), np.float64(30.0)),
        ("reference", "Reference point 1", *xy_to_latlon(0.9 * rho_max * math.cos(2.2), 0.9 * rho_max * math.sin(2.2))),
        ("reference", "Reference point 2", *xy_to_latlon(0.2 * rho_max * math.cos(0.2), 0.2 * rho_max * math.sin(0.2))),
    ]
    sites = []
    for n, (cat, name, la, lo) in enumerate(defs, 1):
        la, lo = float(la), float(lo)
        sx, sy = latlon_to_xy(la, lo)
        item = {"id": f"mock-{cat}-{n}", "name": f"[MOCK] {name}", "category": cat,
                "lat": round(la, 4), "lon": round(lo, 4),
                "x_m": None, "y_m": None,
                "note": "test data, not a real location",
                "nearest_candidate_id": None, "nearest_candidate_dist_km": None}
        # x_m, y_m in the mock projection (latlon_to_xy); null outside raster bounds.
        if abs(sx) <= LAYER_HALF_M and abs(sy) <= LAYER_HALF_M:
            item["x_m"], item["y_m"] = round(float(sx), 1), round(float(sy), 1)
        if math.hypot(sx, sy) <= rho_max:
            dist = great_circle_km(la, lo, lat, lon)
            k = int(np.argmin(dist))
            item["nearest_candidate_id"] = int(ids[k])
            item["nearest_candidate_dist_km"] = round(float(dist[k]), 3)
        sites.append(item)
    return sites


def pick_validation(sun_pct, earth_pct):
    """4 distinct points: brightest, darkest, median sun_pct, max earth_pct."""
    n = len(sun_pct)
    order_sun = np.argsort(sun_pct, kind="stable")
    cands = [int(order_sun[-1]), int(order_sun[0]), int(order_sun[n // 2]),
             int(np.argsort(earth_pct, kind="stable")[-1])]
    chosen = []
    for k, c in enumerate(cands):
        if c in chosen:   # duplicate: neighbor in the corresponding ranking
            ranking = list(np.argsort(earth_pct, kind="stable")[::-1]) if k == 3 else list(order_sun)
            c = next(int(v) for v in ranking if int(v) not in chosen)
        chosen.append(c)
    return chosen


# --------------------------------------------------------------------------- #
# Main workflow
# --------------------------------------------------------------------------- #
def main():
    global LAYER_PX
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default="web/public/data")
    ap.add_argument("--lat-min", type=float, default=-84.0,
                    help="latitude of the outer grid edge (-84 full ~26k points, -89 small ~700)")
    ap.add_argument("--layer-px", type=int, default=LAYER_PX,
                    help="PNG size in pixels (contract recommends 4096 for real data; mock defaults to 1024)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--generated-utc", default=DEFAULT_GENERATED_UTC,
                    help="constant to keep output bit-for-bit reproducible")
    args = ap.parse_args()
    LAYER_PX = args.layer_px
    if not (-90.0 < args.lat_min < -60.0):
        sys.exit("--lat-min must be in the range (-90, -60)")

    t_start = time.time()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    terrain = Terrain(rng)
    alpha0 = float(rng.uniform(0, 2 * np.pi))
    mask_rng = np.random.default_rng([args.seed, 1])

    # --- grid --------------------------------------------------------------
    rho_max = float(lat_to_rho(np.radians(args.lat_min)))
    K = int(rho_max // GRID_STEP_M)
    ax = np.arange(-K, K + 1) * GRID_STEP_M
    X, Y = np.meshgrid(ax, ax, indexing="ij")
    keep = np.hypot(X, Y) <= rho_max
    x, y = X[keep], Y[keep]                        # order: by x, then y
    n = len(x)
    ids = np.arange(n)
    lat, lon = xy_to_latlon(x, y)
    # Physics uses exactly the values stored as float32 in the file.
    lat = lat.astype(np.float32).astype(np.float64)
    lon = lon.astype(np.float32).astype(np.float64)
    elev = terrain.elev(x, y).astype(np.float32).astype(np.float64)
    slope = terrain.slope(x, y)
    dpsr = terrain.dist_psr_km(x, y)
    print(f"grid: {n} points, rho_max = {rho_max / 1000:.1f} km, seed = {args.seed}")

    # --- masks and ephemerides ---------------------------------------------------
    masks = np.empty((n, MASK_SAMPLES), dtype='<i2')
    for a in range(0, n, CHUNK):
        sl = slice(a, min(a + CHUNK, n))
        masks[sl] = terrain.horizon_masks(x[sl], y[sl], mask_rng)
    eph = make_ephem(alpha0)
    assert eph.shape == (N_STEPS, 6)

    # --- metrics -------------------------------------------------------------
    t_phys = time.time()
    m = metrics_for(lat, lon, elev, masks, eph)
    print(f"physics: {time.time() - t_phys:.1f} s")

    cols = {"id": ids, "lat": lat, "lon": lon, "x_m": x, "y_m": y, "elev_m": elev,
            "level": np.zeros(n), "sun_pct": m[:, 0], "longest_night_h": m[:, 1],
            "earth_pct": m[:, 2], "longest_comm_gap_h": m[:, 3],
            "slope_deg": slope, "dist_psr_km": dpsr}
    arr = np.stack([cols[c].astype(np.float32) for c in COLUMNS], axis=1).astype('<f4')
    arr.tofile(out / "candidates.bin")
    eph.astype('<f4').tofile(out / "ephem.bin")

    # --- masks, rasters, sites, validation, metadata ------------------------------
    write_masks(out, ids, x, y, masks, rho_max)
    write_layers(out, terrain, x, y, arr[:, COLUMNS.index("sun_pct")].astype(np.float64), rho_max)
    sites = make_sites(terrain, lat, lon, ids, rho_max)
    write_json(out / "sites.json", sites)

    sun_c = arr[:, COLUMNS.index("sun_pct")].astype(np.float64)
    earth_c = arr[:, COLUMNS.index("earth_pct")].astype(np.float64)
    vsel = pick_validation(sun_c, earth_c)
    f, g = visibility(lat[vsel], lon[vsel], elev[vsel], masks[vsel], eph)
    validation = [{"id": int(vsel[i]),
                   "sun_f": [round(float(v), 4) for v in f[i]],
                   "earth_g": [int(v) for v in g[i]],
                   "sun_pct": round(float(sun_c[vsel[i]]), 4),
                   "earth_pct": round(float(earth_c[vsel[i]]), 4)} for i in range(len(vsel))]
    write_json(out / "validation.json", validation)

    meta = {
        "contract_version": 1,
        "generated_utc": args.generated_utc,
        "mock": True,
        "moon_radius_km": R_KM,
        "frame": "MOON_ME",
        "ephem_source": "MOCK",
        "abcorr": "MOCK",
        "t0_utc": T0_UTC,
        "step_s": STEP_S,
        "n_steps": N_STEPS,
        "sun_radius_deg": SUN_RADIUS_DEG,
        "night_threshold": NIGHT_THRESHOLD,
        "observer_height_m": OBSERVER_HEIGHT_M,
        "mask_min_dist_m": MASK_MIN_DIST_M,
        "slope_basis": "MOCK",
        "dem_near": "MOCK",
        "dem_far": "MOCK",
        "psr_source": "MOCK",
        "region": {"lat_min": -90, "lat_max": clean_num(args.lat_min)},
        "candidates": {"count": n, "columns": COLUMNS},
        "raster_crs_wkt": PROJ_STRING,
        "raster_proj4": PROJ_STRING,
        "layers": {
            "bounds_m": {"min_x": -int(LAYER_HALF_M), "min_y": -int(LAYER_HALF_M),
                         "max_x": int(LAYER_HALF_M), "max_y": int(LAYER_HALF_M)},
            "files": {"basemap": "layers/basemap.png", "slope": "layers/slope.png",
                      "illumination": "layers/illumination.png", "psr": "layers/psr.png"},
        },
    }
    write_json(out / "meta.json", meta)

    ok = self_check(out, n, arr, meta)
    print(f"\nruntime: {time.time() - t_start:.1f} s")
    if not ok:
        sys.exit(1)


# --------------------------------------------------------------------------- #
# Self-check
# --------------------------------------------------------------------------- #
def self_check(out: Path, n: int, arr: np.ndarray, meta: dict) -> bool:
    errors, warnings = [], []
    cb = out / "candidates.bin"
    if cb.stat().st_size != n * len(COLUMNS) * 4:
        errors.append(f"candidates.bin: {cb.stat().st_size} B != {n}*{len(COLUMNS)}*4")
    else:
        back = np.fromfile(cb, dtype='<f4').reshape(n, len(COLUMNS))
        if not np.array_equal(back, arr, equal_nan=True):
            errors.append("candidates.bin: readback differs from written data")

    tiles = sorted((out / "masks").glob("tile_*.bin"))
    nrec = 0
    for t in tiles:
        s = t.stat().st_size
        if s % MASK_REC_BYTES:
            errors.append(f"{t.name}: size {s} is not a multiple of {MASK_REC_BYTES}")
        nrec += s // MASK_REC_BYTES
    idx = json.loads((out / "masks" / "index.json").read_text(encoding="utf-8"))
    if len(idx["records"]) != n:
        errors.append(f"index.json: {len(idx['records'])} records != N={n}")
    if nrec != n:
        errors.append(f"tiles: {nrec} records != N={n}")
    if meta["candidates"]["count"] != n:
        errors.append("meta.candidates.count != N")
    eph_size = (out / "ephem.bin").stat().st_size
    if eph_size != meta["n_steps"] * 6 * 4:
        errors.append(f"ephem.bin: {eph_size} B != n_steps*6*4")

    sizes = {Image.open(out / p).size for p in meta["layers"]["files"].values()}
    if len(sizes) != 1:
        errors.append(f"PNGs have different dimensions: {sizes}")

    ci = {c: i for i, c in enumerate(COLUMNS)}
    metric_cols = COLUMNS[1:]
    for c in metric_cols:
        if np.isnan(arr[:, ci[c]]).any():
            errors.append(f"NaN w kolumnie {c}")
    for c in ("sun_pct", "earth_pct"):
        v = arr[:, ci[c]]
        if v.min() < 0 or v.max() > 100:
            errors.append(f"{c} poza [0, 100]: {v.min()}..{v.max()}")
    sp = arr[:, ci["sun_pct"]]
    hist = np.histogram(sp, bins=10, range=(0.0, 100.0))[0] / n * 100.0
    if not (sp.min() < 5 and sp.max() > 70):
        warnings.append(f"sun_pct range too narrow: min={sp.min():.1f}, max={sp.max():.1f} "
                        "(oczekiwano min < 5 i max > 70)")
    if hist[1:].max() > 35.0:
        warnings.append(f"uneven sun_pct histogram: bin {10 * (1 + int(hist[1:].argmax()))}%+ "
                        f"contains {hist[1:].max():.1f}% of points (35% limit outside the 0-10% bin)")

    print(f"\n{'metric':<22}{'min':>12}{'median':>12}{'max':>12}")
    for c in COLUMNS[5:]:
        if c == "level":
            continue
        v = arr[:, ci[c]]
        print(f"{c:<22}{v.min():>12.2f}{np.median(v):>12.2f}{v.max():>12.2f}")

    print("\nsun_pct histogram (% of points):")
    for b in range(10):
        print(f"  {10 * b:>3}-{10 * (b + 1):<3}% {hist[b]:>6.1f}  " + "#" * int(round(hist[b] / 2)))

    print("\nfiles:")
    total = 0
    for p in sorted(out.rglob("*")):
        if p.is_file():
            if p.parent.name == "masks" and p.name.startswith("tile_"):
                total += p.stat().st_size
                continue
            print(f"  {p.relative_to(out).as_posix():<28}{p.stat().st_size:>12,} B")
            total += p.stat().st_size
    print(f"  masks/tile_*.bin ({len(tiles)} files){sum(t.stat().st_size for t in tiles):>14,} B")
    print(f"  TOTAL {total:,} B")

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    print("self-check:", "OK" if not errors else "FAILED")
    return not errors


if __name__ == "__main__":
    main()
