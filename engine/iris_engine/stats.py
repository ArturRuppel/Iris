"""Group-comparison statistics: assumption checks, recommendation, tests.

All inferential numbers come from scipy/pingouin — never reimplemented.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pingouin as pg
from scipy import stats as sps

MIN_N_FOR_NORMALITY_RULE = 12  # below this, rank-based test is the safe default

# Shapiro–Wilk is hypersensitive at large N: with tens of thousands of points it
# rejects normality for trivially small, irrelevant deviations, which would push
# every large dataset onto the rank-based test. Cap the sample the check sees so
# it stays informative (and fast) instead of always rejecting. The subsample is
# deterministic (fixed seed) so the recommendation is reproducible.
NORMALITY_CAP = 5000
_NORM_RNG_SEED = 0


def _col(row, *names):
    """Read a pingouin result field across versions (0.5: 'p-val', 0.6: 'p_val')."""
    for n in names:
        if n in row:
            return row[n]
    raise KeyError(names)


def _fmt_p(p: float) -> str:
    return "< 0.001" if p < 0.001 else f"= {p:.3f}"


def shapiro_check(values: np.ndarray) -> dict:
    n = len(values)
    if n < 3:
        return {"ok": False, "reason": f"n = {n} < 3"}
    if n > NORMALITY_CAP:
        # see NORMALITY_CAP: assess normality on a deterministic subsample so the
        # check stays meaningful (and milliseconds) at large N.
        rng = np.random.default_rng(_NORM_RNG_SEED)
        sample = rng.choice(values, NORMALITY_CAP, replace=False)
        W, p = sps.shapiro(sample)
        return {"ok": True, "W": float(W), "p": float(p), "n": n,
                "n_assessed": NORMALITY_CAP}
    W, p = sps.shapiro(values)
    return {"ok": True, "W": float(W), "p": float(p), "n": n}


def _aggregate_reps(df: pd.DataFrame, group: str, value: str,
                    rep_key: list[str]) -> pd.DataFrame:
    """Collapse technical replicates to one value per *independent repetition*
    before the stats run, so n and the test reflect independent units rather than
    raw rows (TODO item 10). A unit is (grouping column × repetition key); the
    value within each unit is averaged. The figure still plots the raw rows, so
    this only changes the inferential numbers (mean ± error, the test, and n).
    The combine method is a mean here; choosing a different summary (median, …)
    is the Collapse pipeline step's job, not this one's."""
    keys = [group] + [k for k in rep_key if k and k not in (group, value)]
    agg = (df[[*keys, value]].dropna(subset=[value])
           .groupby(keys, as_index=False, observed=True)[value].mean())
    agg.attrs["n_excluded"] = int(df.attrs.get("n_excluded", 0))
    return agg


def group_comparison(df: pd.DataFrame, x: str, y: str, levels: list[str],
                     alpha: float = 0.05, override: str | None = None,
                     rep_key: list[str] | None = None) -> dict:
    """Two-group comparison matching the frozen analysis-spec semantics. When
    rep_key is set, technical replicates are first collapsed to one value per
    independent unit (see _aggregate_reps) so n and the test count units."""
    if rep_key:
        df = _aggregate_reps(df, x, y, rep_key)
    sub = df[[x, y]].dropna()
    found = [lv for lv in levels if lv in set(sub[x])]
    extra = sorted(set(sub[x]) - set(levels))
    found += extra
    if len(found) != 2:
        return {"error": f"needs exactly 2 groups (found {len(found)})", "levels": found}

    g = {lv: sub.loc[sub[x] == lv, y].to_numpy(dtype=float) for lv in found}
    a, b = g[found[0]], g[found[1]]
    if min(len(a), len(b)) < 3:
        return {"error": "too few observations per group", "levels": found}

    checks = [
        {"check": "shapiro_wilk", "group": found[0], **shapiro_check(a)},
        {"check": "shapiro_wilk", "group": found[1], **shapiro_check(b)},
    ]

    small = min(len(a), len(b)) < MIN_N_FOR_NORMALITY_RULE
    normal = all(c.get("ok") and c["p"] > alpha for c in checks)
    if small:
        recommended, reason = "mann_whitney", (
            f"a group fell below n = {MIN_N_FOR_NORMALITY_RULE}; the normality check is "
            "underpowered, so the rank-based test is the safe default")
    elif normal:
        recommended, reason = "welch_t", (
            "Shapiro\u2013Wilk consistent with normality in both groups "
            f"(p {_fmt_p(checks[0]['p'])}, p {_fmt_p(checks[1]['p'])})")
    else:
        recommended, reason = "mann_whitney", (
            "Shapiro\u2013Wilk indicates non-normality in at least one group")

    test = override or recommended
    nA, nB = len(a), len(b)
    n_excl = int(df.attrs.get("n_excluded", 0))
    excl_note = f" {n_excl} observation(s) were excluded." if n_excl else ""
    if rep_key:
        excl_note += (f" n counts independent repetitions "
                      f"({' × '.join(rep_key)}); technical replicates were "
                      f"averaged within each before testing.")

    if test == "welch_t":
        tt = pg.ttest(a, b, correction=True)
        row = tt.iloc[0]
        gd = float(pg.compute_effsize(a, b, eftype="hedges"))
        se_g = float(np.sqrt((nA + nB) / (nA * nB) + gd**2 / (2 * (nA + nB - 2))))
        ci_lo, ci_hi = (float(v) for v in _col(row, "CI95", "CI95%"))
        result = {
            "test": "welch_t", "t": float(_col(row, "T")), "df": float(_col(row, "dof")),
            "p": float(_col(row, "p_val", "p-val")),
            "mean_diff": float(np.mean(a) - np.mean(b)),
            "mean_diff_ci": [ci_lo, ci_hi],
            "effect": {"name": "hedges_g", "value": gd,
                       "ci": [gd - 1.96 * se_g, gd + 1.96 * se_g]},
        }
        methods = (
            f"{y} was compared between {found[0]} (n = {nA}) and {found[1]} (n = {nB}) "
            f"using Welch's t-test. t({_col(row,'dof'):.1f}) = {_col(row,'T'):.2f}, "
            f"p {_fmt_p(_col(row,'p_val','p-val'))}; Hedges' g = {gd:.2f} "
            f"(95% CI {gd - 1.96 * se_g:.2f} to {gd + 1.96 * se_g:.2f}).{excl_note}")
    else:
        # scipy's asymptotic U matches pingouin's exactly but skips pingouin's
        # O(nA\u00b7nB) CLES brute force, which alone cost ~14 s on 80k-row groups.
        # method="auto" mirrors pingouin's default (exact only for tiny n).
        mw = sps.mannwhitneyu(a, b, alternative="two-sided", method="auto")
        U = float(mw.statistic)
        p = float(mw.pvalue)
        rbc = (2.0 * U) / (nA * nB) - 1.0  # rank-biserial, pingouin's sign
        result = {
            "test": "mann_whitney", "U": U, "p": p,
            "effect": {"name": "rank_biserial", "value": rbc, "ci": None},
        }
        methods = (
            f"{y} was compared between {found[0]} (n = {nA}) and {found[1]} (n = {nB}) "
            f"using the Mann\u2013Whitney U test. U = {U:.0f}, "
            f"p {_fmt_p(p)}; rank-biserial r = {rbc:.2f}.{excl_note}")

    # per-group summaries for the plot (mean ± 95% CI of the mean)
    summaries = []
    for lv in found:
        v = g[lv]
        ci_half = float(sps.t.ppf(0.975, len(v) - 1) * sps.sem(v)) if len(v) > 1 else 0.0
        summaries.append({"group": lv, "n": len(v), "mean": float(np.mean(v)),
                          "sd": float(np.std(v, ddof=1)), "ci95_half": ci_half})

    return {
        "levels": found, "checks": checks,
        "recommendation": {"test": recommended, "reason": reason},
        "chosen_by": "user_override" if override else "recommendation_accepted",
        "result": result, "summaries": summaries, "alpha": alpha,
        "methods_text": methods,
    }


def _summary(label: str, v: np.ndarray) -> dict:
    ci_half = float(sps.t.ppf(0.975, len(v) - 1) * sps.sem(v)) if len(v) > 1 else 0.0
    return {"group": label, "n": len(v), "mean": float(np.mean(v)),
            "sd": float(np.std(v, ddof=1)) if len(v) > 1 else 0.0,
            "ci95_half": ci_half}


def describe_groups(df: pd.DataFrame, x: str, y: str, levels: list[str],
                    alpha: float = 0.05, rep_key: list[str] | None = None) -> dict:
    """Per-group summaries for the comparison figure with NO inferential test —
    the 'describe only' path. Matches group_comparison's summaries shape so the
    figure (dots, box, bar, mean ± error) renders, but reports no p/effect.
    Honors rep_key so the reported n / error bars count independent units."""
    if rep_key:
        df = _aggregate_reps(df, x, y, rep_key)
    sub = df[[x, y]].dropna()
    found = [lv for lv in levels if lv in set(sub[x])]
    found += sorted(set(sub[x]) - set(levels))
    summaries = [_summary(lv, sub.loc[sub[x] == lv, y].to_numpy(dtype=float))
                 for lv in found]
    n_excl = int(df.attrs.get("n_excluded", 0))
    excl = f" {n_excl} observation(s) were excluded." if n_excl else ""
    methods = (f"{y} was summarized by {x} across {len(found)} group(s); "
               f"no statistical test was run (describe only).{excl}")
    return {
        "levels": found, "checks": [],
        "recommendation": {"test": "none", "reason": "describe only — no test was run"},
        "chosen_by": "describe_only",
        "result": {"test": "none", "n": int(len(sub)),
                   "effect": {"name": "none", "value": 0.0, "ci": None}},
        "summaries": summaries, "alpha": alpha, "methods_text": methods,
    }


def describe_pairs(df: pd.DataFrame, x: str, y: str, alpha: float = 0.05) -> dict:
    """Scatter of two numeric columns with NO correlation test — the 'describe
    only' path. Raw points only; no regression line, r, or p."""
    sub = df[[x, y]].dropna()
    n_excl = int(df.attrs.get("n_excluded", 0))
    excl = f" {n_excl} observation(s) were excluded." if n_excl else ""
    return {
        "levels": [], "checks": [],
        "recommendation": {"test": "none", "reason": "describe only — no test was run"},
        "chosen_by": "describe_only",
        "result": {"test": "none", "n": int(len(sub)),
                   "effect": {"name": "none", "value": 0.0, "ci": None}},
        "summaries": [], "alpha": alpha,
        "methods_text": (f"{x} and {y} were plotted without a correlation test "
                         f"(describe only).{excl}"),
    }


