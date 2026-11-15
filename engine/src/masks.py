"""Horizon masks (owner: Jacob).

Written with AI assistance (Claude Code and other AI assistants);
reviewed and tested by the team. NASA Space Apps Challenge 2026."""
"""Horizon masks (contract 3.2). Owner: Jacob."""
import numpy as np
from numba import njit, prange
from dem import sample, local_north_east

R_M = 1_737_400.0
# Shared sample distances: denser nearby, sparser far away (~430 samples).
DISTS = np.concatenate([
    np.arange(120, 5_000, 80),
    np.arange(5_000, 30_000, 200),
    np.arange(30_000, 150_001, 500),
]).astype(np.float64)


@njit(cache=True)
def height_at(near, far, x, y):
    """Near DEM first, far DEM as fallback. NaN if neither has data."""
    h = sample(near[0], near[1], near[2], near[3], near[4], x, y)
    if np.isnan(h):
        h = sample(far[0], far[1], far[2], far[3], far[4], x, y)
    return h


@njit(parallel=True, cache=True)
def _masks(xs, ys, h0s, nv, ev, near, far, dists, h_max):
    n_pts = xs.shape[0]
    out = np.empty((n_pts, 720), np.int16)
    for p in prange(n_pts):
        h0 = h0s[p]
        for k in range(720):
            az = np.radians(k * 0.5)
            s, c = np.sin(az), np.cos(az)
            dx = s * ev[p, 0] + c * nv[p, 0]      # ray direction on the map:
            dy = s * ev[p, 1] + c * nv[p, 1]      # sin(az)*east + cos(az)*north
            best = -np.pi / 2
            for d in dists:
                drop = d * d / (2 * R_M)          # curvature: terrain falls away
                # Early exit: even the highest point in the DEM can't beat
                # 'best' from here on (that bound only shrinks with distance).
                if h_max > h0 and np.arctan2(h_max - h0 - drop, d) < best:
                    break
                h = height_at(near, far, xs[p] + d * dx, ys[p] + d * dy)
                if np.isnan(h):
                    continue                       # no data: skip, never treat as 0
                a = np.arctan2(h - h0 - drop, d)
                if a > best:
                    best = a
            out[p, k] = np.int16(np.round(np.degrees(best) * 100))
    return out


def compute_masks(lat, lon, near, far, fwd, h_obs=2.0):
    """Returns (masks int16 [N,720], elev_m [N]) for points given in lat/lon."""
    lat = np.asarray(lat, float)
    lon = np.asarray(lon, float)
    x, y = fwd.transform(lon, lat)
    x, y = np.asarray(x, float), np.asarray(y, float)
    nv, ev = local_north_east(fwd, lat, lon)
    np_, fp = near.params(), far.params()
    elev = np.array([height_at(np_, fp, xi, yi) for xi, yi in zip(x, y)])
    h_max = float(np.nanmax([np.nanmax(near.h), np.nanmax(far.h)]))
    masks = _masks(x, y, elev + h_obs, nv, ev, np_, fp, DISTS, h_max)
    return masks, elev