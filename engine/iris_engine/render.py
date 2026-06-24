"""FastAPI-free render core: a `.iris` spec → matplotlib figure.

This is the whole style-independent pipeline — load the frame, reduce, infer the
stat model, run the guards and inferential stats, materialize the data hierarchy,
and build the figure — with no web framework in sight. ``iris_engine.main._run``
is a thin HTTP adapter over ``render`` that adds request caching and translates
``RenderError`` into an ``HTTPException``; everything substantive lives here so
that the bare ``pip install iris-engine`` (no ``[server]`` extra) can render.

Errors surface as :class:`RenderError` (a plain ``ValueError``); the HTTP layer
maps it to 422.
"""
from __future__ import annotations

import pandas as pd

from . import (compiler, guards, hierarchy, reduce as reduce_mod, specnorm,
               stats, statmodel)


class RenderError(ValueError):
    """A spec could not be rendered (bad reduction, blocking guard, no model,
    failed stats). The HTTP layer maps this to 422."""


def frame_from_table(table: dict) -> pd.DataFrame:
    """Build a DataFrame from a resolved table. A session resolves to a ready
    `frame` (a caller-owned snapshot) and is returned as-is; otherwise it's one
    of the wire formats: columnar (`{columns: {name: [...]}}`, the compact form
    sent by /import/commit) or the row form (`{rows: [{...}]}`, used by
    edits/saves/sample)."""
    if "frame" in table:
        return table["frame"]
    if "columns" in table:
        return pd.DataFrame(table["columns"])
    return pd.DataFrame(table.get("rows", []))


def _load_frame(table: dict) -> tuple[pd.DataFrame, dict]:
    schema = table["schema"]
    df = frame_from_table(table).copy()
    # A `bool` column (a stochastic-event flag) collapses to numeric 1/0 for every
    # compute path — so a summary/bar of it reads as the fraction of trues — and
    # is presented as numeric to the rest of the engine. Normalize a copy of the
    # schema so the compiler/stats/guards never need a bool branch (and the cached
    # source table's schema isn't mutated).
    norm_cols = []
    for col in schema["columns"]:
        if col["type"] in ("numeric", "bool") and col["name"] in df:
            df[col["name"]] = pd.to_numeric(df[col["name"]], errors="coerce")
        if col["type"] == "bool":
            col = {**col, "type": "numeric"}
        norm_cols.append(col)
    return df, {**schema, "columns": norm_cols}


def _prepare(table: dict, spec: dict) -> tuple[pd.DataFrame, dict]:
    return _load_frame(table)


