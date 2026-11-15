"""Load DEMs, build the CRS transformer, sample heights (owner: Jacob).

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
"""DEM loading, coordinate transforms, height sampling. Owner: Jacob."""
from pathlib import Path
import numpy as np
import rasterio
from pyproj import CRS, Transformer
from numba import njit

ROOT = Path(__file__).resolve().parents[2]
DEM_NEAR = ROOT / "data/dem/LDEM_80S_80MPP_ADJ.TIF"
DEM_FAR = ROOT / "data/dem/LDEM_60S_240MPP_ADJ.TIF"


class Dem:
    """One DEM in memory, plus the numbers numba needs to sample it."""
    def __init__(self, path):
        with rasterio.open(path) as ds:
            self.h = ds.read(1).astype(np.float32)
            if ds.nodata is not None:
                self.h[self.h == ds.nodata] = np.nan   # nodata -> NaN; sampler skips it
            t = ds.transform
            # top-left corner and pixel size; dy is negative (rows go down)
            self.x0, self.y0, self.dx, self.dy = t.c, t.f, t.a, t.e
            self.crs = CRS.from_user_input(ds.crs)

    def params(self):
        return self.h, self.x0, self.y0, self.dx, self.dy


@njit(cache=True)
def sample(h, x0, y0, dx, dy, x, y):
    """Bilinear height at map coords (x, y). NaN if outside the grid or nodata."""
    c = (x - x0) / dx - 0.5      # -0.5: values sit at pixel centres, not corners
    r = (y - y0) / dy - 0.5
    j = int(np.floor(c))
    i = int(np.floor(r))
    if i < 0 or j < 0 or i + 1 >= h.shape[0] or j + 1 >= h.shape[1]:
        return np.nan
    fc = c - j
    fr = r - i
    top = h[i, j] * (1 - fc) + h[i, j + 1] * fc
    bot = h[i + 1, j] * (1 - fc) + h[i + 1, j + 1] * fc
    return top * (1 - fr) + bot * fr          # any NaN corner -> NaN result


def make_transformers(crs):
    """(lon, lat) <-> (x, y) using the DEM's own CRS (contract 1.3)."""
    geo = crs.geodetic_crs
    fwd = Transformer.from_crs(geo, crs, always_xy=True)
    inv = Transformer.from_crs(crs, geo, always_xy=True)
    return fwd, inv


def local_north_east(fwd, lat, lon, eps=1e-3):
    """Unit vectors of local north and east on the map grid, by finite differences.
    Works on arrays. Do NOT call at exactly lat = -90 (east is undefined there)."""
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    x, y = fwd.transform(lon, lat)
    xn, yn = fwd.transform(lon, lat + eps)
    xe, ye = fwd.transform(lon + eps, lat)
    n = np.stack([np.asarray(xn) - x, np.asarray(yn) - y], -1)
    e = np.stack([np.asarray(xe) - x, np.asarray(ye) - y], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    e /= np.linalg.norm(e, axis=-1, keepdims=True)
    return n, e