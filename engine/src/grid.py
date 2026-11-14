"""Candidate grid (contract 3.1, level 0). Owner: Jacob."""
import numpy as np
from masks import height_at


def build_grid(near, far, fwd, inv, spacing_m=2000.0, lat_edge=-85.0):
    """Points every spacing_m inside the lat_edge circle. Returns dict of arrays."""
    xe, ye = fwd.transform(0.0, lat_edge)
    r = float(np.hypot(xe, ye))                      # radius of the 85°S circle on the map
    # half-cell offset: no point lands exactly on the pole (east is undefined there)
    c = np.arange(-r + spacing_m / 2, r, spacing_m)
    X, Y = np.meshgrid(c, c)
    keep = np.hypot(X, Y) <= r
    x, y = X[keep], Y[keep]
    ids = np.nonzero(keep.ravel())[0]                # id = index in the full square: stable
    lon, lat = inv.transform(x, y)
    lon = (np.asarray(lon) + 180) % 360 - 180        # contract: [-180, 180)
    lat = np.asarray(lat)
    np_, fp = near.params(), far.params()
    elev = np.array([height_at(np_, fp, xi, yi) for xi, yi in zip(x, y)])
    ok = ~np.isnan(elev)                             # drop points without terrain data
    return {
        "id": ids[ok], "lat": lat[ok], "lon": lon[ok],
        "x_m": x[ok], "y_m": y[ok], "elev_m": elev[ok],
        "level": np.zeros(ok.sum()),
    }


def refine_grid(grid, parent_idx, near, far, inv, spacing_m=2000.0, fine_m=250.0):
    """Level 1: an 8x8 block at fine_m spacing filling each parent's 2 km cell."""
    n = int(round(spacing_m / fine_m))               # 8 -> 64 children per parent
    off = (np.arange(n) - (n - 1) / 2) * fine_m      # cell centres, parent sits in the middle
    OX, OY = np.meshgrid(off, off)
    OX, OY = OX.ravel(), OY.ravel()
    parent_idx = np.asarray(parent_idx)
    x = (grid["x_m"][parent_idx][:, None] + OX).ravel()
    y = (grid["y_m"][parent_idx][:, None] + OY).ravel()
    # 100000 + parent*64 + k: above every level-0 id, unique, exact in float32
    ids = (100_000 + grid["id"][parent_idx][:, None].astype(np.int64) * n * n
           + np.arange(n * n)).ravel()
    lon, lat = inv.transform(x, y)
    lon = (np.asarray(lon) + 180) % 360 - 180        # contract: [-180, 180)
    lat = np.asarray(lat)
    np_, fp = near.params(), far.params()
    elev = np.array([height_at(np_, fp, xi, yi) for xi, yi in zip(x, y)])
    ok = ~np.isnan(elev)
    return {
        "id": ids[ok], "lat": lat[ok], "lon": lon[ok],
        "x_m": x[ok], "y_m": y[ok], "elev_m": elev[ok],
        "level": np.ones(ok.sum()),
    }


def merge_grids(a, b):
    return {k: np.concatenate([a[k], b[k]]) for k in a}


def subsample(grid, n=100, seed=0):
    """Random n points, keeping their real ids (for the first 100-point delivery)."""
    idx = np.sort(np.random.default_rng(seed).choice(len(grid["id"]), n, replace=False))
    return {k: v[idx] for k, v in grid.items()}