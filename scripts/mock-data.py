#!/usr/bin/env python3
"""Generator danych testowych dla frontu (Lunar Landing Site Navigator).

Zapisuje komplet plików z docs/contracts.md (v1) z danymi SYNTETYCZNYMI, ale
wewnętrznie spójnymi: metryki w candidates.bin i validation.json są policzone
fizyką z sekcji 1.2 i 2 kontraktu z syntetycznych masek i syntetycznych efemeryd.
Skrypt jest referencją do portu fizyki na TypeScript ("moja fizyka w JS == dane
z generatora").

Zależności: tylko numpy i Pillow.

    python scripts/mock-data.py [--out DIR] [--lat-min -85] [--seed 42]

UWAGA O NAZWIE --lat-min: to szerokość zewnętrznej krawędzi siatki (siatka
obejmuje -90..lat_min). W meta.json jest to region {lat_min: -90, lat_max: <arg>},
tak jak w przykładzie z sekcji 4 kontraktu.

Wyniki są deterministyczne przy tym samym --seed (łącznie z bajtami plików).
Dlatego generated_utc domyślnie jest STAŁĄ (--generated-utc), a nie zegarem.
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
# Stałe kontraktu
# --------------------------------------------------------------------------- #
R_KM = 1737.4                    # moon_radius_km
R_M = R_KM * 1000.0
GRID_STEP_M = 2000.0             # siatka level 0
OBSERVER_HEIGHT_M = 2.0
MASK_MIN_DIST_M = 120
SUN_RADIUS_DEG = 0.2666
NIGHT_THRESHOLD = 0.01
STEP_S = 3600
# 2028 jest przestępny (366 dni). JEDYNE miejsce, z którego czytamy liczbę kroków.
N_STEPS = 8784
T0_UTC = "2028-01-01T00:00:00Z"
MASK_SAMPLES = 720
MASK_STEP_DEG = 0.5
MASK_SCALE = 0.01
MASK_REC_BYTES = MASK_SAMPLES * 2          # 1440 B
TILES = 8
LAYER_PX = 1024
LAYER_HALF_M = 160000.0                    # bounds_m = kwadrat ±160000 m
COLUMNS = ["id", "lat", "lon", "x_m", "y_m", "elev_m", "level",
           "sun_pct", "longest_night_h", "earth_pct", "longest_comm_gap_h",
           "slope_deg", "dist_psr_km"]
PROJ_STRING = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m"
DEFAULT_GENERATED_UTC = "2026-11-14T00:00:00Z"
MASK_MIN_DEG, MASK_MAX_DEG = -3.0, 7.0     # zakres masek [deg]
# Strojenie bazy horyzontu (deg): grzbiet, dno zagłębień tła, wnętrze krateru.
RIDGE_DEG, FLOOR_DEG, CRATER_DEG = -2.0, 5.0, 6.0
CHUNK = 256                                # punktów na paczkę fizyki


# --------------------------------------------------------------------------- #
# Rzut stereograficzny biegunowy (południowy)
# --------------------------------------------------------------------------- #
# UWAGA: to konwencja TYLKO dla mocka (skala prawdziwa na biegunie, kula R).
# Prawdziwy silnik liczy x_m, y_m przez pyproj z CRS pliku DEM (kontrakt 1.3),
# nie własnym wzorem. Mock nie ma DEM, więc musi sam coś przyjąć.
def lat_to_rho(lat_rad):
    """rho [m] dla szerokości (rad, ujemnej): rho = 2R tan(pi/4 + lat/2)."""
    return 2.0 * R_M * np.tan(np.pi / 4.0 + np.asarray(lat_rad) / 2.0)


def xy_to_latlon(x, y):
    """(x, y) [m] -> (lat, lon) w STOPNIACH, lon w [-180, 180)."""
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
# Syntetyczny teren (funkcje x, y [m]; parametry z seeda)
# --------------------------------------------------------------------------- #
class Terrain:
    def __init__(self, rng: np.random.Generator):
        # Kratery: (rho_km od bieguna, promień_km, głębokość_m). Pierwszy leży
        # ~89.7°S (rho ~9 km). Kąt i drobny rozrzut parametrów z seeda.
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

        # Tło +-1500 m: cztery fale płaskie (amplitudy sumują się do 1500).
        self.bg_amp = np.array([600.0, 450.0, 300.0, 150.0])
        th = rng.uniform(0, 2 * np.pi, 4)
        wl = rng.uniform(40e3, 150e3, 4)
        self.bg_k = np.stack([np.cos(th), np.sin(th)], axis=1) * (2 * np.pi / wl)[:, None]
        self.bg_ph = rng.uniform(0, 2 * np.pi, 4)
        # Szum terenu i nachylenia (stałe, bez RNG w czasie wywołania).
        self.nz_ph = rng.uniform(0, 2 * np.pi, 4)
        # Parametry składowych horyzontu: faza zależna od położenia.
        self.hz_c = rng.uniform(0, 2 * np.pi, 3)
        self.hz_lx = rng.uniform(25e3, 60e3, 3)
        self.hz_ly = rng.uniform(25e3, 60e3, 3)

    # --- pola pomocnicze --------------------------------------------------- #
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
            e = e - depth * np.where(u < 1.0, 1.0 - u * u, 0.0)       # dno
            e = e + 0.12 * depth * np.exp(-(((d - r) / (0.12 * r)) ** 2))  # wał
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
        """1 wewnątrz krateru, wygasa na zewnątrz wału (0..1)."""
        w = np.zeros(np.shape(x))
        for i, d in enumerate(self._dists(x, y)):
            r = self.cr[i]
            wi = np.where(d < r, 1.0, np.exp(-(((d - r) / (0.35 * r)) ** 2)))
            w = np.maximum(w, wi)
        return w

    # --- maski horyzontu --------------------------------------------------- #
    def horizon_base_deg(self, x, y):
        """Ciągła baza horyzontu [deg] jako funkcja położenia.

        Poza kraterami: grzbiet (t -> 1) ok. RIDGE_DEG, płaskie (t ~ 0.5) ok. 0,
        zagłębienia (t -> 0) FLOOR_DEG. Na stokach kraterów płynnie rośnie do
        CRATER_DEG (waga w = 1 wewnątrz krateru, wygasa za wałem).
        """
        w = self.crater_weight(x, y)
        t = np.clip((self.background(x, y) + 1500.0) / 3000.0, 0.0, 1.0)  # 1 = grzbiet
        outside = np.interp(t, [0.0, 0.25, 0.5, 0.75, 1.0],
                            [FLOOR_DEG, 0.5 * FLOOR_DEG, 0.0, 0.6 * RIDGE_DEG, RIDGE_DEG])
        return outside * (1.0 - w) + CRATER_DEG * w, w

    def horizon_masks(self, x, y, rng: np.random.Generator):
        """(n, 720) int16, setne stopnia, azymut k*0.5 deg (konwencja 1.2).

        Baza (ciągła funkcja położenia) + 3 składowe sinusoidalne po azymucie
        z fazą zależną od punktu + lekki szum. Zakres [-3, 7] deg (int16 ze
        znakiem). Ujemny horyzont = punkt wyniesiony ponad otoczenie.
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
# Efemerydy (mock, wiarygodny)
# --------------------------------------------------------------------------- #
def u_vec(lat, lon):
    cl = np.cos(lat)
    return np.stack([cl * np.cos(lon), cl * np.sin(lon), np.sin(lat)], axis=-1)