def correlation(df: pd.DataFrame, x: str, y: str, alpha: float = 0.05,
                override: str | None = None) -> dict:
    """Pearson/Spearman correlation between two numeric columns, plus the
    OLS line and its 95% CI band for the figure (the band is rendering
    furniture; the inferential numbers come from pingouin)."""
    sub = df[[x, y]].dropna()
    n = len(sub)
    if n < 3:
        return {"error": f"needs at least 3 complete pairs (found {n})"}
    xa = sub[x].to_numpy(dtype=float)
    ya = sub[y].to_numpy(dtype=float)
    if np.ptp(xa) == 0 or np.ptp(ya) == 0:
        return {"error": "a variable is constant — correlation is undefined"}

    checks = [
        {"check": "shapiro_wilk", "group": x, **shapiro_check(xa)},
        {"check": "shapiro_wilk", "group": y, **shapiro_check(ya)},
    ]
    small = n < MIN_N_FOR_NORMALITY_RULE
    normal = all(c.get("ok") and c["p"] > alpha for c in checks)
    if small:
        recommended, reason = "spearman", (
            f"n = {n} < {MIN_N_FOR_NORMALITY_RULE}; the normality check is "
            "underpowered, so the rank-based correlation is the safe default")
    elif normal:
        recommended, reason = "pearson", (
            "Shapiro–Wilk consistent with normality for both variables "
            f"(p {_fmt_p(checks[0]['p'])}, p {_fmt_p(checks[1]['p'])})")
    else:
        recommended, reason = "spearman", (
            "Shapiro–Wilk indicates non-normality in at least one variable")

    test = override or recommended
    row = pg.corr(xa, ya, method=test).iloc[0]
    r = float(_col(row, "r"))
    ci = [float(v) for v in _col(row, "CI95", "CI95%")]
    p = float(_col(row, "p_val", "p-val"))
    eff_name = "pearson_r" if test == "pearson" else "spearman_rho"
    result = {"test": test, "r": r, "p": p, "n": n,
              "effect": {"name": eff_name, "value": r, "ci": ci}}

    n_excl = int(df.attrs.get("n_excluded", 0))
    excl_note = f" {n_excl} observation(s) were excluded." if n_excl else ""
    symbol = "r" if test == "pearson" else "ρ"
    name = "Pearson correlation" if test == "pearson" else "Spearman rank correlation"
    methods = (
        f"The association between {x} and {y} was assessed using {name} "
        f"(n = {n}). {symbol} = {r:.2f} (95% CI {ci[0]:.2f} to {ci[1]:.2f}), "
        f"p {_fmt_p(p)}.{excl_note}")

    # OLS line + 95% CI band on the conditional mean, for the figure
    lr = sps.linregress(xa, ya)
    grid = np.linspace(xa.min(), xa.max(), 100)
    yhat = lr.intercept + lr.slope * grid
    resid = ya - (lr.intercept + lr.slope * xa)
    s_err = np.sqrt(np.sum(resid**2) / (n - 2))
    sxx = np.sum((xa - xa.mean()) ** 2)
    half = (sps.t.ppf(0.975, n - 2) * s_err
            * np.sqrt(1 / n + (grid - xa.mean()) ** 2 / sxx))
    regression = {"slope": float(lr.slope), "intercept": float(lr.intercept),
                  "grid": grid.tolist(), "lo": (yhat - half).tolist(),
                  "hi": (yhat + half).tolist()}

    return {
        "levels": [], "checks": checks,
        "recommendation": {"test": recommended, "reason": reason},
        "chosen_by": "user_override" if override else "recommendation_accepted",
        "result": result, "regression": regression,
        "summaries": [_summary(x, xa), _summary(y, ya)],
        "alpha": alpha, "methods_text": methods,
    }


