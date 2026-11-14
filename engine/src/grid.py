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


def subsample(grid, n=100, seed=0):
    """Random n points, keeping their real ids (for the first 100-point delivery)."""
    idx = np.sort(np.random.default_rng(seed).choice(len(grid["id"]), n, replace=False))
    return {k: v[idx] for k, v in grid.items()}