def make_ephem(alpha0: float):
    """(n_steps, 6) float32: sun_dir_xyz, earth_xyz [km]. Kontrakt 3.3."""
    t_d = np.arange(N_STEPS) * (STEP_S / 86400.0)           # doby od t0
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
# Fizyka metryk (kontrakt 1.2, 2.1, 2.2, 2.3), wektoryzowana
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
    az = np.degrees(np.arctan2(vE, vN)) % 360.0           # 0 = N, rośnie przez E
    el = np.degrees(np.arcsin(np.clip(vU_over_norm, -1.0, 1.0)))
    return az, el


def visibility(lat_deg, lon_deg, elev_m, mask_i16, eph):
    """Zwraca (f, g): f (n,T) float64 ułamek tarczy Słońca, g (n,T) bool."""
    sun = eph[:, 0:3].astype(np.float64)
    earth = eph[:, 3:6].astype(np.float64)
    U, E, N = enu_basis(lat_deg, lon_deg)
    r_obs = R_KM + elev_m / 1000.0 + OBSERVER_HEIGHT_M / 1000.0     # |P| w km, P = r*U

    # Słońce: kierunek ze środka Księżyca, bez paralaksy.
    s_az, s_el = az_el(E @ sun.T, N @ sun.T, U @ sun.T)
    h = mask_height_deg(mask_i16, s_az)
    d = (s_el - h) / SUN_RADIUS_DEG
    dc = np.clip(d, -1.0, 1.0)
    f = (np.arccos(-dc) + dc * np.sqrt(1.0 - dc * dc)) / np.pi
    f = np.where(d <= -1.0, 0.0, np.where(d >= 1.0, 1.0, f))

    # Ziemia: v = Earth_pos - P, z paralaksą. Baza ortonormalna => P.E = P.N = 0.
    eU = U @ earth.T                                                 # (n,T)
    vU = eU - r_obs[:, None]
    e_norm2 = np.sum(earth * earth, axis=1)[None, :]
    vnorm = np.sqrt(e_norm2 - 2.0 * r_obs[:, None] * eU + r_obs[:, None] ** 2)
    e_az, e_el = az_el(E @ earth.T, N @ earth.T, vU / vnorm)
    g = e_el > mask_height_deg(mask_i16, e_az)
    return f, g


