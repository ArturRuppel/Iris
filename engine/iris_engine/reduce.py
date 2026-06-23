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


def _apply_filter(df: pd.DataFrame, schema: dict, conds: list[dict]) -> pd.DataFrame:
    mask = pd.Series(True, index=df.index)
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
            v = _coerce(cond["value"], ctype)
            mask &= _NUMERIC_OPS[op](series, v)
        else:
            raise ReduceError(f"unknown filter op {op!r}")
    return df[mask]


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


def _eval_derive(node, df: pd.DataFrame):
    if isinstance(node, ast.Expression):
        return _eval_derive(node.body, df)
    if (isinstance(node, ast.Constant) and not isinstance(node.value, bool)
            and isinstance(node.value, (int, float))):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in df.columns:
            raise ReduceError(f"derive: unknown column {node.id!r}")
        return df[node.id]
    if isinstance(node, ast.BinOp) and type(node.op) in _DERIVE_BINOPS:
        return _DERIVE_BINOPS[type(node.op)](
            _eval_derive(node.left, df), _eval_derive(node.right, df))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_derive(node.operand, df)
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


def _apply_step(df: pd.DataFrame, schema: dict,
                step: dict) -> tuple[pd.DataFrame, dict]:
    kind = step.get("kind")
    if kind == "drop":
        return _apply_drop(df, schema, step.get("columns") or [])
    if kind == "filter":
        out = _apply_filter(df, schema, step.get("conditions") or [])
        return out.reset_index(drop=True), schema
    if kind == "derive":
        return _apply_derive(df, schema, step)
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
        out, sch = _apply_step(out, sch, step)
        out = out.reset_index(drop=True)
        trace.append({"n_rows_out": int(len(out)), "schema_out": sch})
    out = out.reset_index(drop=True)
    return out, sch, trace
