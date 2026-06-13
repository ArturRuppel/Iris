"""Reduction layer: filter rows, then optionally collapse to group summaries.

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


def apply_reduction(df: pd.DataFrame, schema: dict,
                    reduce: dict | None) -> tuple[pd.DataFrame, dict]:
    """Filter rows, then optionally collapse. Returns (frame, schema)."""
    if not reduce:
        return df, schema
    out = _apply_filter(df, schema, reduce.get("filter") or [])
    collapse = reduce.get("collapse")
    if not collapse:
        return out.reset_index(drop=True), schema
    return _apply_collapse(out, schema, collapse)


_AGG = {
    "mean": "mean",
    "median": "median",
    "sum": "sum",
    "count": "size",
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
    keys = list(grouped.groups.keys())

    out = pd.DataFrame()
    for i, gcol in enumerate(group_by):
        out[gcol] = [k if len(group_by) == 1 else k[i] for k in keys]
    for col, vals in data.items():
        out[col] = vals
    if wants_count:
        out["n"] = grouped.size().to_numpy()
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
