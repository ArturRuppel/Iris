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


def _p_stars(p: float) -> str:
    """Significance stars (the on-figure bracket label vocabulary)."""
    return "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else "ns"


def _no_effect() -> dict:
    """The effect-size slot for a describe-only result (no test run)."""
    return {"name": "none", "value": 0.0, "ci": None}


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


# Multi-group (>2 levels): an omnibus test + corrected pairwise comparisons.
# Parametric → one-way ANOVA with Tukey's HSD (HSD itself controls the family-
# wise error, so the per-pair p is already adjusted); robust → Kruskal–Wallis
# with Holm-adjusted pairwise Mann–Whitney. Override pins the omnibus.
_MULTI_PARAM = {"one_way_anova"}
_MULTI_ROBUST = {"kruskal"}
_MULTI_TESTS = _MULTI_PARAM | _MULTI_ROBUST


def multi_group_comparison(df: pd.DataFrame, x: str, y: str, found: list[str],
                           alpha: float = 0.05,
                           override: str | None = None) -> dict:
    """Compare >2 independent groups: an omnibus test (one-way ANOVA or
    Kruskal–Wallis, chosen on the same normality rule as the two-group picker)
    plus every pairwise comparison with a multiplicity correction. Returns the
    two-group result shape extended with ``result['pairwise']`` (one entry per
    pair, carrying the adjusted p and significance stars) and the omnibus stat,
    so the figure can stack one bracket per reported pair."""
    sub = df[[x, y]].dropna()
    arrays = {lv: sub.loc[sub[x] == lv, y].to_numpy(dtype=float) for lv in found}
    k = len(found)
    N = int(sum(len(a) for a in arrays.values()))
    n_min = min(len(a) for a in arrays.values())
    if n_min < 2:
        return {"error": "every group needs at least 2 observations to compare",
                "levels": found}

    # Assumption axis — same rule as the two-group picker, applied per group.
    checks = [{"check": "shapiro_wilk", "group": lv, **shapiro_check(arrays[lv])}
              for lv in found]
    small = n_min < MIN_N_FOR_NORMALITY_RULE
    normal = all(c.get("ok") and c["p"] > alpha for c in checks)
    if small:
        assumption_rec, assume_reason = "robust", (
            f"the smallest group (n = {n_min}) is < {MIN_N_FOR_NORMALITY_RULE}; "
            "the normality check is underpowered, so the rank-based omnibus is the "
            "safe default")
    elif normal:
        assumption_rec, assume_reason = "parametric", (
            "Shapiro–Wilk is consistent with normality in every group")
    else:
        assumption_rec, assume_reason = "robust", (
            "Shapiro–Wilk indicates non-normality in at least one group")
    recommended = "one_way_anova" if assumption_rec == "parametric" else "kruskal"
    # honour an override only if it names a multi-group omnibus (a stale 2-group
    # override from the UI doesn't apply once there are >2 levels)
    pinned = override if override in _MULTI_TESTS else None
    test = pinned or recommended
    # descriptive only; a pinned test is the user's choice, not a flagged deviation
    chosen_by = "recommendation_accepted"

    if test == "one_way_anova":
        aov = pg.anova(data=sub, dv=y, between=x).iloc[0]
        F = float(_col(aov, "F"))
        p = float(_col(aov, "p-unc", "p_unc"))
        df_b = float(_col(aov, "ddof1"))
        df_w = float(_col(aov, "ddof2"))
        eta = float(_col(aov, "np2"))  # partial η² == η² for one-way
        tuk = pg.pairwise_tukey(data=sub, dv=y, between=x)
        pairwise = []
        for _, r in tuk.iterrows():
            padj = float(_col(r, "p-tukey", "p_tukey"))
            pairwise.append({
                "a": str(r["A"]), "b": str(r["B"]),
                "p": padj, "p_adj": padj, "stars": _p_stars(padj),
                "mean_diff": float(_col(r, "diff")),
                "effect": {"name": "hedges_g", "value": float(_col(r, "hedges"))},
            })
        correction = "tukey"
        result = {
            "test": "one_way_anova", "F": F, "df_between": df_b,
            "df_within": df_w, "p": p, "n": N, "k": k,
            "effect": {"name": "eta_squared", "value": eta, "ci": None},
            "pairwise": pairwise, "correction": correction,
        }
        pair_txt = "; ".join(
            f"{pw['a']} vs {pw['b']} p {_fmt_p(pw['p_adj'])}" for pw in pairwise)
        methods = (
            f"{y} was compared across the {k} levels of {x} (N = {N}) using a "
            f"one-way ANOVA. F({df_b:.0f}, {df_w:.0f}) = {F:.2f}, "
            f"p {_fmt_p(p)}; η² = {eta:.2f}. Pairwise differences used Tukey's "
            f"HSD (family-wise α = {alpha}): {pair_txt}.")
    else:
        kw = pg.kruskal(data=sub, dv=y, between=x).iloc[0]
        H = float(_col(kw, "H"))
        p = float(_col(kw, "p-unc", "p_unc"))
        df_b = float(_col(kw, "ddof1"))
        eps = (H - k + 1) / (N - k) if N > k else 0.0  # epsilon-squared
        pw = pg.pairwise_tests(data=sub, dv=y, between=x, parametric=False,
                               padjust="holm")
        pairwise = []
        for _, r in pw.iterrows():
            praw = float(_col(r, "p-unc", "p_unc"))
            padj = float(_col(r, "p-corr", "p_corr")) if ("p-corr" in r or "p_corr" in r) \
                else praw
            pairwise.append({
                "a": str(r["A"]), "b": str(r["B"]),
                "p": praw, "p_adj": padj, "stars": _p_stars(padj),
            })
        correction = "holm"
        result = {
            "test": "kruskal", "H": H, "df": df_b, "p": p, "n": N, "k": k,
            "effect": {"name": "epsilon_squared", "value": eps, "ci": None},
            "pairwise": pairwise, "correction": correction,
        }
        pair_txt = "; ".join(
            f"{pw['a']} vs {pw['b']} p {_fmt_p(pw['p_adj'])}" for pw in pairwise)
        methods = (
            f"{y} was compared across the {k} levels of {x} (N = {N}) using the "
            f"Kruskal–Wallis test. H({df_b:.0f}) = {H:.2f}, p {_fmt_p(p)}; "
            f"epsilon² = {eps:.2f}. Pairwise differences used Mann–Whitney U with "
            f"Holm correction: {pair_txt}.")

    decision = {
        "structural": {
            "recommended": "independent", "chosen": "independent",
            "chosen_by": "recommendation_accepted",
            "reason": "more than two groups are compared as independent samples "
                      "(paired multi-group designs are not yet supported)",
            "options": ["independent"]},
        "assumption": {
            "recommended": assumption_rec,
            "chosen": "parametric" if test == "one_way_anova" else "robust",
            "chosen_by": chosen_by, "reason": assume_reason,
            "options": ["parametric", "robust"]},
    }
    summaries = [_summary(lv, arrays[lv]) for lv in found]
    return {
        "levels": found, "checks": checks,
        "recommendation": {"test": recommended,
                           "reason": f"{k} groups; {assume_reason}"},
        "decision": decision, "chosen_by": chosen_by,
        "result": result, "summaries": summaries, "alpha": alpha,
        "methods_text": methods,
    }


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
    if len(found) < 2:
        return {"error": f"needs at least 2 groups (found {len(found)})", "levels": found}
    if len(found) > 2:
        # >2 levels: an omnibus test + corrected pairwise comparisons (the
        # multiple-comparison path). Paired multi-group designs (RM-ANOVA /
        # Friedman) are out of scope — this path always treats the groups as
        # independent; a paired declaration folds into the deferred pair_by work.
        return multi_group_comparison(df, x, y, found, alpha=alpha, override=override)

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
        # chosen_by is descriptive only — the user owns the choice, so a pick that
        # differs from the recommendation is not flagged as a deviation.
        "structural": {
            "recommended": structural_rec, "chosen": structural_chosen,
            "chosen_by": "recommendation_accepted",
            "reason": struct_reason,
            "options": ["independent", "paired"] if paired_possible else ["independent"]},
        "assumption": {
            "recommended": assumption_rec, "chosen": assumption_chosen,
            "chosen_by": "recommendation_accepted",
            "reason": assume_reason, "options": ["parametric", "robust"]},
    }

    nA, nB = len(a), len(b)
    pair_note = ""
    if structural_chosen == "paired":
        pair_note += (f" n counts {nA} complete pairs across "
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
            f"(95% CI {ci_lo:.2f} to {ci_hi:.2f}).{pair_note}")
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
            f"p {_fmt_p(p)}; rank-biserial r = {rbc:.2f}.{pair_note}")
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
            f"(95% CI {gd - 1.96 * se_g:.2f} to {gd + 1.96 * se_g:.2f}).{pair_note}")
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
            f"p {_fmt_p(p)}; rank-biserial r = {rbc:.2f}.{pair_note}")

    # per-group summaries for the plot (mean ± 95% CI of the mean), on raw rows
    summaries = [_summary(lv, sub.loc[sub[x] == lv, y].to_numpy(dtype=float))
                 for lv in found]

    return {
        "levels": found, "checks": checks,
        "recommendation": {"test": recommended,
                           "reason": f"{struct_reason}; {assume_reason}"},
        "decision": decision,
        "chosen_by": "recommendation_accepted",  # descriptive only; the user owns the pick
        "result": result, "summaries": summaries, "alpha": alpha,
        "methods_text": methods,
    }


