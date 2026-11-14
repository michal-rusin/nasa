"""Sun visibility f, Earth visibility g, and per-point metrics (owner: Jacob)."""
"""Sun fraction f, Earth visibility g, metrics (contract 2.1-2.3). Owner: Jacob."""
import numpy as np
from numba import njit, prange

R_KM = 1737.4


@njit(cache=True)
def mask_at(mask, az):
    """Mask height (deg) at azimuth az, linear interpolation between 0.5° samples."""
    pos = az / 0.5
    i = int(np.floor(pos))
    fr = pos - i
    a = mask[i % 720] / 100.0
    b = mask[(i + 1) % 720] / 100.0
    return a * (1 - fr) + b * fr


@njit(cache=True)
def series_one(U, E, N, P, mask, sun, earth, r_sun):
    """Hourly f (sun disc fraction) and g (Earth visible 0/1) for one point."""
    T = sun.shape[0]
    f = np.empty(T)
    g = np.empty(T)
    for t in range(T):
        # Sun: direction from Moon centre is enough (parallax < 0.001°)
        su = sun[t, 0] * U[0] + sun[t, 1] * U[1] + sun[t, 2] * U[2]
        se = sun[t, 0] * E[0] + sun[t, 1] * E[1] + sun[t, 2] * E[2]
        sn = sun[t, 0] * N[0] + sun[t, 1] * N[1] + sun[t, 2] * N[2]
        el = np.degrees(np.arcsin(min(1.0, max(-1.0, su))))
        az = np.degrees(np.arctan2(se, sn)) % 360.0
        d = (el - mask_at(mask, az)) / r_sun
        if d <= -1:
            f[t] = 0.0
        elif d >= 1:
            f[t] = 1.0
        else:   # area of the disc above a straight horizon line
            f[t] = (np.arccos(-d) + d * np.sqrt(1 - d * d)) / np.pi
        # Earth: vector from the POINT, not the centre (parallax up to 0.26°)
        vx, vy, vz = earth[t, 0] - P[0], earth[t, 1] - P[1], earth[t, 2] - P[2]
        ln = np.sqrt(vx * vx + vy * vy + vz * vz)
        eu = (vx * U[0] + vy * U[1] + vz * U[2]) / ln
        ee = vx * E[0] + vy * E[1] + vz * E[2]
        en = vx * N[0] + vy * N[1] + vz * N[2]
        el_e = np.degrees(np.arcsin(min(1.0, max(-1.0, eu))))
        az_e = np.degrees(np.arctan2(ee, en)) % 360.0
        g[t] = 1.0 if el_e > mask_at(mask, az_e) else 0.0
    return f, g


@njit(cache=True)
def longest_run(cond_arr):
    """Longest streak of True. Period is a segment, not a loop (contract 2.3)."""
    best = 0
    run = 0
    for v in cond_arr:
        run = run + 1 if v else 0
        if run > best:
            best = run
    return best


@njit(parallel=True, cache=True)
def _metrics(U, E, N, P, masks, sun, earth, r_sun, night_thr, step_h):
    out = np.empty((U.shape[0], 4))
    for p in prange(U.shape[0]):
        f, g = series_one(U[p], E[p], N[p], P[p], masks[p], sun, earth, r_sun)
        out[p, 0] = 100.0 * f.mean()                       # sun_pct
        out[p, 1] = longest_run(f < night_thr) * step_h    # longest_night_h
        out[p, 2] = 100.0 * g.mean()                       # earth_pct
        out[p, 3] = longest_run(g == 0) * step_h           # longest_comm_gap_h
    return out


@njit(cache=True)
def longest_overlap(cond_arr, starts, ends, out):
    """out[k] = longest streak of True that overlaps year k = [starts[k], ends[k]).
    Streaks are found on the whole series, so one crossing Jan 1 counts in full in both years."""
    T = cond_arr.shape[0]
    t = 0
    while t < T:
        if not cond_arr[t]:
            t += 1
            continue
        a = t
        while t < T and cond_arr[t]:
            t += 1
        n = t - a                                  # streak is [a, t)
        for k in range(starts.shape[0]):
            if a < ends[k] and t > starts[k] and n > out[k]:
                out[k] = n


@njit(parallel=True, cache=True)
def _longest_by_year(U, E, N, P, masks, sun, earth, r_sun, night_thr, step_h, starts, ends):
    Y = starts.shape[0]
    out = np.zeros((U.shape[0], Y, 2))
    for p in prange(U.shape[0]):
        f, g = series_one(U[p], E[p], N[p], P[p], masks[p], sun, earth, r_sun)
        night = np.zeros(Y, np.int64)
        gap = np.zeros(Y, np.int64)
        longest_overlap(f < night_thr, starts, ends, night)
        longest_overlap(g == 0, starts, ends, gap)
        for k in range(Y):
            out[p, k, 0] = night[k] * step_h       # longest_night_h
            out[p, k, 1] = gap[k] * step_h         # longest_comm_gap_h
    return out


def enu(lat, lon, elev_m,h_obs=2.0):
    """Contract 1.2: U, E, N unit vectors and position P (km) per point."""
    la, lo = np.radians(lat), np.radians(lon)
    U = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)
    E = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)], -1)
    N = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)], -1)
    P = (R_KM + (np.asarray(elev_m) + h_obs) / 1000.0)[:, None] * U
    return U, E, N, P


def compute_metrics(lat, lon, elev_m, masks, ephem, step_h=1.0, r_sun=0.2666, night_thr=0.01, h_obs=2.0):
    """Returns [N, 4]: sun_pct, longest_night_h, earth_pct, longest_comm_gap_h."""
    U, E, N, P = enu(np.asarray(lat, float), np.asarray(lon, float), elev_m, h_obs)
    e = np.asarray(ephem, np.float64)
    return _metrics(U, E, N, P, masks, e[:, :3], e[:, 3:], r_sun, night_thr, step_h)


def longest_by_year(lat, lon, elev_m, masks, ephem, starts, ends, step_h=1.0, r_sun=0.2666,
                    night_thr=0.01, h_obs=2.0):
    """Returns [N, n_years, 2]: longest_night_h, longest_comm_gap_h overlapping each year,
    found on the full ephem series (no calendar cut at Jan 1)."""
    U, E, N, P = enu(np.asarray(lat, float), np.asarray(lon, float), elev_m, h_obs)
    e = np.asarray(ephem, np.float64)
    return _longest_by_year(U, E, N, P, masks, e[:, :3], e[:, 3:], r_sun, night_thr, step_h,
                            np.asarray(starts, np.int64), np.asarray(ends, np.int64))