def render(table: dict, spec: dict, *, memo=None):
    """Render `spec` over `table`, returning
    ``(fig, res, df, schema, model, issues, level_tables)``.

    `table` is a resolved table dict (`{schema, rows|columns|frame}`). `memo`, if
    given, is a ``(compute) -> result`` wrapper the HTTP layer passes to fold the
    inferential-stats computation into its per-request cache; by default the
    stats are computed directly. Raises :class:`RenderError` on any failure the
    HTTP layer should report as 422.
    """
    memo = memo if memo is not None else (lambda compute: compute())
    spec = specnorm.normalize(spec)
    df, schema = _prepare(table, spec)
    steps = (spec.get("reduce") or {}).get("steps") or []
    try:
        df, schema = reduce_mod.apply_reduction(df, schema, steps)
    except reduce_mod.ReduceError as e:
        raise RenderError(f"reduction failed: {e}") from e

    describe_only = bool(spec.get("_describe_only"))
    stats_block = spec.get("stats") or {}
    model = statmodel.infer(
        spec["encodings"], schema, spec.get("_override"),
        spec.get("facet"), layers=spec.get("layers"),
        declared_family=stats_block.get("family"),
        reference=stats_block.get("reference", 0.0),
        exposure=stats_block.get("exposure"),
        model=stats_block.get("model"))
    # Data hierarchy (redesign): per-level tables for the group-comparison path,
    # filled in below once the grouping column is known. None elsewhere.
    level_tables = None
    if describe_only and model["family"] != "none":
        # the user asked to render the figure but run no inferential test
        model["chosen_by"] = "describe_only"
        model["test"] = None
    # Phase 4: statmodel.infer already forces chosen_by == "describe_only" when
    # faceted; fold that back into the local flag so the stats dispatch below
    # (which branches on `describe_only`, not on the model) skips the real test.
    describe_only = describe_only or model["chosen_by"] == "describe_only"
    spec["stat_model"] = model

    issues = guards.evaluate(df, schema, spec, model)
    blocking = next((i for i in issues if i["level"] == "blocking"), None)
    if blocking:
        raise RenderError(blocking["message"])

    enc = spec["encodings"]
    alpha = spec.get("stats", {}).get("alpha", 0.05)
    override = spec.get("_override")
    family = model["family"]
    # The location (one-sample) family reuses the WHOLE group_comparison data path
    # — same level materialization, inferential-grain resolution, and pairing — and
    # differs only in the terminal stats call, so it shares this branch.
    if family in ("group_comparison", "location", "rate"):
        enc_x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
        enc_y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
        # Phase 3c: detect horizontal orientation (numeric x + categorical y).
        # The stats function always receives (grouping_col, value_col); for
        # horizontal the roles are swapped relative to the encoding axes.
        x_is_numeric = any(c["name"] == enc_x and c["type"] == "numeric"
                           for c in schema["columns"]) if enc_x else False
        if x_is_numeric:
            cat_col, val_col = enc_y, enc_x   # horizontal: y groups, x measures
        else:
            cat_col, val_col = enc_x, enc_y   # vertical: x groups, y measures
        cat_schema = next((c for c in schema["columns"] if c["name"] == cat_col), None)
        if cat_schema is None:
            raise RenderError(f"grouping column {cat_col!r} not found in schema")
        # Materialize one table per hierarchy level. The grain always retains the
        # columns this figure splits by (x grouping, colour, facets) so a coarse
        # level can still be compared/coloured rather than averaging them away.
        hier = spec.get("hierarchy") or {}
        spine = hierarchy.spine_present(df, hier.get("spine") or [])
        color = enc.get("color")
        color_col = color["column"] if color and color.get("column") else None
        facet = spec.get("facet") or {}
        frow = facet.get("row") or {}
        fcol = facet.get("col") or {}
        # dedupe (order-preserving): a column may drive several encodings at once
        # — e.g. a superplot groups by class on x *and* colours by the same class.
        split_cols = list(dict.fromkeys(
            c for c in (cat_col, color_col, frow.get("column"), fcol.get("column"))
            if c and c in df.columns))
        # The rate family sums counts + exposures to the inferential unit (the GLM
        # wants per-unit totals, not per-row means), so force a sum aggregation at
        # every spine level; every other family keeps the spec's per-level fn.
        agg_fn = ({lv: "sum" for lv in spine} if family == "rate"
                  else hier.get("fn"))
        level_tables, present_spine = hierarchy.materialize_levels(
            df, schema, spine, agg_fn, split_cols)
        model["spine"] = present_spine
        # One source of truth: the test reads the SAME materialized grain the
        # figure draws — never a parallel raw-vs-level route. The inferential grain
        # is the coarsest level any layer is bound to (the prominent "unit" marks;
        # a summary at `date` reports spread across dates — the honest n). With no
        # spine, or layers left at the raw level, this resolves to the raw reduced
        # rows, so the spineless path is unchanged.
        layer_levels = [layer.get("level", hierarchy.RAW)
                        for layer in spec.get("layers", [])]
        # An explicit per-analysis collapse plan + chosen test grain (the
        # un-forced-nesting path) override the derived grain: the test runs at
        # the grain the user picked, materialized by the plan. Absent both, this
        # is byte-for-byte the historical coarsest-level / level_tables route.
        plan = spec.get("collapse")
        grains = (hierarchy.materialize_plan(df, schema, plan, split_cols)
                  if plan else None)
        test_grain = spec.get("test_grain")
        if test_grain is not None:
            inf_level = test_grain.split("/")[-1] if test_grain else hierarchy.RAW
        else:
            inf_level = hierarchy.coarsest_level(present_spine, layer_levels)
        model["inferential_level"] = inf_level
        # Pairing follows from the spine AND the grain the test runs at: a
        # classifier nested in each replicate is unpaired among raw cells but
        # paired by replicate once summarized to the inferential block.
        model["pairing"] = hierarchy.pairing(
            df, present_spine, cat_col, inferential_level=inf_level)
        if grains is not None and test_grain in grains:
            stat_df, _ = grains[test_grain]
        else:
            stat_df, _ = hierarchy.resolve_level(level_tables, inf_level)
        levels = cat_schema.get("levels", [])
        if describe_only:
            # faceted / describe-only: no inferential test, for either family.
            res = memo(lambda: stats.describe_groups(
                stat_df, cat_col, val_col, levels=levels, alpha=alpha))
        elif family == "location":
            res = memo(lambda: stats.location(
                stat_df, cat_col, val_col, levels=levels,
                reference=model.get("reference", 0.0), alpha=alpha,
                override=override, pairing=model["pairing"]))
        elif family == "rate":
            res = memo(lambda: stats.rate(
                stat_df, cat_col, val_col, levels=levels,
                exposure=model.get("exposure"), model=model.get("model", "nb"),
                alpha=alpha, override=override, pairing=model["pairing"]))
        else:
            res = memo(lambda: stats.group_comparison(
                stat_df, cat_col, val_col, levels=levels, alpha=alpha,
                override=override, pairing=model["pairing"]))
    elif family == "correlation":
        # The spine makes the replicate (its coarsest present level) the unit of
        # inference, exactly as for group_comparison/location/rate: a per-unit
        # coefficient, tested across units. Plumbed as unit_cols; no spine keeps
        # the historical pooled test. The figure still draws every raw point.
        corr_spine = hierarchy.spine_present(df, (spec.get("hierarchy") or {}).get("spine") or [])
        model["spine"] = corr_spine
        unit_cols = corr_spine or None
        # A categorical colour stratifies the correlation: one coefficient (and
        # OLS line) per group, the general "does the relationship differ by
        # group?" question. Numeric colour is a colorbar, not a grouping.
        corr_color = enc.get("color")
        corr_color_col = corr_color["column"] if corr_color and corr_color.get("column") else None
        corr_group = (corr_color_col if corr_color_col
                      and any(c["name"] == corr_color_col and c["type"] != "numeric"
                              for c in schema["columns"]) else None)
        res = memo(lambda: (
               stats.describe_pairs(df, enc["x"]["column"], enc["y"]["column"],
                                    alpha=alpha)
               if describe_only else
               stats.correlation(df, enc["x"]["column"], enc["y"]["column"],
                                 alpha=alpha, override=override,
                                 unit_cols=unit_cols, group_col=corr_group)))
    elif family == "timeseries":
        # Describe-only in the first cut (no inferential test on time courses).
        # The figure (build_timeseries_figure) computes its own per-timepoint
        # means/bands and per-unit curves internally from the raw rows, so the
        # stats result is a legible describe-only summary, not a test.
        res = memo(lambda: stats.timeseries(
                   df, enc["x"]["column"], enc["y"]["column"], alpha=alpha))
    elif family == "descriptive":
        res = memo(lambda: stats.descriptive(
                   df, enc["y"]["column"], alpha=alpha))
    elif family == "contingency":
        # Phase 3d: tile/heatmap — count rows per (x_level, y_level) cell.
        enc_x = enc["x"]["column"] if enc.get("x") and enc["x"].get("column") else None
        enc_y = enc["y"]["column"] if enc.get("y") and enc["y"].get("column") else None
        x_sch = next((c for c in schema["columns"] if c["name"] == enc_x), None)
        y_sch = next((c for c in schema["columns"] if c["name"] == enc_y), None)
        x_levels = ((x_sch.get("levels") or []) if x_sch else []) or sorted(
            str(v) for v in df[enc_x].dropna().unique())
        y_levels = ((y_sch.get("levels") or []) if y_sch else []) or sorted(
            str(v) for v in df[enc_y].dropna().unique())
        res = memo(lambda: (
               stats.contingency_counts(df, enc_x, enc_y, x_levels, y_levels,
                                        alpha=alpha)
               if describe_only else
               stats.contingency_test(df, enc_x, enc_y, x_levels, y_levels,
                                      alpha=alpha, override=override)))
    else:
        raise RenderError("no statistical model — map X / Y to analyze")
    if "error" in res:
        raise RenderError(res["error"])
    fig = compiler.build_figure(df, schema, spec, res, level_tables)
    return fig, res, df, schema, model, issues, level_tables
