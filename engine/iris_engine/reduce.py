"""Reduction layer: an ordered pipeline of steps applied top-to-bottom.

A step is one of `drop` (remove columns) or `filter` (drop rows). Each step
transforms the output of the one above, so order matters and is honored (e.g.
filter → drop → filter). Aggregation across a grain is NOT a reduce step: it
is the data hierarchy's job (pick a level — see hierarchy.materialize_levels),
so the figure and the statistics read one shared grain instead of a destructive
collapse mutating the table out from under them.

Quantity-agnostic and pandas-only (no matplotlib, no FastAPI).
"""
from __future__ import annotations

import ast

import numpy as np
import pandas as pd


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


# filter bound: an expression-valued comparison threshold computed over the
# CURRENT frame (e.g. the §5 tail-clip `quantile(abs(value), 0.99)`). A tiny
# explicit AST walk — NO eval — so an unsupported construct fails loudly. The
# realized scalar is recorded for provenance (the spec persists the EXPRESSION,
# the render logs the VALUE).
def _eval_bound(node, df: pd.DataFrame):
    if isinstance(node, ast.Expression):
        return _eval_bound(node.body, df)
    if (isinstance(node, ast.Constant) and not isinstance(node.value, bool)
            and isinstance(node.value, (int, float))):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in df.columns:
            raise ReduceError(f"filter bound: unknown column {node.id!r}")
        return df[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _DERIVE_BINOPS:
        return _DERIVE_BINOPS[type(node.op)](
            _eval_bound(node.left, df), _eval_bound(node.right, df))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_bound(node.operand, df)
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and not node.keywords):
        if node.func.id == "abs" and len(node.args) == 1:
            return np.abs(_eval_bound(node.args[0], df))
        if node.func.id == "quantile" and len(node.args) == 2:
            series = _eval_bound(node.args[0], df)
            p = _eval_bound(node.args[1], df)
            if not isinstance(p, (int, float)):
                raise ReduceError("filter bound: quantile p must be a constant")
            return float(np.percentile(np.asarray(series, dtype=float), p * 100.0))
    raise ReduceError("filter bound: unsupported expression")


def _eval_bound_scalar(expr: str, df: pd.DataFrame) -> float:
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ReduceError(f"filter bound: malformed expr {expr!r}") from e
    value = _eval_bound(tree, df)
    if hasattr(value, "__len__") or hasattr(value, "shape"):
        raise ReduceError(f"filter bound {expr!r} did not reduce to a scalar")
    return float(value)


def _apply_filter(df: pd.DataFrame, schema: dict,
                  conds: list[dict]) -> tuple[pd.DataFrame, list[float]]:
    mask = pd.Series(True, index=df.index)
    realized: list[float] = []  # per `bound` condition, in order — for provenance
    for cond in conds:
        col, op = cond["column"], cond["op"]
        ctype = _col_type(schema, col)  # validates col exists in schema (raises if not)
        if col not in df:
            raise ReduceError(f"unknown column {col!r}")
        series = df[col]
        if op in ("is-null", "not-null"):
            m = series.isna()
            mask &= m if op == "is-null" else ~m
            continue
        if op in ("in", "not-in"):
            values = cond["value"]
            if not isinstance(values, (list, tuple)):
                raise ReduceError(f"{op!r} needs a list value")
            coerced = [_coerce(v, ctype) for v in values]
            m = series.isin(coerced)
            mask &= ~m if op == "not-in" else m
        elif op in _NUMERIC_OPS:
            if "bound" in cond:
                v = _eval_bound_scalar(cond["bound"], df)
                realized.append(v)
            else:
                v = _coerce(cond["value"], ctype)
            mask &= _NUMERIC_OPS[op](series, v)
        else:
            raise ReduceError(f"unknown filter op {op!r}")
    return df[mask], realized


def _meta_cols(df: pd.DataFrame) -> list[str]:
    """Bookkeeping columns that ride along but never appear in schema.columns."""
    return [c for c in ("id",) if c in df.columns]


