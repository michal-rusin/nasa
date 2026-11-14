"""Sample slope_deg (LDSM) and dist_psr_km rasters at candidate grid points (Task 10)."""
from pathlib import Path
import numpy as np
from numba import njit
from pyproj import CRS

from dem import Dem, DEM_FAR, DEM_NEAR, ROOT, sample

SLOPE_TIF = ROOT / "data/dem/LDSM_80S_20MPP_ADJ.TIF"
PSR_TIF = ROOT / "data/dem/PSR_DIST_80S.TIF"  # docelową nazwę poda zespół danych

SLOPE_BASIS = "LDSM_80S_20MPP_ADJ"
PSR_SOURCE = "TODO data team"
PSR_METERS_TO_KM = 1e-3  # gdal_proximity.py -distunits GEO zapisuje w metrach -> / 1000 = km


@njit(cache=True)
def _sample_points(h, x0, y0, dx, dy, xs, ys, scale):
    n = xs.shape[0]
    out = np.empty(n, dtype=np.float32)
    for i in range(n):
        val = sample(h, x0, y0, dx, dy, xs[i], ys[i])
        out[i] = val * scale if not np.isnan(val) else np.nan
    return out


def verify_crs_match(reference_crs: CRS, raster: Dem, label: str) -> None:
    """Abort with ValueError if raster CRS differs from the 80 m DEM reference CRS."""
    if raster.crs != reference_crs:
        raise ValueError(
            f"Niezgodny CRS dla rastra '{label}'! "
            f"Oczekiwano CRS z DEM 80m ({reference_crs.to_proj4()}), "
            f"otrzymano ({raster.crs.to_proj4()})."
        )


def verify_all_rasters_crs(
    near_path: Path | str = DEM_NEAR,
    far_path: Path | str = DEM_FAR,
    slope_path: Path | str = SLOPE_TIF,
    psr_path: Path | str = PSR_TIF,
) -> CRS:
    """Load all 4 rasters and verify their CRS matches the 80 m DEM."""
    near_p = Path(near_path)
    if not near_p.exists():
        raise FileNotFoundError(f"Brak bazowego DEM 80m: {near_p}")

    ref_crs = Dem(near_p).crs
    for label, path in [
        ("DEM_FAR (240m)", far_path),
        ("SLOPE (LDSM)", slope_path),
        ("PSR_DIST", psr_path),
    ]:
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(f"Brak wymaganego rastra '{label}': {p}")
        verify_crs_match(ref_crs, Dem(p), label)

    return ref_crs


def sample_raster(
    raster_path: Path | str,
    x_m: np.ndarray,
    y_m: np.ndarray,
    reference_crs: CRS | None = None,
    scale: float = 1.0,
    label: str | None = None,
) -> np.ndarray:
    """Bilinearly sample a GeoTIFF raster at map coordinates (x_m, y_m).

    Raises ValueError if `reference_crs` is given and raster CRS does not match.
    Returns float32 array with NaN if the file is not yet delivered or outside bounds/nodata.
    """
    path = Path(raster_path)
    xs = np.asarray(x_m, dtype=np.float64)
    ys = np.asarray(y_m, dtype=np.float64)

    if not path.exists():
        print(f"[WARN] Brak pliku rastra: {path} -> wypełniono NaN (kontrakt 3.1)")
        return np.full(xs.shape[0], np.nan, dtype=np.float32)

    raster = Dem(path)
    if reference_crs is not None:
        verify_crs_match(reference_crs, raster, label or path.name)

    h, x0, y0, dx, dy = raster.params()
    return _sample_points(h, x0, y0, dx, dy, xs, ys, float(scale))


def sample_terrain_layers(
    grid: dict,
    near_crs: CRS | None = None,
    far_path: Path | str = DEM_FAR,
    slope_path: Path | str = SLOPE_TIF,
    psr_path: Path | str = PSR_TIF,
) -> dict:
    """Verify CRS of all 4 rasters against DEM 80m and sample slope_deg & dist_psr_km."""
    if near_crs is None and Path(DEM_NEAR).exists():
        near_crs = Dem(DEM_NEAR).crs

    if near_crs is not None and Path(far_path).exists():
        verify_crs_match(near_crs, Dem(far_path), "DEM_FAR (240m)")

    x_m, y_m = grid["x_m"], grid["y_m"]

    slope_deg = sample_raster(
        slope_path,
        x_m,
        y_m,
        reference_crs=near_crs,
        scale=1.0,
        label="SLOPE (LDSM)",
    )
    dist_psr_km = sample_raster(
        psr_path,
        x_m,
        y_m,
        reference_crs=near_crs,
        scale=PSR_METERS_TO_KM,
        label="PSR_DIST",
    )

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