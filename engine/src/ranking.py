"""Michał's frontend ranking, reimplemented to pick refinement parents. Owner: Jacob."""
import numpy as np

# (name, +1 more is better / -1 less is better, default weight) - same as the frontend
METRICS = [("sun_pct", +1, 3), ("earth_pct", +1, 2), ("longest_night_h", -1, 2),
           ("longest_comm_gap_h", -1, 1), ("slope_deg", -1, 2), ("dist_psr_km", -1, 1)]
METRIC_COLS = {"sun_pct": 0, "longest_night_h": 1, "earth_pct": 2, "longest_comm_gap_h": 3}


def pct_norm(v, higher_better):
    """Percentile rank in [0, 1]; ties get their average rank; NaN -> 0."""
    v = np.asarray(v, np.float64)
    out = np.zeros(v.shape[0])
    ok = ~np.isnan(v)
    m = int(ok.sum())
    if m == 0:
        return out
    if m == 1:
        out[ok] = 1.0
        return out
    _, inv, counts = np.unique(v[ok], return_inverse=True, return_counts=True)
    first = np.cumsum(counts) - counts                 # 0-based rank of each value's first copy
    avg_rank = first + (counts - 1) / 2.0
    t = avg_rank[inv] / (m - 1)
    out[ok] = t if higher_better else 1.0 - t
    return out


def score(norms, weights):
    """norms [N, 6] in METRICS order -> weighted mean. Negative weights count as 0."""
    w = np.maximum(np.asarray(weights, np.float64), 0.0)
    s = w.sum()
    if s == 0:
        return np.zeros(norms.shape[0])
    return norms @ w / s


def top_n_nms(score, x, y, passed_mask, n=10, radius_km=5):
    """Top n by score (ties: lower index first), skipping points within radius of a pick."""
    cand = np.flatnonzero(passed_mask & ~np.isnan(score))
    order = cand[np.argsort(-score[cand], kind="stable")]   # cand is ascending -> stable = lower index wins
    r = radius_km * 1000.0
    sel = []
    for i in order:
        if sel and np.any(np.hypot(x[sel] - x[i], y[sel] - y[i]) < r):
            continue
        sel.append(i)
        if len(sel) == n:
            break
    return np.array(sel, dtype=np.int64)


def ranking_parents(grid, m, n_random=3000, seed=0):
    """Union of the frontend's top-10 lists over many weightings and filters (level-0 points)."""
    lvl0 = np.flatnonzero(grid["level"] == 0)
    vals = {name: (m[lvl0, METRIC_COLS[name]] if name in METRIC_COLS else grid[name][lvl0])
            for name, _, _ in METRICS}
    # Normalized once over all level-0 points; filters only restrict the list
    norms = np.stack([pct_norm(vals[name], d > 0) for name, d, _ in METRICS], axis=1)
    x, y = grid["x_m"][lvl0], grid["y_m"][lvl0]
    default = np.array([w for _, _, w in METRICS], np.float64)
    rng = np.random.default_rng(seed)
    everyone = np.ones(len(lvl0), bool)

    picked = set()
    def add(weights, passed):
        picked.update(top_n_nms(score(norms, weights), x, y, passed).tolist())

    add(default, everyone)
    for w in np.eye(len(METRICS)):
        add(w, everyone)
    for w in rng.dirichlet(np.ones(len(METRICS)), n_random):
        add(w, everyone)
    with np.errstate(invalid="ignore"):                # NaN compares False -> filtered out
        filters = [vals["slope_deg"] <= 5, vals["slope_deg"] <= 10,
                   vals["earth_pct"] >= 50, vals["sun_pct"] >= 50]
    for passed in filters:
        add(default, passed)
        for w in rng.dirichlet(np.ones(len(METRICS)), 300):
            add(w, passed)
    return np.sort(lvl0[np.array(sorted(picked), dtype=np.int64)])
