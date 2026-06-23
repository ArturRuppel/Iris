"""Reduction layer: an ordered pipeline of steps applied top-to-bottom.

A step is one of `select` (project columns), `filter` (drop rows), or `collapse`
(group + aggregate). Each step transforms the output of the one above, so order
matters and is honored (e.g. filter → collapse → filter).

Quantity-agnostic and pandas-only (no matplotlib, no FastAPI). The caller
removes excluded rows first; reduction never sees them.
"""
from __future__ import annotations

import pandas as pd
from scipy.stats import sem as _scipy_sem


class ReduceError(ValueError):
    """A reduction could not be applied (bad column, bad op, etc.)."""


_NUMERIC_OPS = {
    "==": lambda s, v: s == v,
    "!=": lambda s, v: s != v,
    "<": lambda s, v: s < v,
    "<=": lambda s, v: s <= v,
    ">": lambda s, v: s > v,
    ">=": lambda s, v: s >= v,
}


def _col_type(schema: dict, name: str) -> str:
    for c in schema["columns"]:
        if c["name"] == name:
            return c["type"]
    raise ReduceError(f"unknown column {name!r}")


def _coerce(value, col_type: str):
    if col_type == "numeric":
        try:
            return float(value)
        except (TypeError, ValueError) as e:
            raise ReduceError(f"{value!r} is not numeric") from e
    return value


def _apply_filter(df: pd.DataFrame, schema: dict, conds: list[dict]) -> pd.DataFrame:
    mask = pd.Series(True, index=df.index)
    for cond in conds:
        col, op = cond["column"], cond["op"]
        ctype = _col_type(schema, col)
        if col not in df:
            raise ReduceError(f"unknown column {col!r}")
        series = df[col]
        if op in ("in", "not-in"):
            values = cond["value"]
            if not isinstance(values, (list, tuple)):
                raise ReduceError(f"{op!r} needs a list value")
            coerced = [_coerce(v, ctype) for v in values]
            m = series.isin(coerced)
            mask &= ~m if op == "not-in" else m
        elif op in _NUMERIC_OPS:
            v = _coerce(cond["value"], ctype)
            mask &= _NUMERIC_OPS[op](series, v)
        else:
            raise ReduceError(f"unknown filter op {op!r}")
    return df[mask]


def _meta_cols(df: pd.DataFrame) -> list[str]:
    """Bookkeeping columns that ride along but never appear in schema.columns."""
    return [c for c in ("id", "excluded") if c in df.columns]


def _apply_select(df: pd.DataFrame, schema: dict,
                  columns: list[str]) -> tuple[pd.DataFrame, dict]:
    cols = {c["name"]: c for c in schema["columns"]}
    missing = [c for c in columns if c not in cols]
    if missing:
        raise ReduceError(f"select: unknown column(s) {missing!r}")
    keep = _meta_cols(df) + [c for c in columns if c in df.columns]
    out = df[keep].copy()
    new_schema = {**schema, "columns": [cols[c] for c in columns]}
    return out, new_schema


def _apply_step(df: pd.DataFrame, schema: dict,
                step: dict) -> tuple[pd.DataFrame, dict]:
    kind = step.get("kind")
    if kind == "select":
        return _apply_select(df, schema, step.get("columns") or [])
    if kind == "filter":
        out = _apply_filter(df, schema, step.get("conditions") or [])
        return out.reset_index(drop=True), schema
    if kind == "collapse":
        return _apply_collapse(df, schema, step)
    raise ReduceError(f"unknown step kind {kind!r}")


def apply_reduction(df: pd.DataFrame, schema: dict,
                    steps: list[dict] | None) -> tuple[pd.DataFrame, dict]:
    """Fold `steps` over (df, schema) in order. Returns (frame, schema).

    Carries the caller's `n_excluded` provenance through the reduction (pandas
    drops `.attrs` when it builds a new frame), so the methods text still
    reports how many raw observations were excluded before reducing."""
    out, schema, _ = reduce_with_trace(df, schema, steps)
    return out, schema


def reduce_with_trace(
    df: pd.DataFrame, schema: dict, steps: list[dict] | None,
) -> tuple[pd.DataFrame, dict, list[dict]]:
    """Like `apply_reduction`, but also returns a per-step trace
    `[{n_rows_out, schema_out}]` (in order) for the live preview UI."""
    n_excluded = df.attrs.get("n_excluded", 0)
    out, sch, trace = df, schema, []
    for step in (steps or []):
        out, sch = _apply_step(out, sch, step)
        out = out.reset_index(drop=True)
        trace.append({"n_rows_out": int(len(out)), "schema_out": sch})
    out = out.reset_index(drop=True)
    out.attrs["n_excluded"] = n_excluded
    return out, sch, trace


# "count" is intentionally absent: it is handled separately below (the shared
# group-size `n` column), so it never reaches a per-column `.agg(_AGG[fn])`.
_AGG = {
    "mean": "mean",
    "median": "median",
    "sum": "sum",
    "sem": lambda s: _scipy_sem(s.to_numpy(dtype=float), nan_policy="omit"),
}


def _apply_collapse(df: pd.DataFrame, schema: dict,
                    collapse: dict) -> tuple[pd.DataFrame, dict]:
    group_by = collapse["group_by"]
    if not group_by:
        raise ReduceError("collapse requires at least one group_by column")
    for col in group_by:
        if col not in df:
            raise ReduceError(f"unknown group_by column {col!r}")

    cols = {c["name"]: c for c in schema["columns"]}
    numerics = [c["name"] for c in schema["columns"]
                if c["type"] == "numeric" and c["name"] in df
                and c["name"] not in group_by]
    agg = dict(collapse.get("aggregate") or {})
    wants_count = any(fn == "count" for fn in agg.values())

    grouped = df.groupby(group_by, observed=True, sort=False)
    data: dict[str, list] = {}
    for col in numerics:
        fn = agg.get(col, "mean")
        if fn == "count":
            continue  # represented by the shared n column below
        data[col] = grouped[col].agg(_AGG[fn]).to_numpy()

    # Build group key frame from a grouped size series (avoids .groups.keys()
    # which changes shape in pandas 4 when group_by is a list).
    size_series = grouped.size()
    key_frame = size_series.reset_index(drop=False)

    out = pd.DataFrame()
    for gcol in group_by:
        out[gcol] = key_frame[gcol].to_numpy()
    for col, vals in data.items():
        out[col] = vals
    if wants_count:
        out["n"] = size_series.to_numpy()
    out.insert(0, "id", [f"g{i+1}" for i in range(len(out))])
    out["excluded"] = False

    new_cols = []
    for gcol in group_by:
        new_cols.append(cols[gcol])
    for col in data:
        new_cols.append(cols[col])
    if wants_count:
        new_cols.append({"name": "n", "type": "numeric", "label": "n"})
    new_schema = {**schema, "columns": new_cols}
    return out.reset_index(drop=True), new_schema
