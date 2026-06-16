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


def _paired_arrays(df: pd.DataFrame, group: str, value: str,
                   levels: list[str], unit_cols: list[str]):
    """Aligned per-unit values for a paired comparison. Each pairing unit (a
    groupby over `unit_cols`, the spine levels coarser than the comparison's home
    — see hierarchy.pairing) contributes its *mean* value under each of the two
    `levels`; units missing either level are dropped (partial pairing). Returns
    (a, b, n_complete, n_units) where a[i]/b[i] are unit i's values under
    levels[0]/levels[1]. Mean is the within-unit combine, matching the figure's
    per-level summary; it never changes what the raw rows plot."""
    sub = df[[*unit_cols, group, value]].dropna(subset=[value])
    cell = (sub.groupby([*unit_cols, group], observed=True)[value]
               .mean().reset_index())
    wide = cell.pivot_table(index=unit_cols, columns=group, values=value,
                            observed=True)
    n_units = int(len(wide))
    if levels[0] not in wide.columns or levels[1] not in wide.columns:
        return np.array([]), np.array([]), 0, n_units
    both = wide.dropna(subset=list(levels))
    return (both[levels[0]].to_numpy(dtype=float),
            both[levels[1]].to_numpy(dtype=float), int(len(both)), n_units)


# The §5 two-group grid: structural (independent vs paired) × assumption
# (parametric vs robust) → one of four tests.
_COMBINE = {("independent", "parametric"): "welch_t",
            ("independent", "robust"): "mann_whitney",
            ("paired", "parametric"): "paired_t",
            ("paired", "robust"): "wilcoxon"}
_PAIRED_TESTS = {"paired_t", "wilcoxon"}
_PARAM_TESTS = {"welch_t", "paired_t"}


