"""Sample slope_deg (LDSM) and dist_psr_km rasters at candidate grid points (Task 10)."""
from pathlib import Path
import numpy as np
from numba import njit
from pyproj import Transformer

from dem import Dem, ROOT, sample

SLOPE_TIF = ROOT / "data/dem/LDSM_80S_20MPP_ADJ.TIF"
PSR_TIF = ROOT / "data/dem/PSR_DIST_80S.TIF"


@njit(cache=True)
def _sample_points(h, x0, y0, dx, dy, xs, ys, scale):
    n = xs.shape[0]
    out = np.empty(n, dtype=np.float32)
    for i in range(n):
        val = sample(h, x0, y0, dx, dy, xs[i], ys[i])
        out[i] = val * scale if not np.isnan(val) else np.nan
    return out


def sample_raster(
    raster_path: Path | str,
    x_m: np.ndarray,
    y_m: np.ndarray,
    target_crs=None,
    scale: float = 1.0,
) -> np.ndarray:
    """Bilinearly sample a GeoTIFF raster at map coordinates (x_m, y_m).

    Returns float32 array with NaN for nodata, out-of-bounds, or missing raster file.
    """
    path = Path(raster_path)
    xs = np.asarray(x_m, dtype=np.float64)
    ys = np.asarray(y_m, dtype=np.float64)

    if not path.exists():
        print(f"[WARN] Brak pliku rastra: {path} -> wypełniono NaN (kontrakt 3.1)")
        return np.full(xs.shape[0], np.nan, dtype=np.float32)

    raster = Dem(path)
    if target_crs is not None and raster.crs != target_crs:
        tr = Transformer.from_crs(target_crs, raster.crs, always_xy=True)
        xs, ys = tr.transform(xs, ys)

    h, x0, y0, dx, dy = raster.params()
    return _sample_points(h, x0, y0, dx, dy, xs, ys, float(scale))


def sample_terrain_layers(
    grid: dict,
    slope_path: Path | str = SLOPE_TIF,
    psr_path: Path | str = PSR_TIF,
    target_crs=None,
    psr_to_km: float = 1e-3,
) -> dict:
    """Populate grid['slope_deg'] and grid['dist_psr_km'] in-place and return grid.

    Args:
        grid: Dict returned by grid.build_grid (must contain 'x_m' and 'y_m').
        slope_path: Path to LDSM_80S_20MPP_ADJ.TIF (degrees).
        psr_path: Path to PSR proximity raster from data team (default meters -> *1e-3 = km).
        target_crs: CRS of grid['x_m'], grid['y_m'] (e.g. near.crs).
        psr_to_km: Unit multiplier to convert PSR raster values to km (1e-3 if meters, 1.0 if km).
    """
    x_m, y_m = grid["x_m"], grid["y_m"]

    slope_deg = sample_raster(slope_path, x_m, y_m, target_crs=target_crs, scale=1.0)
    dist_psr_km = sample_raster(psr_path, x_m, y_m, target_crs=target_crs, scale=psr_to_km)

    # Kontrola fizyczna dla niepustych próbek
    valid_slope = slope_deg[~np.isnan(slope_deg)]
    if valid_slope.size > 0:
        assert np.all((valid_slope >= 0.0) & (valid_slope <= 90.0)), (
            f"Nieprawidłowy zakres slope_deg: [{valid_slope.min()}, {valid_slope.max()}]"
        )

    valid_psr = dist_psr_km[~np.isnan(dist_psr_km)]
    if valid_psr.size > 0:
        assert np.all(valid_psr >= 0.0), f"Ujemna odległość dist_psr_km: {valid_psr.min()}"

    grid["slope_deg"] = slope_deg
    grid["dist_psr_km"] = dist_psr_km
    return grid