def _apply_drop(df: pd.DataFrame, schema: dict,
                columns: list[str]) -> tuple[pd.DataFrame, dict]:
    cols = {c["name"]: c for c in schema["columns"]}
    unknown = [c for c in columns if c not in cols]
    if unknown:
        raise ReduceError(f"drop: unknown column(s) {unknown!r}")
    drop = set(columns)
    keep_names = [c["name"] for c in schema["columns"] if c["name"] not in drop]
    keep = _meta_cols(df) + [c for c in keep_names if c in df.columns]
    out = df[keep].copy()
    new_schema = {**schema, "columns": [cols[c] for c in keep_names]}
    return out, new_schema


# derive: a deliberately small expression language — arithmetic over column
# names plus a whitelist of element-wise numpy funcs. No eval/exec; an explicit
# AST walk so an unsupported construct fails loudly rather than silently.
_DERIVE_FUNCS = {"log": np.log, "log2": np.log2, "log10": np.log10,
                 "sqrt": np.sqrt, "exp": np.exp, "abs": np.abs}
_DERIVE_BINOPS = {
    ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a ** b,
}
# string-producing casts: single-arg calls whose result is a string Series
_DERIVE_CASTS = {"str": lambda x: x.astype(str) if hasattr(x, "astype") else str(x)}
_DERIVE_CMPOPS = {
    ast.Eq: lambda a, b: a == b, ast.NotEq: lambda a, b: a != b,
    ast.Lt: lambda a, b: a < b, ast.LtE: lambda a, b: a <= b,
    ast.Gt: lambda a, b: a > b, ast.GtE: lambda a, b: a >= b,
}


def _is_numeric_operand(x) -> bool:
    """A bare number, or a Series of numeric dtype — anything else is a string."""
    if isinstance(x, pd.Series):
        return pd.api.types.is_numeric_dtype(x)
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _eval_derive(node, df: pd.DataFrame):
    if isinstance(node, ast.Expression):
        return _eval_derive(node.body, df)
    if (isinstance(node, ast.Constant) and not isinstance(node.value, bool)
            and isinstance(node.value, (int, float))):
        return node.value
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in df.columns:
            raise ReduceError(f"derive: unknown column {node.id!r}")
        return df[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _DERIVE_BINOPS:
        left = _eval_derive(node.left, df)
        right = _eval_derive(node.right, df)
        # `+` over a non-numeric (string) operand is pandas string concat; the
        # `a + b` lambda already concatenates object Series, so no branch needed
        if (isinstance(node.op, ast.Add)
                and not (_is_numeric_operand(left) and _is_numeric_operand(right))):
            return left + right
        return _DERIVE_BINOPS[type(node.op)](left, right)
    if isinstance(node, ast.Compare) and len(node.ops) == 1:
        op = type(node.ops[0])
        if op in _DERIVE_CMPOPS:
            left = _eval_derive(node.left, df)
            right = _eval_derive(node.comparators[0], df)
            return _DERIVE_CMPOPS[op](left, right).astype(int)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_derive(node.operand, df)
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in _DERIVE_CASTS
            and len(node.args) == 1 and not node.keywords):
        return _DERIVE_CASTS[node.func.id](_eval_derive(node.args[0], df))
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in _DERIVE_FUNCS
            and len(node.args) == 1 and not node.keywords):
        return _DERIVE_FUNCS[node.func.id](_eval_derive(node.args[0], df))
    raise ReduceError("derive: unsupported expression")


def _apply_derive(df: pd.DataFrame, schema: dict,
                  step: dict) -> tuple[pd.DataFrame, dict]:
    col, expr = step.get("column"), step.get("expr")
    if not col or not expr:
        raise ReduceError("derive needs a `column` and an `expr`")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ReduceError(f"derive: malformed expr {expr!r}") from e
    series = _eval_derive(tree, df)
    out = df.copy()
    out[col] = series
    names = {c["name"] for c in schema["columns"]}
    if col in names:                       # overwrite: type stays whatever it was
        return out, schema
    new_cols = [*schema["columns"], {"name": col, "type": "numeric", "label": col}]
    return out, {**schema, "columns": new_cols}