# One-sample (vs-reference) location family: each group tested against a constant
# rather than against another group. The assumption axis (parametric vs robust)
# picks one of these two; an override pins it for every group.
_LOCATION_TESTS = {"one_sample_t", "wilcoxon_signed"}
MIN_LOCATION_N = 3   # below this per group, the one-sample test is skipped


def location(df: pd.DataFrame, x: str | None, y: str, levels: list[str],
             *, reference: float = 0.0, alpha: float = 0.05,
             override: str | None = None, pairing: dict | None = None) -> dict:
    """One-sample (vs-reference) location test: per group, test whether the
    per-replicate values differ from a constant `reference` (default 0) — each
    group against its OWN null, not against another group. The correct design
    when groups are not mutually independent (e.g. fractions that sum to 1), where
    a between-group comparison would be partly tautological.

    Receives the materialized inferential-grain table (as `group_comparison`
    does), so the values tested are per-replicate summaries when a spine is
    declared and raw rows otherwise. The assumption axis (parametric one-sample t
    vs robust Wilcoxon signed-rank) is decided ONCE across groups from the
    per-group Shapiro–Wilk on the differences (the least-normal group wins, as in
    the multi-group omnibus), confirmable via `override`; the chosen test is then
    applied to every group. No automatic multiple-comparison correction — the test
    count is stated in `methods_text` (groups are usually few and the nulls are
    independent). `pairing` is accepted for signature parity but unused (a
    one-sample test has no structural axis).

    Returns a superset of the `group_comparison` contract (`result`/`summaries`/
    `decision`/…) plus `family`/`reference`/`per_group`, so existing readers keep
    working and the compiler can place a per-lane star against the reference."""
    if x:
        sub = df[[x, y]].dropna(subset=[y])
        found = [lv for lv in levels if lv in set(sub[x])]
        found += sorted(set(sub[x]) - set(levels))
        arrays = {lv: sub.loc[sub[x] == lv, y].to_numpy(dtype=float) for lv in found}
    else:
        sub = df[[y]].dropna()
        found = ["all"]
        arrays = {"all": sub[y].to_numpy(dtype=float)}
    if not found:
        return {"error": "no groups to test against the reference", "levels": found}

    n_min = min((len(a) for a in arrays.values()), default=0)
    # Assumption axis — Shapiro–Wilk on each group's differences from the
    # reference, decided once for the figure (the least-normal group wins).
    checks = [{"check": "shapiro_wilk", "group": lv,
               **shapiro_check(arrays[lv] - reference)} for lv in found]
    small = n_min < MIN_N_FOR_NORMALITY_RULE
    normal = all(c.get("ok") and c["p"] > alpha for c in checks)
    if small:
        assumption_rec, assume_reason = "robust", (
            f"the smallest group (n = {n_min}) is < {MIN_N_FOR_NORMALITY_RULE}; "
            "the normality check is underpowered, so the rank-based one-sample "
            "test is the safe default")
    elif normal:
        assumption_rec, assume_reason = "parametric", (
            "Shapiro–Wilk is consistent with normal differences in every group")
    else:
        assumption_rec, assume_reason = "robust", (
            "Shapiro–Wilk indicates non-normal differences in at least one group")
    recommended = "one_sample_t" if assumption_rec == "parametric" else "wilcoxon_signed"
    pinned = override if override in _LOCATION_TESTS else None
    test = pinned or recommended

    per_group = []
    for lv in found:
        v = arrays[lv]
        n = len(v)
        diff = v - reference
        if n < MIN_LOCATION_N:
            # too few units to test this group; report n but no inferential
            # numbers (guards.py warns about the small group separately).
            per_group.append({"level": lv, "test": "none", "p": None, "stars": "",
                              "effect": _no_effect(), "n": n,
                              "center": float(np.mean(v)) if n else 0.0,
                              "center_ci": None})
            continue
        if test == "one_sample_t":
            row = pg.ttest(v, reference).iloc[0]
            t = float(_col(row, "T"))
            dof = float(_col(row, "dof"))
            p = float(_col(row, "p_val", "p-val"))
            # Cohen's dz = mean(diff)/sd(diff), computed directly so it keeps its
            # SIGN (the direction of the effect); pingouin's one-sample cohen_d
            # reports only the magnitude.
            sd_diff = float(np.std(diff, ddof=1))
            dz = float(np.mean(diff) / sd_diff) if sd_diff > 0 else 0.0
            ci = [float(c) for c in _col(row, "CI95", "CI95%")]  # CI of the mean
            md = float(np.mean(diff))
            per_group.append({
                "level": lv, "test": "one_sample_t", "t": t, "df": dof, "p": p,
                "stars": _p_stars(p),
                "effect": {"name": "cohens_dz", "value": dz, "ci": None},
                "n": n, "center": float(np.mean(v)),
                "center_ci": ci, "mean_diff": md,
                "mean_diff_ci": [ci[0] - reference, ci[1] - reference]})
        else:
            row = pg.wilcoxon(diff).iloc[0]
            W = float(_col(row, "W_val", "W-val"))
            p = float(_col(row, "p_val", "p-val"))
            rbc = float(_col(row, "RBC"))
            per_group.append({
                "level": lv, "test": "wilcoxon_signed", "W": W, "p": p,
                "stars": _p_stars(p),
                "effect": {"name": "rank_biserial", "value": rbc, "ci": None},
                "n": n, "center": float(np.median(v)), "center_ci": None,
                "median_diff": float(np.median(diff))})

    tested = [g for g in per_group if g.get("p") is not None]
    decision = {
        "assumption": {
            "recommended": assumption_rec,
            "chosen": "parametric" if test == "one_sample_t" else "robust",
            "chosen_by": "recommendation_accepted", "reason": assume_reason,
            "options": ["parametric", "robust"]},
    }
    summaries = [_summary(lv, arrays[lv]) for lv in found]
    # the top-level `result` mirrors the two-group shape so generic readers keep
    # working: the first tested group, tagged with the chosen test + reference.
    head = tested[0] if tested else (per_group[0] if per_group else {})
    result = {"test": test, "reference": reference,
              "p": head.get("p"), "n": head.get("n", int(len(sub))),
              "effect": head.get("effect", _no_effect())}

    name = "one-sample t-test" if test == "one_sample_t" else "Wilcoxon signed-rank test"
    parts = []
    for g in per_group:
        if g.get("p") is None:
            parts.append(f"{g['level']}: n = {g['n']} (too few to test)")
        elif test == "one_sample_t":
            parts.append(
                f"{g['level']}: t({g['df']:.0f}) = {g['t']:.2f}, p {_fmt_p(g['p'])}; "
                f"dz = {g['effect']['value']:.2f}; mean difference = {g['mean_diff']:.2f} "
                f"(95% CI {g['mean_diff_ci'][0]:.2f} to {g['mean_diff_ci'][1]:.2f})")
        else:
            parts.append(
                f"{g['level']}: W = {g['W']:.0f}, p {_fmt_p(g['p'])}; "
                f"rank-biserial r = {g['effect']['value']:.2f}")
    grp_label = (f"each of the {len(found)} groups of {x}" if x and len(found) > 1
                 else (str(found[0]) if x else y))
    methods = (
        f"{y} in {grp_label} was tested against {reference:g} using a {name} "
        f"({len(tested)} test(s); no multiple-comparison correction applied). "
        + "; ".join(parts) + ".")

    return {
        "family": "location", "reference": reference,
        "levels": found, "checks": checks,
        "recommendation": {"test": recommended, "reason": assume_reason},
        "decision": decision, "chosen_by": "recommendation_accepted",
        "per_group": per_group, "result": result,
        "summaries": summaries, "alpha": alpha, "methods_text": methods,
    }


