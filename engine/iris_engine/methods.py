"""Assemble a methods paragraph + a statistics table from computed analyses.

Pure formatting: no HTTP, no matplotlib, no data access. The inference already
happened in `stats.py` — every analysis carries a ready `methods_text` sentence
and a structured `result`. This module gathers those across a whole document,
adds a data-shaping preamble the per-test sentence doesn't cover and a
software-citation line from the engine identity, and serialises to Markdown (a
methods section + a stats table) or CSV (the stats table alone).

The contract of one `analysis` here: ``{"title", "spec", "stats", "stat_model"}``
where `stats` is the `stats.py` result dict and `spec` is the normalised spec.
"""
from __future__ import annotations

import csv
import io
import math

# Human names for the test ids stats.py emits (result["test"]).
TEST_NAMES = {
    "welch_t": "Welch's t-test",
    "paired_t": "paired t-test",
    "mann_whitney": "Mann–Whitney U test",
    "wilcoxon": "Wilcoxon signed-rank test",
    "one_way_anova": "one-way ANOVA",
    "kruskal": "Kruskal–Wallis test",
    "one_sample_t": "one-sample t-test",
    "wilcoxon_signed": "Wilcoxon signed-rank test",
    "pearson": "Pearson correlation",
    "spearman": "Spearman rank correlation",
    "chi_square": "Pearson's chi-square test",
    "fisher_exact": "Fisher's exact test",
    "nb_glm": "negative-binomial GLM",
    "poisson_glm": "Poisson GLM",
}

# Human names for the effect-size ids (result["effect"]["name"]).
EFFECT_NAMES = {
    "hedges_g": "Hedges' g",
    "rank_biserial": "rank-biserial r",
    "cohens_dz": "Cohen's dz",
    "pearson_r": "Pearson r",
    "spearman_rho": "Spearman ρ",
    "eta_squared": "η²",
    "epsilon_squared": "ε²",
    "cramers_v": "Cramér's V",
    "odds_ratio": "odds ratio",
}

TABLE_COLUMNS = ["Analysis", "Comparison", "Test", "n", "Statistic", "p",
                 "Effect size"]

# result["test"] values that carry no inferential row (prose only).
_NO_TEST = {"none", "descriptive", ""}


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


def _num(x, prec: int = 2) -> str:
    """A statistic/estimate for a cell: fixed precision, em-dash for a missing or
    non-finite value (stats.py legitimately yields NaN effect sizes on degenerate
    groups; `_json_safe` turns those into None on the way through HTTP)."""
    return f"{x:.{prec}f}" if _finite(x) else "—"


def _sig(x, digits: int = 3) -> str:
    """Significant-figures variant for rates, which span orders of magnitude."""
    return f"{x:.{digits}g}" if _finite(x) else "—"


def _df(x) -> str:
    """Degrees of freedom: integer when whole (paired t, ANOVA), one decimal when
    fractional (Welch)."""
    if not _finite(x):
        return "—"
    return f"{x:.0f}" if float(x).is_integer() else f"{x:.1f}"


def _p_cell(p) -> str:
    if not _finite(p):
        return "—"
    return "< 0.001" if p < 0.001 else f"{p:.3f}"


def _ci_clause(ci, fmt=_num) -> str:
    """" (95% CI a to b)" when the interval is finite, else "". Uses "to" (not an
    en-dash) so a negative bound doesn't read as "–-2.1"."""
    if ci and len(ci) == 2 and _finite(ci[0]) and _finite(ci[1]):
        return f" (95% CI {fmt(ci[0])} to {fmt(ci[1])})"
    return ""


def _effect_cell(effect: dict | None) -> str:
    """"<name> = <value> (95% CI a to b)" — the CI clause only when present."""
    if not effect:
        return ""
    name = EFFECT_NAMES.get(effect.get("name", ""))
    if name is None or not _finite(effect.get("value")):
        return ""
    return f"{name} = {_num(effect['value'])}" + _ci_clause(effect.get("ci"))


def _total_n(stats: dict):
    """Fallback n for a test whose `result` carries none (welch_t / mann_whitney
    report per-group sizes, not a combined n): the sum over the per-group
    summaries. Returns None when there is nothing to sum."""
    tot = sum(g.get("n", 0) for g in (stats.get("summaries") or [])
              if _finite(g.get("n")))
    return tot or None


def _row(analysis, comparison, test, n, statistic, p, effect) -> dict:
    return {"Analysis": analysis, "Comparison": comparison, "Test": test,
            "n": "" if n is None else str(n), "Statistic": statistic,
            "p": p, "Effect size": effect}