def contingency_counts(df: pd.DataFrame, x: str, y: str,
                       x_levels: list[str], y_levels: list[str],
                       alpha: float = 0.05) -> dict:
    """Phase 3d: count matrix for a categorical x × categorical y tile plot.
    No inferential test is run here; chi-square is the planned follow-up
    in Tier 2. Returns a shape compatible with the existing stats result
    contract so the compiler can route on it uniformly."""
    sub = df[[x, y]].dropna()
    total = int(len(sub))
    counts = [
        [int(((sub[x] == xl) & (sub[y] == yl)).sum())
         for xl in x_levels]
        for yl in y_levels
    ]
    n_excl = int(df.attrs.get("n_excluded", 0))
    excl = f" {n_excl} observation(s) were excluded." if n_excl else ""
    return {
        "x_levels": x_levels, "y_levels": y_levels, "counts": counts,
        "total": total,
        "levels": [], "checks": [],
        "recommendation": {"test": "none",
                           "reason": "contingency tile — no test (describe only)"},
        "chosen_by": "describe_only",
        "result": {"test": "none", "n": total,
                   "effect": {"name": "none", "value": 0.0, "ci": None}},
        "summaries": [], "alpha": alpha,
        "methods_text": (f"The contingency of {y} × {x} was displayed for "
                         f"n = {total} observations.{excl}"),
    }


