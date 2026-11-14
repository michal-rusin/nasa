"""validation.json (contract section 6). Owner: Jacob."""
import json
import numpy as np
from metrics import series_one, enu


def pick_validation_points(metrics):
    """Indices of contrasting points: sunniest, darkest, median sun, best Earth."""
    sun, earth = metrics[:, 0], metrics[:, 2]
    picks = [
        int(np.nanargmax(sun)),
        int(np.nanargmin(sun)),
        int(np.nanargmin(np.abs(sun - np.nanmedian(sun)))),
        int(np.nanargmax(earth)),
    ]
    return list(dict.fromkeys(picks))          # drop duplicates, keep order


def build_validation(idx, ids, lat, lon, elev, masks, ephem, r_sun=0.2666):
    """Full hourly series for the chosen points, via the same series_one as metrics."""
    idx = np.asarray(idx)
    U, E, N, P = enu(np.asarray(lat, float)[idx], np.asarray(lon, float)[idx],
                     np.asarray(elev)[idx])
    e = np.asarray(ephem, np.float64)
    records = []
    for k, i in enumerate(idx):
        f, g = series_one(U[k], E[k], N[k], P[k], masks[i], e[:, :3], e[:, 3:], r_sun)
        records.append({
            "id": int(ids[i]),
            "sun_f": np.round(f, 4).tolist(),       # 4 decimals keeps the file small
            "earth_g": g.astype(int).tolist(),
            "sun_pct": round(100 * f.mean(), 2),    # from unrounded f, same as candidates.bin
            "earth_pct": round(100 * g.mean(), 2),
        })
    return records


def write_validation(path, records):
    with open(path, "w") as fh:
        json.dump(records, fh)