def _apply_recode(df: pd.DataFrame, schema: dict,
                  step: dict) -> tuple[pd.DataFrame, dict]:
    col = step.get("column")
    mapping = step.get("map") or {}
    if not col:
        raise ReduceError("recode needs a `column`")
    if col not in df:
        raise ReduceError(f"recode: unknown column {col!r}")
    out = df.copy()
    # relabel mapped values; unmapped values (incl. NaN) pass through unchanged
    out[col] = out[col].map(lambda v: mapping.get(v, v))
    new_cols = []
    for c in schema["columns"]:
        if c["name"] == col and c.get("type") == "categorical":
            relabeled = [mapping.get(v, v) for v in (c.get("levels") or [])]
            new_cols.append({**c, "levels": list(dict.fromkeys(relabeled))})
        else:
            new_cols.append(c)
    return out, {**schema, "columns": new_cols}


def _apply_join(df: pd.DataFrame, schema: dict,
                step: dict) -> tuple[pd.DataFrame, dict]:
    on = step.get("on") or []
    how = step.get("how", "inner")
    right = step.get("right") or {}
    if how != "inner":
        raise ReduceError(f"join: only inner is supported, got {how!r}")
    if not on:
        raise ReduceError("join needs `on` keys")
    right_schema = right.get("schema") or {}
    right_rows = right.get("rows") or []
    if not right_rows:
        raise ReduceError("join: right table has no rows")
    right_df = pd.DataFrame(right_rows)
    # The right side may carry its OWN reduce + collapse sub-pipeline: it is reduced
    # and aggregated to its target grain INDEPENDENTLY (over its own row support)
    # before the merge. That is how two features living at different grains — each a
    # per-cell median over its OWN frames — join at a shared coarser grain without
    # first being forced onto a common (intersected) raw support. Absent both, the
    # right side is the plain static table it has always been.
    right_steps = (right.get("reduce") or {}).get("steps") or []
    right_plan = right.get("collapse")
    if right_steps or right_plan:
        if "id" not in right_df.columns:       # the collapse keys provenance on `id`
            right_df = right_df.assign(id=[str(i + 1) for i in range(len(right_df))])
        if right_steps:
            right_df, right_schema = apply_reduction(right_df, right_schema, right_steps)
        if right_plan:
            from . import hierarchy             # local import: no module-load cycle
            grains = hierarchy.materialize_plan(right_df, right_schema, right_plan, [])
            tg = right.get("test_grain")
            right_df, right_schema = (grains[tg] if tg in grains
                                      else hierarchy.resolve_level(grains, tg))
    # bookkeeping columns must not collide / multiply the merge
    right_df = right_df.drop(columns=["id", "row_ids"], errors="ignore")
    missing = [k for k in on if k not in df.columns or k not in right_df.columns]
    if missing:
        raise ReduceError(f"join: key(s) {missing!r} absent from a side")
    # defer many-to-many (spec): a non-unique right key would multiply left rows
    if right_df.duplicated(subset=on).any():
        raise ReduceError("join: right table is not unique on the join key(s); "
                          "many-to-many is not yet supported")
    left_names = {c["name"] for c in schema["columns"]} | set(_meta_cols(df)) | set(on)
    # append only the right's NEW columns that the schema declares AND the rows carry
    add = [c for c in right_schema.get("columns", [])
           if c["name"] not in left_names and c["name"] in right_df.columns]
    keep = list(dict.fromkeys(on + [c["name"] for c in add]))
    right_df = right_df[[c for c in keep if c in right_df.columns]]
    try:
        out = df.merge(right_df, on=on, how="inner")
    except ValueError as e:                 # e.g. dtype mismatch on a key
        raise ReduceError(f"join: merge failed — {e}") from e
    return out.reset_index(drop=True), {**schema, "columns": [*schema["columns"], *add]}