_RATE_MODELS = ("nb", "poisson", "auto")
MIN_RATE_N = 1            # a group needs at least one observation to estimate a rate
_OVERDISPERSION_RATIO = 1.5   # Pearson χ²/df above this → use NB under "auto"


def _fit_rate_glm(y: np.ndarray, exog: np.ndarray, offset: np.ndarray, model: str):
    """Fit one count GLM with a log-exposure offset. `model` is ``"poisson"`` or
    ``"nb"`` (negative binomial, dispersion estimated). Returns the fitted result
    (or raises). statsmodels is imported lazily so only the rate family pays for
    it (the engine's single statsmodels dependency)."""
    import statsmodels.api as sm
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")    # convergence chatter on small fits
        if model == "poisson":
            return sm.GLM(y, exog, family=sm.families.Poisson(),
                          offset=offset).fit()
        return sm.NegativeBinomial(y, exog, offset=offset).fit(disp=0, maxiter=200)


def _glm_llf(y, exog, offset, model: str) -> float:
    return float(_fit_rate_glm(y, exog, offset, model).llf)


def rate(df: pd.DataFrame, group: str | None, count: str, *,
         exposure: str | None = None, levels: list[str], model: str = "nb",
         alpha: float = 0.05, override: str | None = None,
         pairing: dict | None = None) -> dict:
    """Per-group event RATE from a count GLM with an exposure offset — the count
    analogue of `location` (estimate a rate from counts, not a mean from values).

    For each group, fit ``count ~ 1`` with ``offset = log(exposure)`` (Poisson or
    negative binomial); the rate is ``exp(intercept)`` and the 95% CI is
    ``exp(intercept ± z·SE)`` (the morphogenesis-on-chip recipe). ``model``:
    ``"nb"`` (default — robust to overdispersion), ``"poisson"``, or ``"auto"``
    (fit Poisson, test overdispersion via Pearson χ²/df, refit NB if dispersed).
    A global likelihood-ratio test of ``count ~ C(group)`` vs ``count ~ 1`` (same
    family, offset) answers "does group matter" — the single p the prose cites.

    Receives the materialized inferential-grain table (as group_comparison/
    location do); with a spine the counts and exposures are summed to the unit
    (render forces a sum aggregation for this family). No automatic
    multiple-comparison correction — the test count + global LR are stated in
    `methods_text`. `pairing` is accepted for signature parity, unused.

    Returns a superset of the group_comparison contract (`result`/`summaries`/
    `decision`) plus `family`/`model`/`exposure`/`per_group`, so existing readers
    keep working and the compiler can draw each group's estimate ± model CI."""
    if model not in _RATE_MODELS:
        model = "nb"
    cols = [c for c in (group, count, exposure) if c]
    sub = df[cols].dropna(subset=[count] + ([exposure] if exposure else []))
    if group:
        found = [lv for lv in levels if lv in set(sub[group].astype(str))]
        found += sorted(set(sub[group].astype(str)) - set(map(str, levels)))
    else:
        found = ["all"]
        sub = sub.assign(**{count: sub[count]})
    if not found or not len(sub):
        return {"error": "no groups to estimate a rate for", "levels": found}

    expo_all = (sub[exposure].to_numpy(dtype=float) if exposure
                else np.ones(len(sub)))
    if np.any(expo_all <= 0):
        return {"error": "exposure must be positive to use it as a rate offset"}

    import statsmodels.api as sm
    from scipy import stats as sps
    z = float(sps.norm.ppf(1 - alpha / 2))

    def _subset(lv):
        s = sub if not group else sub[sub[group].astype(str) == lv]
        y = s[count].to_numpy(dtype=float)
        e = s[exposure].to_numpy(dtype=float) if exposure else np.ones(len(s))
        return y, e

    # Model selection. "auto": fit the grouped Poisson and read its overdispersion.
    chosen, auto_note = model, ""
    if model == "auto":
        y_all = sub[count].to_numpy(dtype=float)
        off_all = np.log(expo_all)
        if group and len(found) > 1:
            dummies = pd.get_dummies(sub[group].astype(str), drop_first=True).to_numpy(float)
            exog_full = np.column_stack([np.ones(len(sub)), dummies])
        else:
            exog_full = np.ones((len(sub), 1))
        pois = sm.GLM(y_all, exog_full, family=sm.families.Poisson(),
                      offset=off_all).fit()
        ratio = float(pois.pearson_chi2 / pois.df_resid) if pois.df_resid else 1.0
        chosen = "nb" if ratio > _OVERDISPERSION_RATIO else "poisson"
        auto_note = (f" Model auto-selected: Pearson χ²/df = {ratio:.2f} "
                     f"({'>' if chosen == 'nb' else '≤'} {_OVERDISPERSION_RATIO} "
                     f"→ {'negative binomial' if chosen == 'nb' else 'Poisson'}).")

    per_group, summaries = [], []
    for lv in found:
        y, e = _subset(lv)
        n = len(y)
        k_sum = float(np.sum(y))
        e_sum = float(np.sum(e))
        rate_hat = (k_sum / e_sum) if e_sum else 0.0
        ci = None
        if n >= MIN_RATE_N:
            try:
                res = _fit_rate_glm(y, np.ones((n, 1)), np.log(e), chosen)
                b, se = float(res.params[0]), float(res.bse[0])
                rate_hat = float(np.exp(b))
                if np.isfinite(se):
                    ci = [float(np.exp(b - z * se)), float(np.exp(b + z * se))]
            except Exception:
                ci = None          # degenerate fit: report the empirical rate, no CI
        per_group.append({"level": lv, "rate": rate_hat, "ci": ci, "n": n,
                          "count": k_sum, "exposure": e_sum})
        half = ((ci[1] - ci[0]) / 2) if ci else 0.0
        summaries.append({"group": lv, "n": n, "mean": rate_hat, "sd": 0.0,
                          "ci95_half": half})

    # Global "does group matter" likelihood-ratio test (same family + offset).
    global_p, lr_stat, lr_df = None, None, None
    if group and len(found) > 1:
        y_all = sub[count].to_numpy(dtype=float)
        off_all = np.log(expo_all)
        try:
            dummies = pd.get_dummies(sub[group].astype(str), drop_first=True).to_numpy(float)
            exog_full = np.column_stack([np.ones(len(sub)), dummies])
            ll_null = _glm_llf(y_all, np.ones((len(sub), 1)), off_all, chosen)
            ll_full = _glm_llf(y_all, exog_full, off_all, chosen)
            lr_stat = float(2 * (ll_full - ll_null))
            lr_df = int(len(found) - 1)
            global_p = float(sps.chi2.sf(lr_stat, lr_df)) if lr_stat >= 0 else None
        except Exception:
            global_p = None

    model_name = "negative-binomial GLM" if chosen == "nb" else "Poisson GLM"
    test_id = "nb_glm" if chosen == "nb" else "poisson_glm"
    decision = {"model": chosen, "global": {
        "test": "likelihood_ratio", "stat": lr_stat, "df": lr_df, "p": global_p}}
    result = {"test": test_id, "p": global_p, "n": int(len(sub)),
              "effect": _no_effect()}

    parts = [f"{g['level']}: rate = {g['rate']:.3g}"
             + (f" (95% CI {g['ci'][0]:.3g} to {g['ci'][1]:.3g})" if g["ci"] else "")
             + f", n = {g['n']}" for g in per_group]
    expo_txt = f" with log({exposure}) as exposure offset" if exposure else ""
    glob = ("" if global_p is None else
            f" Global likelihood-ratio test (does {group} matter): "
            f"χ²({lr_df}) = {lr_stat:.2f}, p {_fmt_p(global_p)}.")
    methods = (f"{count} was modelled per group of {group} with a {model_name}"
               f"{expo_txt} ({len(found)} group(s); no multiple-comparison "
               f"correction). " + "; ".join(parts) + "." + glob + auto_note)

    return {
        "family": "rate", "model": chosen, "exposure": exposure,
        "levels": found, "checks": [],
        "recommendation": {"test": test_id, "reason": f"count regression ({model_name})"},
        "decision": decision, "chosen_by": "inferred",
        "per_group": per_group, "result": result,
        "summaries": summaries, "alpha": alpha, "methods_text": methods,
    }