def longest_run(b):
    """Najdłuższy ciąg True w każdym wierszu; odcinek, bez sklejania końców."""
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
# Zapis plików
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
            sel = np.flatnonzero((ti == i) & (tj == j))     # rosnąco po id (id = indeks)
            if sel.size == 0:
                continue                                    # pusty kafelek: bez pliku
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
    X, Y = np.meshgrid(c, c[::-1])        # wiersz 0 = górny = max_y
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

    # basemap: szary relief + okręgi co 1° szerokości + południki co 30°
    g = np.clip(150.0 + 0.025 * terrain.elev(X, Y), 40.0, 230.0)
    g = np.where(in_region, g, g * 0.8)
    line = np.zeros(X.shape, dtype=bool)
    for lat in range(-89, -80):
        rk = float(lat_to_rho(np.radians(lat)))
        line |= np.abs(rho - rk) < 0.75 * px
    lon = np.degrees(np.arctan2(X, Y))
    dm = np.abs(((lon + 15.0) % 30.0) - 15.0)              # odl. kątowa do południka 30°
    line |= rho * np.sin(np.radians(dm)) < 0.75 * px
    gray = np.where(line, 245.0, g).astype(np.uint8)
    Image.fromarray(np.stack([gray] * 3, axis=-1), "RGB").save(ldir / "basemap.png")

    # slope: kolorowa, alfa rośnie z nachyleniem, przezroczysta poza regionem
    sl = terrain.slope(X, Y)
    rgb = lerp_cmap(sl / 25.0, [(0.0, (60, 180, 75)), (0.5, (240, 220, 60)), (1.0, (215, 50, 40))])
    a = np.where(in_region, 80.0 + 175.0 * np.clip(sl / 25.0, 0, 1), 0.0)
    Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), "RGBA").save(ldir / "slope.png")

    # illumination: piksel -> najbliższa komórka siatki 2 km; poza siatką przezroczysty
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

    # psr: półprzezroczysta maska
    psr = terrain.in_psr(X, Y)
    rgba = np.zeros(X.shape + (4,), dtype=np.uint8)
    rgba[psr] = (70, 150, 255, 140)
    Image.fromarray(rgba, "RGBA").save(ldir / "psr.png")


def great_circle_km(lat1, lon1, lat2, lon2):
    d = np.sum(u_vec(np.radians(lat1), np.radians(lon1)) * u_vec(np.radians(lat2), np.radians(lon2)), axis=-1)
    return R_KM * np.arccos(np.clip(d, -1.0, 1.0))