def _apply_pivot(df: pd.DataFrame, schema: dict,
                 step: dict) -> tuple[pd.DataFrame, dict]:
    """Unstack one categorical `column` (long → wide): one column per level,
    each cell an aggregate (sum) of `values` over the `index` keys, absent
    combinations 0-filled. `names` maps each level to its new column name."""
    index = step.get("index") or []
    column = step.get("column")
    values = step.get("values")
    agg = step.get("agg", "sum")
    fill = step.get("fill", 0)
    names = step.get("names") or {}
    if not index:
        raise ReduceError("pivot needs `index` key(s)")
    if not column:
        raise ReduceError("pivot needs a `column`")
    if not values:
        raise ReduceError("pivot needs `values`")
    known = {c["name"] for c in schema["columns"]}
    unknown = [c for c in (*index, column, values) if c not in known]
    if unknown:
        raise ReduceError(f"pivot: unknown column(s) {unknown!r}")
    missing = [c for c in (*index, column, values) if c not in df.columns]
    if missing:
        raise ReduceError(f"pivot: column(s) {missing!r} absent from the frame")
    wide = df.pivot_table(index=index, columns=column, values=values,
                          aggfunc=agg, fill_value=fill)
    # flatten the level axis to the per-level names; drop any unmapped level
    keep = [lvl for lvl in wide.columns if lvl in names]
    wide = wide[keep]
    wide.columns = [names[lvl] for lvl in keep]
    out = wide.reset_index()
    consumed = {column, values}
    new_cols = [c for c in schema["columns"] if c["name"] not in consumed]
    new_cols += [{"name": names[lvl], "type": "numeric", "label": names[lvl]}
                 for lvl in keep]
    return out, {**schema, "columns": new_cols}


def _apply_grid_complete(df: pd.DataFrame, schema: dict,
                         step: dict) -> tuple[pd.DataFrame, dict]:
    by = step.get("by") or []
    column = step.get("column")
    levels = step.get("levels") or []
    count_unique = step.get("count_unique")
    fill = step.get("fill", 0)
    count_name = step.get("count_name", "count")
    if not by:
        raise ReduceError("grid_complete needs `by` id column(s)")
    if not column:
        raise ReduceError("grid_complete needs a `column`")
    if not levels:
        raise ReduceError("grid_complete needs a non-empty `levels` list")
    known = {c["name"] for c in schema["columns"]}
    unknown = [c for c in by if c not in known or c not in df.columns]
    if unknown:
        raise ReduceError(f"grid_complete: unknown `by` column(s) {unknown!r}")
    # the full grid: every observed `by` tuple crossed with every fixed level
    base = df[by].drop_duplicates()
    full = base.merge(pd.DataFrame({column: levels}), how="cross")
    # count events per (by + [column]); optionally dedup an id first
    counted = df.drop_duplicates(count_unique) if count_unique else df
    obs = counted.groupby(by + [column]).size()
    keyed = full.set_index(by + [column]).index.map(obs)
    full[count_name] = pd.Series(keyed, index=full.index).fillna(fill).astype(int)
    by_cols = [c for c in schema["columns"] if c["name"] in by]
    new_cols = [
        *by_cols,
        {"name": column, "type": "categorical", "label": column, "levels": list(levels)},
        {"name": count_name, "type": "numeric", "label": count_name},
    ]
    return full.reset_index(drop=True), {**schema, "columns": new_cols}


def _apply_step(df: pd.DataFrame, schema: dict,
                step: dict) -> tuple[pd.DataFrame, dict, dict]:
    """Apply one step. Returns (frame, schema, info) where `info` carries
    optional per-step provenance (e.g. `realized_bounds` for an expression
    filter) to be merged into the trace record."""
    kind = step.get("kind")
    if kind == "drop":
        out, sch = _apply_drop(df, schema, step.get("columns") or [])
        return out, sch, {}
    if kind == "filter":
        out, realized = _apply_filter(df, schema, step.get("conditions") or [])
        info = {"realized_bounds": realized} if realized else {}
        return out.reset_index(drop=True), schema, info
    if kind == "derive":
        out, sch = _apply_derive(df, schema, step)
        return out, sch, {}
    if kind == "recode":
        out, sch = _apply_recode(df, schema, step)
        return out, sch, {}
    if kind == "join":
        out, sch = _apply_join(df, schema, step)
        return out, sch, {}
    if kind == "pivot":
        out, sch = _apply_pivot(df, schema, step)
        return out, sch, {}
    if kind == "grid_complete":
        out, sch = _apply_grid_complete(df, schema, step)
        return out, sch, {}
    raise ReduceError(f"unknown step kind {kind!r}")