def stats_rows(analysis: dict) -> list[dict]:
    """Flatten one analysis's `stats` into zero or more table rows — one per test:
    a single test, one per pairwise comparison for an omnibus family, or one per
    lane for the location / rate families. A describe-only analysis yields none."""
    title = analysis.get("title") or "Analysis"
    stats = analysis.get("stats") or {}
    result = stats.get("result") or {}
    test = result.get("test", "")
    if test in _NO_TEST:
        return []
    name = TEST_NAMES.get(test, test)
    eff = _effect_cell(result.get("effect"))

    # Omnibus: the overall test, then one row per corrected pairwise comparison.
    if test in ("one_way_anova", "kruskal"):
        if test == "one_way_anova":
            stat = f"F({_df(result.get('df_between'))}, {_df(result.get('df_within'))}) = {_num(result.get('F'))}"
        else:
            stat = f"H({_df(result.get('df'))}) = {_num(result.get('H'))}"
        rows = [_row(title, "omnibus", name, result.get("n") or _total_n(stats),
                     stat, _p_cell(result.get("p")), eff)]
        corr = result.get("correction")
        post = (f" ({corr}-corrected)" if corr else "")
        for pw in result.get("pairwise", []):
            pw_eff = _effect_cell(pw.get("effect"))
            rows.append(_row(title, f"{pw.get('a')} vs {pw.get('b')}",
                             f"pairwise{post}", None, "",
                             _p_cell(pw.get("p_adj", pw.get("p"))), pw_eff))
        return rows

    # Location: one row per tested lane (untested lanes are prose-only).
    if stats.get("family") == "location":
        rows = []
        for g in stats.get("per_group", []):
            if g.get("p") is None:
                continue
            gname = TEST_NAMES.get(g.get("test", ""), g.get("test", ""))
            if "t" in g and _finite(g.get("t")):
                stat = f"t({_df(g.get('df'))}) = {_num(g.get('t'))}"
            elif _finite(g.get("W")):
                stat = f"W = {_num(g.get('W'), 0)}"
            else:
                stat = ""
            rows.append(_row(title, str(g.get("level")), gname, g.get("n"),
                             stat, _p_cell(g.get("p")), _effect_cell(g.get("effect"))))
        return rows

    # Rate: a global "does group matter" LR test, then a per-lane rate estimate.
    if stats.get("family") == "rate":
        rows = []
        glob = (stats.get("decision") or {}).get("global") or {}
        if glob.get("p") is not None:
            stat = f"χ²({_df(glob.get('df'))}) = {_num(glob.get('stat'))}"
            rows.append(_row(title, "does group matter", name, result.get("n"),
                             stat, _p_cell(glob.get("p")), ""))
        for g in stats.get("per_group", []):
            est = f"rate = {_sig(g.get('rate'))}" + _ci_clause(g.get("ci"), _sig)
            rows.append(_row(title, str(g.get("level")), name, g.get("n"),
                             est, "", ""))
        return rows

    # Single-test families: two-group, correlation, contingency.
    if test in ("welch_t", "paired_t"):
        stat = f"t({_df(result.get('df'))}) = {_num(result.get('t'))}"
    elif test == "mann_whitney":
        stat = f"U = {_num(result.get('U'), 0)}"
    elif test == "wilcoxon":
        stat = f"W = {_num(result.get('W'), 0)}"
    elif test in ("pearson", "spearman"):
        symbol = "r" if test == "pearson" else "ρ"
        stat = f"{symbol} = {_num(result.get('r'))}"
    elif test == "chi_square":
        stat = f"χ²({_df(result.get('dof'))}) = {_num(result.get('chi2'))}"
    elif test == "fisher_exact":
        stat = ""   # no test statistic; the odds ratio is the effect
    else:
        stat = ""
    return [_row(title, "", name, result.get("n") or _total_n(stats), stat,
                 _p_cell(result.get("p")), eff)]


# ── data-shaping preamble ─────────────────────────────────────────────────────
_FILTER_OP = {"==": "=", "!=": "≠", "<": "<", "<=": "≤", ">": ">", ">=": "≥",
              "in": "in", "not-in": "not in"}


def _cond_phrase(c: dict) -> str:
    col, op = c.get("column"), c.get("op")
    if op == "is-null":
        return f"{col} is missing"
    if op == "not-null":
        return f"{col} is present"
    val = c.get("bound") if c.get("bound") is not None else c.get("value")
    if isinstance(val, (list, tuple)):
        val = "[" + ", ".join(str(v) for v in val) + "]"
    return f"{col} {_FILTER_OP.get(op, op)} {val}"