def group_comparison(df: pd.DataFrame, x: str, y: str, levels: list[str],
                     alpha: float = 0.05, override: str | None = None,
                     pairing: dict | None = None) -> dict:
    """Two-group comparison as the §5 guided picker: the choice splits on a
    *structural* axis (independent vs paired) and an *assumption* axis
    (parametric vs robust). The structural axis is read from `pairing` (derived
    from the spine — no user declaration); the assumption axis is proposed from a
    Shapiro–Wilk check (each group when independent, the paired differences when
    paired) and confirmable. `override` is a single test name pinning both axes.
    The returned `decision` records each question's recommendation and what was
    chosen (per §5); `recommendation`/`chosen_by` stay for the existing UI."""
    sub = df[[x, y]].dropna()
    found = [lv for lv in levels if lv in set(sub[x])]
    found += sorted(set(sub[x]) - set(levels))
    if len(found) != 2:
        return {"error": f"needs exactly 2 groups (found {len(found)})", "levels": found}

    verdict = (pairing or {}).get("verdict")
    unit_cols = (pairing or {}).get("unit_cols") or []
    paired_possible = bool(unit_cols) and verdict in ("paired", "partially_paired")

    if override in _PAIRED_TESTS and not paired_possible:
        return {"error": "a paired test was requested but the data has no pairing "
                         "structure (no shared unit spans the two groups)",
                "levels": found}

    structural_rec = "paired" if paired_possible else "independent"
    structural_chosen = (("paired" if override in _PAIRED_TESTS else "independent")
                         if override else structural_rec)
    if paired_possible:
        struct_reason = (
            f"the design is {verdict} across {pairing.get('across')} "
            f"({pairing.get('n_complete')}/{pairing.get('n_units')} units carry "
            f"both groups) — a paired test matches the design")
    else:
        struct_reason = ("the two groups share no coarser unit, so the "
                         "observations are independent")

    # Assumption axis — normality of whatever the chosen test will actually see.
    if structural_chosen == "paired":
        a, b, n_pairs, _ = _paired_arrays(df, x, y, found, unit_cols)
        if n_pairs < 3:
            return {"error": f"too few complete pairs to test (found {n_pairs})",
                    "levels": found}
        checks = [{"check": "shapiro_wilk",
                   "group": f"{found[0]} − {found[1]} differences",
                   **shapiro_check(a - b)}]
        small = n_pairs < MIN_N_FOR_NORMALITY_RULE
        normal = bool(checks[0].get("ok") and checks[0]["p"] > alpha)
        n_test = n_pairs
    else:
        a = sub.loc[sub[x] == found[0], y].to_numpy(dtype=float)
        b = sub.loc[sub[x] == found[1], y].to_numpy(dtype=float)
        if min(len(a), len(b)) < 3:
            return {"error": "too few observations per group", "levels": found}
        checks = [{"check": "shapiro_wilk", "group": found[0], **shapiro_check(a)},
                  {"check": "shapiro_wilk", "group": found[1], **shapiro_check(b)}]
        small = min(len(a), len(b)) < MIN_N_FOR_NORMALITY_RULE
        normal = all(c.get("ok") and c["p"] > alpha for c in checks)
        n_test = min(len(a), len(b))

    if small:
        assumption_rec, assume_reason = "robust", (
            f"n = {n_test} is small (< {MIN_N_FOR_NORMALITY_RULE}); the normality "
            "check is underpowered, so the rank-based test is the safe default")
    elif normal:
        assumption_rec, assume_reason = "parametric", (
            "Shapiro–Wilk is consistent with normality")
    else:
        assumption_rec, assume_reason = "robust", (
            "Shapiro–Wilk indicates non-normality")
    assumption_chosen = (("parametric" if override in _PARAM_TESTS else "robust")
                         if override else assumption_rec)

    recommended = _COMBINE[(structural_rec, assumption_rec)]
    test = override or recommended
    decision = {
        "structural": {
            "recommended": structural_rec, "chosen": structural_chosen,
            "chosen_by": ("user_override" if structural_chosen != structural_rec
                          else "recommendation_accepted"),
            "reason": struct_reason,
            "options": ["independent", "paired"] if paired_possible else ["independent"]},
        "assumption": {
            "recommended": assumption_rec, "chosen": assumption_chosen,
            "chosen_by": ("user_override" if assumption_chosen != assumption_rec
                          else "recommendation_accepted"),
            "reason": assume_reason, "options": ["parametric", "robust"]},
    }

    nA, nB = len(a), len(b)
    n_excl = int(df.attrs.get("n_excluded", 0))
    excl_note = f" {n_excl} observation(s) were excluded." if n_excl else ""
    if structural_chosen == "paired":
        excl_note += (f" n counts {nA} complete pairs across "
                      f"{pairing.get('across')}.")

    if test == "paired_t":
        tt = pg.ttest(a, b, paired=True)
        row = tt.iloc[0]
        gd = float(pg.compute_effsize(a, b, paired=True, eftype="hedges"))
        ci_lo, ci_hi = (float(v) for v in _col(row, "CI95", "CI95%"))
        md = float(np.mean(a - b))
        result = {
            "test": "paired_t", "t": float(_col(row, "T")),
            "df": float(_col(row, "dof")), "p": float(_col(row, "p_val", "p-val")),
            "n": nA, "mean_diff": md, "mean_diff_ci": [ci_lo, ci_hi],
            "effect": {"name": "hedges_g", "value": gd, "ci": None},
        }
        methods = (
            f"{y} was compared between {found[0]} and {found[1]} using a paired "
            f"t-test on {nA} matched pairs. t({_col(row,'dof'):.0f}) = "
            f"{_col(row,'T'):.2f}, p {_fmt_p(_col(row,'p_val','p-val'))}; "
            f"Hedges' g = {gd:.2f}; mean difference = {md:.2f} "
            f"(95% CI {ci_lo:.2f} to {ci_hi:.2f}).{excl_note}")
    elif test == "wilcoxon":
        ww = pg.wilcoxon(a, b)
        row = ww.iloc[0]
        W = float(_col(row, "W_val", "W-val"))
        p = float(_col(row, "p_val", "p-val"))
        rbc = float(_col(row, "RBC"))
        result = {
            "test": "wilcoxon", "W": W, "p": p, "n": nA,
            "effect": {"name": "rank_biserial", "value": rbc, "ci": None},
        }
        methods = (
            f"{y} was compared between {found[0]} and {found[1]} using the "
            f"Wilcoxon signed-rank test on {nA} matched pairs. W = {W:.0f}, "
            f"p {_fmt_p(p)}; rank-biserial r = {rbc:.2f}.{excl_note}")
    elif test == "welch_t":
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
        # O(nA·nB) CLES brute force, which alone cost ~14 s on 80k-row groups.
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
            f"using the Mann–Whitney U test. U = {U:.0f}, "
            f"p {_fmt_p(p)}; rank-biserial r = {rbc:.2f}.{excl_note}")

    # per-group summaries for the plot (mean ± 95% CI of the mean), on raw rows
    summaries = []
    for lv in found:
        v = sub.loc[sub[x] == lv, y].to_numpy(dtype=float)
        ci_half = float(sps.t.ppf(0.975, len(v) - 1) * sps.sem(v)) if len(v) > 1 else 0.0
        summaries.append({"group": lv, "n": len(v), "mean": float(np.mean(v)),
                          "sd": float(np.std(v, ddof=1)) if len(v) > 1 else 0.0,
                          "ci95_half": ci_half})

    return {
        "levels": found, "checks": checks,
        "recommendation": {"test": recommended,
                           "reason": f"{struct_reason}; {assume_reason}"},
        "decision": decision,
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
                    alpha: float = 0.05) -> dict:
    """Per-group summaries for the comparison figure with NO inferential test —
    the 'describe only' path. Matches group_comparison's summaries shape so the
    figure (dots, box, bar, mean ± error) renders, but reports no p/effect."""
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