def make_sites(terrain: Terrain, lat, lon, ids, rho_max):
    """8 miejsc [MOCK]. Poza siatką (rho > rho_max) => pola najbliższego punktu null."""
    def at(cx, cy, off_m, ang):
        return xy_to_latlon(cx + off_m * math.cos(ang), cy + off_m * math.sin(ang))

    b = terrain.biggest
    cx, cy, r = terrain.cx[b], terrain.cy[b], terrain.cr[b]
    out_ang = math.atan2(cy, cx)                    # kierunek od bieguna na zewnątrz
    px_, py_ = terrain.cx[0], terrain.cy[0]
    defs = [
        ("artemis", "Obok największego krateru", *at(cx, cy, r + 3000.0, out_ang)),
        ("artemis", "Przy kraterze polarnym", *at(px_, py_, terrain.cr[0] + 2500.0, out_ang + 0.6)),
        ("clps", "Równina A", *xy_to_latlon(0.6 * rho_max * math.cos(1.0), 0.6 * rho_max * math.sin(1.0))),
        ("clps", "Równina B", *xy_to_latlon(0.8 * rho_max * math.cos(3.6), 0.8 * rho_max * math.sin(3.6))),
        ("international", "Grzbiet", *xy_to_latlon(0.4 * rho_max * math.cos(5.0), 0.4 * rho_max * math.sin(5.0))),
        ("apollo", "Kontekst historyczny", np.float64(-20.0), np.float64(30.0)),
        ("reference", "Punkt kontrolny 1", *xy_to_latlon(0.9 * rho_max * math.cos(2.2), 0.9 * rho_max * math.sin(2.2))),
        ("reference", "Punkt kontrolny 2", *xy_to_latlon(0.2 * rho_max * math.cos(0.2), 0.2 * rho_max * math.sin(0.2))),
    ]
    sites = []
    for n, (cat, name, la, lo) in enumerate(defs, 1):
        la, lo = float(la), float(lo)
        sx, sy = latlon_to_xy(la, lo)
        item = {"id": f"mock-{cat}-{n}", "name": f"[MOCK] {name}", "category": cat,
                "lat": round(la, 4), "lon": round(lo, 4),
                "x_m": None, "y_m": None,
                "note": "dane testowe, nie jest to prawdziwa lokalizacja",
                "nearest_candidate_id": None, "nearest_candidate_dist_km": None}
        # x_m, y_m w rzucie mocka (latlon_to_xy); null poza granicami rastrów.
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
    """4 różne punkty: najjaśniejszy, najciemniejszy, mediana sun_pct, max earth_pct."""
    n = len(sun_pct)
    order_sun = np.argsort(sun_pct, kind="stable")
    cands = [int(order_sun[-1]), int(order_sun[0]), int(order_sun[n // 2]),
             int(np.argsort(earth_pct, kind="stable")[-1])]
    chosen = []
    for k, c in enumerate(cands):
        if c in chosen:   # duplikat: sąsiad w odpowiednim rankingu
            ranking = list(np.argsort(earth_pct, kind="stable")[::-1]) if k == 3 else list(order_sun)
            c = next(int(v) for v in ranking if int(v) not in chosen)
        chosen.append(c)
    return chosen


# --------------------------------------------------------------------------- #
# Główny przebieg
# --------------------------------------------------------------------------- #
def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default="web/public/data")
    ap.add_argument("--lat-min", type=float, default=-85.0,
                    help="szerokość zewnętrznej krawędzi siatki (-85 pełna ~18k pkt, -89 mała ~700)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--generated-utc", default=DEFAULT_GENERATED_UTC,
                    help="stała, żeby wynik był bit-w-bit powtarzalny")
    args = ap.parse_args()
    if not (-90.0 < args.lat_min < -60.0):
        sys.exit("--lat-min musi być w zakresie (-90, -60)")

    t_start = time.time()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)
    terrain = Terrain(rng)
    alpha0 = float(rng.uniform(0, 2 * np.pi))
    mask_rng = np.random.default_rng([args.seed, 1])

    # --- siatka --------------------------------------------------------------
    rho_max = float(lat_to_rho(np.radians(args.lat_min)))
    K = int(rho_max // GRID_STEP_M)
    ax = np.arange(-K, K + 1) * GRID_STEP_M
    X, Y = np.meshgrid(ax, ax, indexing="ij")
    keep = np.hypot(X, Y) <= rho_max
    x, y = X[keep], Y[keep]                        # porządek: po x, potem po y
    n = len(x)
    ids = np.arange(n)
    lat, lon = xy_to_latlon(x, y)
    # Fizyka liczy z wartości dokładnie takich, jakie trafią do float32 w pliku.
    lat = lat.astype(np.float32).astype(np.float64)
    lon = lon.astype(np.float32).astype(np.float64)
    elev = terrain.elev(x, y).astype(np.float32).astype(np.float64)
    slope = terrain.slope(x, y)
    dpsr = terrain.dist_psr_km(x, y)
    print(f"siatka: {n} punktów, rho_max = {rho_max / 1000:.1f} km, seed = {args.seed}")

    # --- maski i efemerydy ---------------------------------------------------
    masks = np.empty((n, MASK_SAMPLES), dtype='<i2')
    for a in range(0, n, CHUNK):
        sl = slice(a, min(a + CHUNK, n))
        masks[sl] = terrain.horizon_masks(x[sl], y[sl], mask_rng)
    eph = make_ephem(alpha0)
    assert eph.shape == (N_STEPS, 6)

    # --- metryki -------------------------------------------------------------
    t_phys = time.time()
    m = metrics_for(lat, lon, elev, masks, eph)
    print(f"fizyka: {time.time() - t_phys:.1f} s")

    cols = {"id": ids, "lat": lat, "lon": lon, "x_m": x, "y_m": y, "elev_m": elev,
            "level": np.zeros(n), "sun_pct": m[:, 0], "longest_night_h": m[:, 1],
            "earth_pct": m[:, 2], "longest_comm_gap_h": m[:, 3],
            "slope_deg": slope, "dist_psr_km": dpsr}
    arr = np.stack([cols[c].astype(np.float32) for c in COLUMNS], axis=1).astype('<f4')
    arr.tofile(out / "candidates.bin")
    eph.astype('<f4').tofile(out / "ephem.bin")

    # --- maski, rastry, miejsca, walidacja, meta ------------------------------
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
        "layers": {
            "bounds_m": {"min_x": -int(LAYER_HALF_M), "min_y": -int(LAYER_HALF_M),
                         "max_x": int(LAYER_HALF_M), "max_y": int(LAYER_HALF_M)},
            "files": {"basemap": "layers/basemap.png", "slope": "layers/slope.png",
                      "illumination": "layers/illumination.png", "psr": "layers/psr.png"},
        },
    }
    write_json(out / "meta.json", meta)

    ok = self_check(out, n, arr, meta)
    print(f"\nczas działania: {time.time() - t_start:.1f} s")
    if not ok:
        sys.exit(1)