def _step_phrase(step: dict) -> str | None:
    kind = step.get("kind")
    if kind == "drop":
        cols = ", ".join(step.get("columns", []))
        return f"dropped {cols}" if cols else None
    if kind == "filter":
        conds = [_cond_phrase(c) for c in step.get("conditions", [])]
        return "kept rows where " + " and ".join(conds) if conds else None
    if kind == "derive":
        return f"derived {step.get('column')} = {step.get('expr')}"
    if kind == "recode":
        return f"recoded {step.get('column')}"
    if kind == "join":
        on = ", ".join(step.get("on", []))
        return f"joined a second table on {on}" if on else "joined a second table"
    if kind == "pivot":
        return f"pivoted {step.get('column')} to columns"
    if kind == "grid_complete":
        by = ", ".join(step.get("by", []))
        return f"completed a count grid over {by}" if by else "completed a count grid"
    return None


def shaping_prose(spec: dict) -> str:
    """One sentence describing the reduce pipeline + nesting for an analysis, or ""
    when there is nothing to say (no reduce steps and no spine)."""
    reduce = spec.get("reduce") or {}
    steps = list(reduce.get("steps", [])) + list(reduce.get("post", []))
    phrases = [p for p in (_step_phrase(s) for s in steps) if p]
    spine = (spec.get("hierarchy") or {}).get("spine") or []

    parts = []
    if phrases:
        parts.append("Data were " + "; ".join(phrases) + ".")
    if spine:
        nest = " > ".join(spine)
        parts.append(
            f"Observations were nested by {nest}, and statistics were computed "
            "on the per-replicate summaries rather than pooled raw rows.")
    return " ".join(parts)


def software_line(manifest: dict) -> str:
    """"Statistical analyses were performed in Iris vX (commit …) using scipy N,
    …" — only the libraries actually present in the snapshot are named, never a
    fabricated version."""
    engine = manifest.get("engine") or {}
    version = engine.get("version", "unknown")
    commit = engine.get("commit", "unknown")
    dirty = " (modified)" if engine.get("dirty") else ""
    snap = manifest.get("engine_snapshot") or {}
    order = ["scipy", "pingouin", "statsmodels", "numpy", "pandas"]
    libs = [f"{lib} {snap[lib]}" for lib in order if lib in snap]
    lib_txt = (" using " + ", ".join(libs)) if libs else ""
    py = f", Python {snap['python']}" if "python" in snap else ""
    return (f"Statistical analyses were performed in Iris {version} "
            f"(commit {commit}{dirty}){lib_txt}{py}.")


def _md_table(rows: list[dict]) -> str:
    header = "| " + " | ".join(TABLE_COLUMNS) + " |"
    sep = "| " + " | ".join("---" for _ in TABLE_COLUMNS) + " |"
    if not rows:
        return (header + "\n" + sep + "\n"
                "| _No inferential tests were run._ |" + " |" * (len(TABLE_COLUMNS) - 1))
    body = "\n".join(
        "| " + " | ".join(str(r.get(c, "")) for c in TABLE_COLUMNS) + " |"
        for r in rows)
    return header + "\n" + sep + "\n" + body


def methods_markdown(analyses: list[dict], manifest: dict) -> str:
    """The full `.md`: a methods paragraph per analysis (shaping preamble + the
    engine's methods_text), the software-citation line, then the stats table."""
    out = ["# Statistical methods", ""]
    if not analyses:
        out.append("_This document contains no analyses._")
    for a in analyses:
        title = a.get("title") or "Analysis"
        stats = a.get("stats") or {}
        methods_text = stats.get("methods_text", "")
        shaping = shaping_prose(a.get("spec") or {})
        para = f"**{title}.** " + " ".join(p for p in (shaping, methods_text) if p)
        out.append(para.rstrip())
        out.append("")
    out.append(software_line(manifest))
    out.append("")
    out.append("## Statistics table")
    out.append("")
    rows = [r for a in analyses for r in stats_rows(a)]
    out.append(_md_table(rows))
    out.append("")
    return "\n".join(out)


def stats_csv(analyses: list[dict]) -> str:
    """The stats table as CSV (one header + one row per test)."""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=TABLE_COLUMNS)
    w.writeheader()
    for a in analyses:
        for r in stats_rows(a):
            w.writerow(r)
    return buf.getvalue()