def apply_reduction(df: pd.DataFrame, schema: dict,
                    steps: list[dict] | None) -> tuple[pd.DataFrame, dict]:
    """Fold `steps` over (df, schema) in order. Returns (frame, schema)."""
    out, schema, _ = reduce_with_trace(df, schema, steps)
    return out, schema


def reduce_with_trace(
    df: pd.DataFrame, schema: dict, steps: list[dict] | None,
) -> tuple[pd.DataFrame, dict, list[dict]]:
    """Like `apply_reduction`, but also returns a per-step trace
    `[{n_rows_out, schema_out}]` (in order) for the live preview UI."""
    out, sch, trace = df, schema, []
    for step in (steps or []):
        out, sch, info = _apply_step(out, sch, step)
        out = out.reset_index(drop=True)
        # Row-rebuilding steps (pivot, grid_complete) produce a fresh frame that no
        # longer carries the `id` meta column the hierarchy materialization keys on.
        # Re-stamp a unique `id` so the reduced table stays a valid pipeline input;
        # id-preserving steps (filter/drop/derive/recode/join) keep theirs untouched.
        if "id" not in out.columns:
            out = out.assign(id=[str(i + 1) for i in range(len(out))])
        trace.append({"n_rows_out": int(len(out)), "schema_out": sch, **info})
    out = out.reset_index(drop=True)
    return out, sch, trace


def project_schema(schema: dict, steps: list[dict] | None) -> dict:
    """Schema-only projection of `steps` — the columns they would produce, WITHOUT
    touching data. Lets a caller know a post-phase derive's output column at family-
    inference time, before the post phase actually runs against a collapsed table.

    Mirrors each `_apply_*` step's schema effect using only `(schema, step)`. Where
    a step's output type is data-dependent, the same conservative declared type the
    data path uses is taken (derive → numeric, as in `_apply_derive`). Filters do
    not change the schema."""
    cols = [dict(c) for c in schema["columns"]]
    names = {c["name"] for c in cols}
    for step in (steps or []):
        kind = step.get("kind")
        if kind == "filter":
            continue
        if kind == "drop":
            drop = set(step.get("columns") or [])
            cols = [c for c in cols if c["name"] not in drop]
        elif kind == "derive":
            col = step.get("column")
            if col and col not in names:
                cols.append({"name": col, "type": "numeric", "label": col})
        elif kind == "recode":
            pass  # relabels levels in place; column type is unchanged
        elif kind == "join":
            on = set(step.get("on") or [])
            rblock = step.get("right") or {}
            rschema = rblock.get("schema") or {}
            # a right side with its own reduce sub-pipeline contributes the columns
            # that pipeline PRODUCES (e.g. a derived `speed`, a pivoted `het`), not
            # its raw columns — project them so the joined column is declared.
            rsteps = (rblock.get("reduce") or {}).get("steps") or []
            if rsteps:
                rschema = project_schema(rschema, rsteps)
            cur = {c["name"] for c in cols}
            cols += [dict(rc) for rc in rschema.get("columns", [])
                     if rc["name"] not in cur and rc["name"] not in on]
        elif kind == "pivot":
            consumed = {step.get("column"), step.get("values")}
            cols = [c for c in cols if c["name"] not in consumed]
            cols += [{"name": v, "type": "numeric", "label": v}
                     for v in (step.get("names") or {}).values()]
        elif kind == "grid_complete":
            by = set(step.get("by") or [])
            column, count_name = step.get("column"), step.get("count_name", "count")
            cols = [c for c in cols if c["name"] in by] + [
                {"name": column, "type": "categorical", "label": column,
                 "levels": list(step.get("levels") or [])},
                {"name": count_name, "type": "numeric", "label": count_name}]
        names = {c["name"] for c in cols}
    return {**schema, "columns": cols}
