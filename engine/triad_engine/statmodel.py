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
    color = _col(encodings, "color")
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

    # Phase 2: a categorical color distinct from x *could* be a second factor.
    # We surface it (and show it as dodged groups) but do NOT run a two-way test
    # — that is Tier-3 work. The one-factor family/test above is unchanged.
    issues = []
    if (family == "group_comparison" and color and color != x
            and _kind(schema, color) == "categorical"):
        design += (f"; color ({color}) could be a second factor — it is drawn "
                   f"as separate groups, but only {x} is tested")
        issues.append({
            "level": "warning", "code": "color_second_factor", "geom": None,
            "message": (f"You mapped color = {color}. It may be a second factor "
                        f"in a two-way design; for now it is shown as separate "
                        f"groups and only {x} is tested. A two-way test is "
                        f"planned; use the test override to change the design.")})

    chosen_by = "user_override" if override else "inferred"
    return {"design": design, "family": family, "factors": factors,
            "test": override, "facet_handling": None,
            "chosen_by": chosen_by, "issues": issues}