def contingency_test(df: pd.DataFrame, x: str, y: str,
                     x_levels: list[str], y_levels: list[str],
                     alpha: float = 0.05, override: str | None = None) -> dict:
    """Inferential test for a categorical x × categorical y contingency table —
    the §5 categorical×categorical family, independent (unpaired) cell.

    Pearson chi-square is the default; Fisher's exact is recommended for a 2×2
    table when any expected cell count < 5 (the standard small-sample rule). The
    effect size is Cramér's V (general tables) or the odds ratio with a 95% CI
    (2×2). Counts/total/levels are still returned so the tile figure renders from
    the same result. The paired cell (McNemar) is separate — it needs a pairing
    declaration and is handled with the structural axis.

    All inferential numbers come from scipy (chi2_contingency / fisher_exact)."""
    base = contingency_counts(df, x, y, x_levels, y_levels, alpha)
    full = np.array(base["counts"], dtype=float)  # rows = y_levels, cols = x_levels
    n_excl = int(df.attrs.get("n_excluded", 0))
    excl = f" {n_excl} observation(s) were excluded." if n_excl else ""

    # Drop all-zero rows/cols: a schema level with no observations (e.g. after
    # exclusions) contributes nothing and makes chi2_contingency raise. The full
    # matrix is kept in the result for the tile; only the test sees the dense one.
    obs = full[full.sum(axis=1) > 0][:, full.sum(axis=0) > 0]
    if obs.shape[0] < 2 or obs.shape[1] < 2:
        return {"error": "needs at least 2 non-empty levels in each variable for a "
                f"contingency test (found {obs.shape[0]}×{obs.shape[1]})"}

    chi2, p_chi, dof, expected = sps.chi2_contingency(obs, correction=False)
    n = int(obs.sum())
    k = min(obs.shape)
    cramers_v = float(np.sqrt(chi2 / (n * (k - 1)))) if k > 1 else 0.0
    is_2x2 = obs.shape == (2, 2)
    small_expected = bool((expected < 5).any())

    if is_2x2 and small_expected:
        recommended, reason = "fisher_exact", (
            "a 2×2 table with an expected count < 5; Fisher's exact test is the "
            "safe default (chi-square is unreliable for small expected counts)")
    elif is_2x2:
        recommended, reason = "chi_square", (
            "a 2×2 table with all expected counts ≥ 5; the chi-square "
            "approximation is appropriate")
    else:
        recommended, reason = "chi_square", (
            f"a {obs.shape[0]}×{obs.shape[1]} table; the chi-square test is used "
            "(Fisher's exact is offered only for 2×2)")

    test = override or recommended
    if test == "fisher_exact" and not is_2x2:
        test = "chi_square"  # Fisher's exact (scipy) is 2×2 only

    if test == "fisher_exact":
        odds_ratio, p = sps.fisher_exact(obs)
        p = float(p)
        # OR + 95% CI from the cells; Haldane–Anscombe (+0.5) only when a cell is
        # zero, so OR and CI stay finite and mutually consistent.
        cells = obs.reshape(-1)  # [a, b, c, d]
        corr = 0.5 if (cells == 0).any() else 0.0
        ac = cells + corr
        or_val = float((ac[0] * ac[3]) / (ac[1] * ac[2]))
        se = float(np.sqrt((1.0 / ac).sum()))
        ci = [float(np.exp(np.log(or_val) - 1.96 * se)),
              float(np.exp(np.log(or_val) + 1.96 * se))]
        result = {"test": "fisher_exact", "p": p, "n": n,
                  "odds_ratio": or_val,
                  "effect": {"name": "odds_ratio", "value": or_val, "ci": ci}}
        methods = (
            f"The association between {x} and {y} was tested with Fisher's exact "
            f"test (n = {n}). Odds ratio = {or_val:.2f} "
            f"(95% CI {ci[0]:.2f} to {ci[1]:.2f}), p {_fmt_p(p)}.{excl}")
    else:
        result = {"test": "chi_square", "chi2": float(chi2), "dof": int(dof),
                  "p": float(p_chi), "n": n,
                  "effect": {"name": "cramers_v", "value": cramers_v, "ci": None}}
        methods = (
            f"The association between {x} and {y} was tested with Pearson's "
            f"chi-square test of independence (n = {n}). "
            f"χ²({int(dof)}) = {chi2:.2f}, p {_fmt_p(float(p_chi))}; "
            f"Cramér's V = {cramers_v:.2f}.{excl}")

    return {
        "x_levels": base["x_levels"], "y_levels": base["y_levels"],
        "counts": base["counts"], "total": base["total"],
        "levels": [], "checks": [],
        "recommendation": {"test": recommended, "reason": reason},
        "chosen_by": "user_override" if override else "recommendation_accepted",
        "result": result, "summaries": [], "alpha": alpha,
        "methods_text": methods,
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