# --------------------------------------------------------------------------- #
# Samokontrola
# --------------------------------------------------------------------------- #
def self_check(out: Path, n: int, arr: np.ndarray, meta: dict) -> bool:
    errors, warnings = [], []
    cb = out / "candidates.bin"
    if cb.stat().st_size != n * len(COLUMNS) * 4:
        errors.append(f"candidates.bin: {cb.stat().st_size} B != {n}*{len(COLUMNS)}*4")
    else:
        back = np.fromfile(cb, dtype='<f4').reshape(n, len(COLUMNS))
        if not np.array_equal(back, arr, equal_nan=True):
            errors.append("candidates.bin: odczyt różni się od zapisanych danych")

    tiles = sorted((out / "masks").glob("tile_*.bin"))
    nrec = 0
    for t in tiles:
        s = t.stat().st_size
        if s % MASK_REC_BYTES:
            errors.append(f"{t.name}: rozmiar {s} nie jest wielokrotnością {MASK_REC_BYTES}")
        nrec += s // MASK_REC_BYTES
    idx = json.loads((out / "masks" / "index.json").read_text(encoding="utf-8"))
    if len(idx["records"]) != n:
        errors.append(f"index.json: {len(idx['records'])} rekordów != N={n}")
    if nrec != n:
        errors.append(f"kafelki: {nrec} rekordów != N={n}")
    if meta["candidates"]["count"] != n:
        errors.append("meta.candidates.count != N")
    eph_size = (out / "ephem.bin").stat().st_size
    if eph_size != meta["n_steps"] * 6 * 4:
        errors.append(f"ephem.bin: {eph_size} B != n_steps*6*4")

    sizes = {Image.open(out / p).size for p in meta["layers"]["files"].values()}
    if len(sizes) != 1:
        errors.append(f"PNG-i mają różne rozmiary: {sizes}")

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
        warnings.append(f"rozrzut sun_pct za wąski: min={sp.min():.1f}, max={sp.max():.1f} "
                        "(oczekiwano min < 5 i max > 70)")
    if hist[1:].max() > 35.0:
        warnings.append(f"histogram sun_pct nierówny: przedział {10 * (1 + int(hist[1:].argmax()))}%+ "
                        f"ma {hist[1:].max():.1f}% punktów (limit 35% poza przedziałem 0-10%)")

    print(f"\n{'metryka':<22}{'min':>12}{'mediana':>12}{'max':>12}")
    for c in COLUMNS[5:]:
        if c == "level":
            continue
        v = arr[:, ci[c]]
        print(f"{c:<22}{v.min():>12.2f}{np.median(v):>12.2f}{v.max():>12.2f}")

    print("\nhistogram sun_pct (% punktów):")
    for b in range(10):
        print(f"  {10 * b:>3}-{10 * (b + 1):<3}% {hist[b]:>6.1f}  " + "#" * int(round(hist[b] / 2)))

    print("\npliki:")
    total = 0
    for p in sorted(out.rglob("*")):
        if p.is_file():
            if p.parent.name == "masks" and p.name.startswith("tile_"):
                total += p.stat().st_size
                continue
            print(f"  {p.relative_to(out).as_posix():<28}{p.stat().st_size:>12,} B")
            total += p.stat().st_size
    print(f"  masks/tile_*.bin ({len(tiles)} plików){sum(t.stat().st_size for t in tiles):>14,} B")
    print(f"  RAZEM {total:,} B")

    for w in warnings:
        print(f"OSTRZEŻENIE: {w}")
    for e in errors:
        print(f"BŁĄD: {e}")
    print("samokontrola:", "OK" if not errors else "NIEUDANA")
    return not errors


if __name__ == "__main__":
    main()