def _summary(label: str, v: np.ndarray) -> dict:
    n = len(v)
    ci_half = float(sps.t.ppf(0.975, n - 1) * sps.sem(v)) if n > 1 else 0.0
    return {"group": label, "n": n,
            "mean": float(np.mean(v)) if n else 0.0,
            "sd": float(np.std(v, ddof=1)) if n > 1 else 0.0,
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
    methods = (f"{y} was summarized by {x} across {len(found)} group(s); "
               f"no statistical test was run (describe only).")
    return {
        "levels": found, "checks": [],
        "recommendation": {"test": "none", "reason": "describe only — no test was run"},
        "chosen_by": "describe_only",
        "result": {"test": "none", "n": int(len(sub)),
                   "effect": _no_effect()},
        "summaries": summaries, "alpha": alpha, "methods_text": methods,
    }


def timeseries(df: pd.DataFrame, x: str, y: str, alpha: float = 0.05) -> dict:
    """Time series of `y` over an ordered numeric `x`, described only — no
    inferential test in the first cut (comparing time courses properly needs
    mixed-effects / functional-data methods that don't fit the two-question
    picker). Reports the span of timepoints and the n of (x, y) observations so
    the stats panel has a legible summary; the figure computes its own
    per-timepoint means/bands and per-unit curves internally."""
    sub = df[[x, y]].dropna()
    n = int(len(sub))
    n_tp = int(sub[x].nunique())
    span = (f" over {sub[x].min():g}–{sub[x].max():g}" if n else "")
    methods = (f"{y} was plotted over {x} ({n_tp} timepoint(s){span}, "
               f"{n} observation(s)); no statistical test was run "
               f"(describe only).")
    return {
        "levels": [], "checks": [],
        "recommendation": {"test": "none", "reason": "describe only — no test was run"},
        "chosen_by": "describe_only",
        "result": {"test": "none", "n": n, "n_timepoints": n_tp,
                   "effect": _no_effect()},
        "summaries": [], "alpha": alpha, "methods_text": methods,
    }


def describe_pairs(df: pd.DataFrame, x: str, y: str, alpha: float = 0.05) -> dict:
    """Scatter of two numeric columns with NO correlation test — the 'describe
    only' path. Raw points only; no regression line, r, or p."""
    sub = df[[x, y]].dropna()
    return {
        "levels": [], "checks": [],
        "recommendation": {"test": "none", "reason": "describe only — no test was run"},
        "chosen_by": "describe_only",
        "result": {"test": "none", "n": int(len(sub)),
                   "effect": _no_effect()},
        "summaries": [], "alpha": alpha,
        "methods_text": (f"{x} and {y} were plotted without a correlation test "
                         f"(describe only)."),
    }


def _per_unit_correlation(sub: pd.DataFrame, x: str, y: str, unit_cols: list[str],
                          test: str, alpha: float) -> dict | None:
    """Replicate-level coefficient: one correlation per inferential unit, then the
    association tested ACROSS units (one-sample t on Fisher-z of the per-unit r vs
    0). This is the correlation analogue of how group_comparison/location/rate
    collapse to the spine's coarsest level — the unit, not the row, is n. Returns
    the `result` dict, or None when too few units carry a defined coefficient (the
    caller then falls back to pooling)."""
    rs, kept = [], []
    for key, g in sub.groupby(unit_cols, sort=False):
        xa, ya = g[x].to_numpy(float), g[y].to_numpy(float)
        if len(g) < 3 or np.ptp(xa) == 0 or np.ptp(ya) == 0:
            continue            # an undefined within-unit r cannot enter the test
        ri = pg.corr(xa, ya, method=test).iloc[0]
        rs.append(float(_col(ri, "r")))
        kept.append(key)
    if len(rs) < 3:
        return None
    rs = np.asarray(rs, dtype=float)
    z = np.arctanh(np.clip(rs, -0.999, 0.999))   # Fisher transform, then t vs 0
    tt = sps.ttest_1samp(z, 0.0)
    r_bar = float(rs.mean())
    ci_z = sps.t.interval(1 - alpha, len(z) - 1, loc=z.mean(),
                          scale=sps.sem(z)) if len(z) > 1 else (np.nan, np.nan)
    ci = [float(np.tanh(v)) for v in ci_z]
    eff_name = "pearson_r" if test == "pearson" else "spearman_rho"
    return {"test": test, "r": r_bar, "p": float(tt.pvalue), "n": len(rs),
            "unit": list(unit_cols), "per_unit_r": rs.tolist(),
            "effect": {"name": eff_name, "value": r_bar, "ci": ci}}


def _ols_band(xa: np.ndarray, ya: np.ndarray) -> dict:
    """OLS line + 95% CI band on the conditional mean — figure furniture only."""
    n = len(xa)
    lr = sps.linregress(xa, ya)
    grid = np.linspace(xa.min(), xa.max(), 100)
    yhat = lr.intercept + lr.slope * grid
    resid = ya - (lr.intercept + lr.slope * xa)
    s_err = np.sqrt(np.sum(resid**2) / (n - 2))
    sxx = np.sum((xa - xa.mean()) ** 2)
    half = (sps.t.ppf(0.975, n - 2) * s_err
            * np.sqrt(1 / n + (grid - xa.mean()) ** 2 / sxx))
    return {"slope": float(lr.slope), "intercept": float(lr.intercept),
            "grid": grid.tolist(), "lo": (yhat - half).tolist(),
            "hi": (yhat + half).tolist()}


def _corr_on(sub: pd.DataFrame, x: str, y: str, test: str, alpha: float,
             unit_cols: list[str] | None) -> dict | None:
    """The inferential `result` for one (sub)frame: replicate-level when a spine
    is given and resolvable, else the pooled pingouin coefficient. None when the
    frame can't yield a defined coefficient (constant axis / < 3 pairs)."""
    xa, ya = sub[x].to_numpy(float), sub[y].to_numpy(float)
    if len(sub) < 3 or np.ptp(xa) == 0 or np.ptp(ya) == 0:
        return None
    if unit_cols:
        unit_result = _per_unit_correlation(sub, x, y, unit_cols, test, alpha)
        if unit_result is not None:
            return unit_result
    row = pg.corr(xa, ya, method=test).iloc[0]
    eff_name = "pearson_r" if test == "pearson" else "spearman_rho"
    r = float(_col(row, "r"))
    ci = [float(v) for v in _col(row, "CI95", "CI95%")]
    return {"test": test, "r": r, "p": float(_col(row, "p_val", "p-val")),
            "n": len(sub), "effect": {"name": eff_name, "value": r, "ci": ci}}


def correlation(df: pd.DataFrame, x: str, y: str, alpha: float = 0.05,
                override: str | None = None,
                unit_cols: list[str] | None = None,
                group_col: str | None = None) -> dict:
    """Pearson/Spearman correlation between two numeric columns, plus the
    OLS line and its 95% CI band for the figure (the band is rendering
    furniture; the inferential numbers come from pingouin).

    With `unit_cols` (the hierarchy spine), the inferential unit is the coarsest
    spine level, not the row: a per-unit coefficient is computed and the
    association is tested across units (Fisher-z one-sample t). Cell-level rows are
    pseudoreplicated, so a declared spine makes correlation honour the replicate as
    the unit, matching the other families. No spine → the historical pooled test.

    With `group_col` (a categorical grouping, typically the colour encoding), the
    association is computed PER group — a `per_group` list, each entry carrying its
    own coefficient and OLS band, so the figure draws one line + readout per group.
    This answers "does the X–Y relationship differ by group?". It composes with the
    spine: each group's coefficient is itself replicate-level when `unit_cols` is
    set. The top-level `result`/`regression` stay the pooled (group-agnostic)
    values, so existing readers are unaffected."""
    sub = df[[c for c in (x, y, group_col, *(unit_cols or [])) if c]].dropna()
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
    # Pooled (group-agnostic) result + band stay the top-level contract.
    result = _corr_on(sub, x, y, test, alpha, unit_cols)
    r, ci, p = result["r"], result["effect"]["ci"], result["p"]
    spined = unit_cols and result.get("unit")

    # Stratified: one coefficient + OLS band per group (the colour encoding).
    per_group = []
    if group_col and group_col in sub:
        for lv, g in sub.groupby(group_col, sort=False):
            gres = _corr_on(g, x, y, test, alpha, unit_cols)
            if gres is None:
                continue
            per_group.append({"level": str(lv), **gres,
                              "regression": _ols_band(g[x].to_numpy(float),
                                                      g[y].to_numpy(float))})

    # Spine but no colour group: one within-unit OLS band per replicate, so the
    # figure can draw the honest within-replicate lines instead of the pooled fit
    # (whose sign can invert under pseudoreplication — Simpson's paradox). Figure
    # furniture only; the inferential readout stays the single across-unit
    # `result`. Same ≥3-pairs / non-constant guard as _per_unit_correlation, so a
    # unit appears here iff it contributed a coefficient to the test.
    unit_regressions = []
    if spined and not per_group:
        for key, g in sub.groupby(unit_cols, sort=False):
            gx, gy = g[x].to_numpy(float), g[y].to_numpy(float)
            if len(g) < 3 or np.ptp(gx) == 0 or np.ptp(gy) == 0:
                continue
            lv = "/".join(map(str, key)) if isinstance(key, tuple) else str(key)
            unit_regressions.append({"level": lv, "regression": _ols_band(gx, gy)})

    symbol = "r" if test == "pearson" else "ρ"
    name = "Pearson correlation" if test == "pearson" else "Spearman rank correlation"
    grain = (f" within each {'/'.join(unit_cols)} and tested across replicates "
             "(Fisher-z one-sample t)" if spined else "")
    if per_group:
        per_txt = "; ".join(f"{g['level']}: {symbol} = {g['r']:.2f}, p {_fmt_p(g['p'])}"
                            for g in per_group)
        methods = (f"The association between {x} and {y} was assessed by {name}{grain}, "
                   f"computed separately within each {group_col} group — {per_txt}.")
    elif spined:
        methods = (
            f"The association between {x} and {y} was assessed by {name} computed "
            f"within each {'/'.join(unit_cols)} and tested across the "
            f"{result['n']} units (one-sample t on Fisher-z of the per-unit "
            f"coefficient). mean {symbol} = {r:.2f} (95% CI {ci[0]:.2f} to "
            f"{ci[1]:.2f}), p {_fmt_p(p)}.")
    else:
        methods = (
            f"The association between {x} and {y} was assessed using {name} "
            f"(n = {n}). {symbol} = {r:.2f} (95% CI {ci[0]:.2f} to {ci[1]:.2f}), "
            f"p {_fmt_p(p)}.")

    out = {
        "levels": [g["level"] for g in per_group], "checks": checks,
        "recommendation": {"test": recommended, "reason": reason},
        "chosen_by": "recommendation_accepted",  # descriptive only; the user owns the pick
        "result": result, "regression": _ols_band(xa, ya),
        "summaries": [_summary(x, xa), _summary(y, ya)],
        "alpha": alpha, "methods_text": methods,
    }
    if per_group:
        out["per_group"] = per_group
    if unit_regressions:
        out["unit_regressions"] = unit_regressions
    return out


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
    return {
        "x_levels": x_levels, "y_levels": y_levels, "counts": counts,
        "total": total,
        "levels": [], "checks": [],
        "recommendation": {"test": "none",
                           "reason": "contingency tile — no test (describe only)"},
        "chosen_by": "describe_only",
        "result": {"test": "none", "n": total,
                   "effect": _no_effect()},
        "summaries": [], "alpha": alpha,
        "methods_text": (f"The contingency of {y} × {x} was displayed for "
                         f"n = {total} observations."),
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

    # Drop all-zero rows/cols: a schema level with no observations contributes
    # nothing and makes chi2_contingency raise. The full matrix is kept in the
    # result for the tile; only the test sees the dense one.
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
            f"(95% CI {ci[0]:.2f} to {ci[1]:.2f}), p {_fmt_p(p)}.")
    else:
        result = {"test": "chi_square", "chi2": float(chi2), "dof": int(dof),
                  "p": float(p_chi), "n": n,
                  "effect": {"name": "cramers_v", "value": cramers_v, "ci": None}}
        methods = (
            f"The association between {x} and {y} was tested with Pearson's "
            f"chi-square test of independence (n = {n}). "
            f"χ²({int(dof)}) = {chi2:.2f}, p {_fmt_p(float(p_chi))}; "
            f"Cramér's V = {cramers_v:.2f}.")

    return {
        "x_levels": base["x_levels"], "y_levels": base["y_levels"],
        "counts": base["counts"], "total": base["total"],
        "levels": [], "checks": [],
        "recommendation": {"test": recommended, "reason": reason},
        "chosen_by": "recommendation_accepted",  # descriptive only; the user owns the pick
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
              "effect": _no_effect()}

    center = (f"mean = {result['mean']:.2f} (SD {result['sd']:.2f})" if normal
              else f"median = {med:.2f} (IQR {q1:.2f}–{q3:.2f})")
    methods = f"{y} was summarized for n = {n} observations: {center}."

    return {
        "levels": [], "checks": checks,
        "recommendation": {"test": "descriptive", "reason": reason},
        "chosen_by": "default",
        "result": result, "summaries": [_summary(y, v)],
        "alpha": alpha, "methods_text": methods,
    }