def descriptive(df: pd.DataFrame, y: str, alpha: float = 0.05) -> dict:
    """Single numeric variable: distribution summary for the histogram."""
    v = df[y].dropna().to_numpy(dtype=float)
    n = len(v)
    if n < 3:
        return {"error": f"needs at least 3 observations (found {n})"}

    checks = [{"check": "shapiro_wilk", "group": y, **shapiro_check(v)}]
    normal = checks[0].get("ok") and checks[0]["p"] > alpha
    small = n < MIN_N_FOR_NORMALITY_RULE
    if small:
        reason = (f"n = {n} < {MIN_N_FOR_NORMALITY_RULE}; the normality check "
                  "is underpowered — report median (IQR) to be safe")
    elif normal:
        reason = ("Shapiro–Wilk consistent with normality "
                  f"(p {_fmt_p(checks[0]['p'])}) — mean (SD) is appropriate")
    else:
        reason = ("Shapiro–Wilk indicates non-normality "
                  f"(p {_fmt_p(checks[0]['p'])}) — report median (IQR)")

    q1, med, q3 = (float(q) for q in np.percentile(v, [25, 50, 75]))
    result = {"test": "descriptive", "n": n,
              "mean": float(np.mean(v)), "sd": float(np.std(v, ddof=1)),
              "median": med, "q1": q1, "q3": q3,
              "min": float(v.min()), "max": float(v.max()),
              "effect": {"name": "none", "value": 0.0, "ci": None}}

    n_excl = int(df.attrs.get("n_excluded", 0))
    excl_note = f" {n_excl} observation(s) were excluded." if n_excl else ""
    center = (f"mean = {result['mean']:.2f} (SD {result['sd']:.2f})" if normal
              else f"median = {med:.2f} (IQR {q1:.2f}–{q3:.2f})")
    methods = f"{y} was summarized for n = {n} observations: {center}.{excl_note}"

    return {
        "levels": [], "checks": checks,
        "recommendation": {"test": "descriptive", "reason": reason},
        "chosen_by": "default",
        "result": result, "summaries": [_summary(y, v)],
        "alpha": alpha, "methods_text": methods,
    }
