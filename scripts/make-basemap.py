"""Basemap (hillshade) dla mapy bieguna południowego z DEM-u LOLA.

Czyta tylko okno ±185 km wokół bieguna z DEM-u (bez wczytywania całego pliku),
uśrednia do --px × --px, liczy wizualny hillshade i zapisuje 8-bit PNG w skali
szarości. Obok zapisuje basemap_check.png z losowymi kandydatami i okręgiem 84°S.

Uruchomienie:  python scripts/make-basemap.py [--dem PLIK] [--out PNG] [--px 4096]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "out" / "v1"
DOWNLOADS = Path.home() / "Downloads"
HALF = 185_000.0  # połowa boku okna [m]
R_MOON = 1_737_400.0


def find_dem() -> Path:
    found = sorted(p for p in DOWNLOADS.iterdir() if p.is_file()
                   and p.name.upper().startswith("LDEM_80S_20MPP_ADJ")
                   and p.suffix.upper() in (".TIF", ".TIFF"))
    if found:
        return found[0]
    ldsm = sorted(p.name for p in DOWNLOADS.glob("LDSM_*"))
    if ldsm:
        sys.exit("PRZERWANO: w Downloads nie ma LDEM_80S_20MPP_ADJ*.TIF, są tylko "
                 f"pliki LDSM_* ({', '.join(ldsm)}). LDSM to mapa nachyleń, nie wysokości. "
                 "Podaj DEM jawnie przez --dem.")
    sys.exit(f"PRZERWANO: nie znaleziono LDEM_80S_20MPP_ADJ*.TIF w {DOWNLOADS}. Podaj --dem.")


def proj_params(proj4: str) -> dict[str, str]:
    out = {}
    for tok in proj4.split():
        if tok.startswith("+"):
            k, _, v = tok[1:].partition("=")
            out[k] = v
    return out


def same_crs(dem_proj4: str, meta_proj4: str) -> bool:
    a, b = proj_params(dem_proj4), proj_params(meta_proj4)

    def num(d, k, default=None):
        v = d.get(k, default)
        return None if v is None else float(v)

    def radius(d):
        if "R" in d:
            return float(d["R"]), float(d["R"])
        return num(d, "a"), num(d, "b", d.get("a"))

    if a.get("proj") != "stere" or b.get("proj") != "stere":
        return False
    checks = [
        (num(a, "lat_0"), num(b, "lat_0")),
        (num(a, "lon_0", 0), num(b, "lon_0", 0)),
        (num(a, "lat_ts", a.get("lat_0")), num(b, "lat_ts", b.get("lat_0"))),
        (num(a, "x_0", 0), num(b, "x_0", 0)),
        (num(a, "y_0", 0), num(b, "y_0", 0)),
        (num(a, "k", 1), num(b, "k", 1)),
        *zip(radius(a), radius(b)),
    ]
    return all(x is not None and y is not None and abs(x - y) < 1e-6 for x, y in checks)


def rss_mb() -> str:
    try:
        import psutil
        p = psutil.Process()
        info = p.memory_info()
        peak = getattr(info, "peak_wset", None)
        s = f"RSS {info.rss / 2**20:.0f} MB"
        return s + (f", szczyt {peak / 2**20:.0f} MB" if peak else "")
    except ImportError:
        return "pamięć: brak psutil"


def hillshade(z: np.ndarray, cell: float, az_deg=315.0, alt_deg=35.0, zf=2.0) -> np.ndarray:
    # wiersz 0 = północ (y rośnie w górę), więc dz/dy = -gradient po wierszach
    dz_drow, dz_dcol = np.gradient(z * zf, cell)
    dzdx, dzdy = dz_dcol, -dz_drow
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdy, -dzdx)  # kierunek spadku
    az = math.radians(90.0 - az_deg)   # azymut geograficzny -> kąt matematyczny
    alt = math.radians(alt_deg)
    hs = math.sin(alt) * np.cos(slope) + math.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(hs, 0.0, 1.0)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dem", type=Path)
    ap.add_argument("--out", type=Path, default=DATA / "layers" / "basemap.png")
    ap.add_argument("--px", type=int, default=4096)
    args = ap.parse_args()
    dem = args.dem or find_dem()
    px = args.px
    meta = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))

    t0 = time.perf_counter()
    with rasterio.open(dem) as src:
        dem_proj4 = src.crs.to_proj4() if src.crs else "(brak CRS)"
        if not same_crs(dem_proj4, meta["raster_proj4"]):
            sys.exit(f"PRZERWANO: CRS DEM-u różni się od meta.raster_proj4\n"
                     f"  DEM : {dem_proj4}\n  meta: {meta['raster_proj4']}")
        win = from_bounds(-HALF, -HALF, HALF, HALF, transform=src.transform)
        eps = 1e-6
        if (win.col_off < -eps or win.row_off < -eps
                or win.col_off + win.width > src.width + eps
                or win.row_off + win.height > src.height + eps):
            sys.exit(f"PRZERWANO: okno {win} wychodzi poza plik {src.width}x{src.height} "
                     f"(granice pliku {src.bounds})")
        print(f"DEM: {dem.name}  {src.width}x{src.height}, piksel {src.res[0]:g} m, "
              f"CRS {dem_proj4}")
        print(f"okno: kol {win.col_off:.1f}+{win.width:.1f}, wiersz {win.row_off:.1f}+{win.height:.1f}")
        z = src.read(1, window=win, out_shape=(px, px),
                     resampling=Resampling.average, masked=True)
    t_read = time.perf_counter() - t0
    print(f"odczyt: {t_read:.1f} s, {rss_mb()}")

    z = z.astype(np.float64)
    nodata = np.ma.getmaskarray(z) | ~np.isfinite(z.filled(np.nan))
    valid = z.compressed()
    valid = valid[np.isfinite(valid)]
    if valid.size == 0:
        sys.exit("PRZERWANO: w oknie same nodata")
    zf = z.filled(np.median(valid))

    hs = hillshade(zf, cell=2 * HALF / px)
    lo, hi = np.percentile(valid, [1, 99])
    elev = np.clip((zf - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    img = (0.8 * hs + 0.2 * elev) * 200.0
    img[nodata] = 0
    img8 = np.round(img).astype(np.uint8)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img8, mode="L").save(args.out)
    if args.out.stat().st_size > 8 * 2**20:
        Image.fromarray(img8, mode="L").save(args.out, optimize=True)
    size_mb = args.out.stat().st_size / 2**20
    print(f"zapisano {args.out}  {px}x{px}, {size_mb:.2f} MB, nodata {nodata.mean() * 100:.2f}%")

    # --- kontrola: 300 losowych kandydatów + okrąg 84°S ---
    cols = meta["candidates"]["columns"]
    n = meta["candidates"]["count"]
    cand = np.fromfile(DATA / "candidates.bin", dtype="<f4").reshape(n, len(cols))
    xs, ys = cand[:, cols.index("x_m")], cand[:, cols.index("y_m")]
    rng = np.random.default_rng(0)
    pick = rng.choice(n, size=min(300, n), replace=False)

    cp = 1024
    chk = Image.fromarray(img8, mode="L").resize((cp, cp), Image.Resampling.BOX).convert("RGB")
    d = ImageDraw.Draw(chk)
    s = cp / (2 * HALF)
    r84 = 2 * R_MOON * math.tan(math.radians(3)) * s
    c = cp / 2
    d.ellipse((c - r84, c - r84, c + r84, c + r84), outline=(255, 200, 0), width=2)
    outside = 0
    for i in pick:
        u, v = (xs[i] + HALF) * s, (HALF - ys[i]) * s
        outside += math.hypot(u - c, v - c) > r84
        d.ellipse((u - 2, v - 2, u + 2, v + 2), fill=(255, 40, 40))
    chk_path = args.out.with_name("basemap_check.png")
    chk.save(chk_path)
    print(f"kontrola: {chk_path} ({outside} z {len(pick)} punktów poza okręgiem 84°S)")
    print(f"razem: {time.perf_counter() - t0:.1f} s")


if __name__ == "__main__":
    main()
