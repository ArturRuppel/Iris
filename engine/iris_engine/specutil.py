"""Small pure helpers over a spec's schema + encodings.

Shared so the figure (compiler), the stats (render), and the guards can never
drift on how they read a column's type or resolve the group/value axes — the
orientation rule in particular used to live as three subtly different copies.
Dict operations only: no pandas, no engine imports, no cycles.
"""
from __future__ import annotations


def col_type(schema: dict, name: str | None, default: str | None = None) -> str | None:
    """The declared *value* type of column ``name`` (numeric/categorical/bool), or
    ``default`` when the column is absent (or ``name`` is falsy — no column is
    named None/""). Orthogonal to the identifier role, see ``is_identifier``."""
    for c in schema.get("columns", []):
        if c["name"] == name:
            return c.get("type", default)
    return default


def is_identifier(schema: dict, name: str | None) -> bool:
    """Whether column ``name`` carries the identifier (nesting-key) role — a spine
    level, independent of its value type. False when the column is absent."""
    for c in schema.get("columns", []):
        if c["name"] == name:
            return bool(c.get("identifier"))
    return False


def enc_col(enc: dict, key: str) -> str | None:
    """The column a channel maps, or None when the channel is unmapped."""
    e = enc.get(key)
    return e["column"] if e and e.get("column") else None


def resolve_cat_val(enc: dict, schema: dict) -> tuple[str | None, str | None, bool]:
    """``(cat_col, val_col, h_orient)`` — the categorical grouping column and the
    numeric value column, independent of which encoding axis each sits on.

    Horizontal orientation (``h_orient`` True) is a numeric X carrying the value
    with the categorical group on Y; every other case is vertical (X groups, Y
    measures). The stats always group by ``cat_col`` regardless of axis, so one
    definition here keeps the figure, the test, and the guards agreeing on which
    axis is the group.
    """
    x = enc_col(enc, "x")
    y = enc_col(enc, "y")
    if col_type(schema, x) == "numeric":
        return y, x, True
    return x, y, False
