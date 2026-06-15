"""Infer an explicit statistical model from the encodings + reduced schema.

This inverts the old `plot-type -> test` table into `encodings -> model`. The
model is returned to the frontend and shown in plain language, so the user
confirms "this is the right test for this picture". Phase 1 reproduces today's
three families; Phases 2-3 extend the same object (color as a 2nd factor,
per-facet correction). When the design is ambiguous, default to describe-only.
"""
from __future__ import annotations


def _kind(schema: dict, name: str | None) -> str | None:
    if not name:
        return None
    for c in schema["columns"]:
        if c["name"] == name:
            return c["type"]
    return None


def _col(enc: dict, key: str) -> str | None:
    e = enc.get(key)
    return e["column"] if e and e.get("column") else None


def infer(encodings: dict, schema: dict, override: str | None) -> dict:
    """encodings + schema -> StatModel. `override` is the user-chosen test
    name carried from the spec when chosen_by == user_override, else None."""
    x = _col(encodings, "x")
    y = _col(encodings, "y")
    xk, yk = _kind(schema, x), _kind(schema, y)

    if xk == "categorical" and yk == "numeric":
        family = "group_comparison"
        design = f"comparison of {y} between groups of {x}"
        factors = [{"column": x, "role": "group"}]
    elif xk == "numeric" and yk == "numeric":
        family = "correlation"
        design = f"association between {x} and {y}"
        factors = [{"column": x, "role": "predictor"},
                   {"column": y, "role": "response"}]
    elif yk == "numeric" and x is None:
        family = "descriptive"
        design = f"distribution of {y}"
        factors = [{"column": y, "role": "variable"}]
    else:
        return {"design": "no statistical model — pick X / Y to analyze",
                "family": "none", "factors": [], "test": None,
                "facet_handling": None, "chosen_by": "describe_only",
                "issues": []}

    chosen_by = "user_override" if override else "inferred"
    return {"design": design, "family": family, "factors": factors,
            "test": override, "facet_handling": None,
            "chosen_by": chosen_by, "issues": []}
