"""Infer an explicit statistical model from the encodings + reduced schema.

This inverts the old `plot-type -> test` table into `encodings -> model`. The
model is returned to the frontend and shown in plain language, so the user
confirms "this is the right test for this picture". Phase 1 reproduces today's
three families; Phases 2-3 extend the same object (color as a 2nd factor,
per-facet correction). When the design is ambiguous, default to describe-only.
"""
from __future__ import annotations

from . import geoms as geoms_mod


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


def _is_timeseries(layers: list[dict] | None) -> bool:
    """True iff any layer's geom declares the `timeseries` family in the
    registry. The geom's declared family is authoritative when the column types
    are ambiguous (numeric x + numeric y is otherwise `correlation`): a `line`
    or `trend` layer means the user is drawing a time course, not a scatter."""
    for layer in (layers or []):
        g = geoms_mod.GEOMS.get(layer.get("geom"))
        if g is not None and g.family == "timeseries":
            return True
    return False


def infer(encodings: dict, schema: dict, override: str | None,
          facet: dict | None = None, unit: list[str] | None = None,
          layers: list[dict] | None = None,
          declared_family: str | None = None, reference: float = 0.0) -> dict:
    """encodings + schema -> StatModel. `override` is the user's pinned test
    name carried from the spec's `stats.override`, else None.
    `facet` is the spec's facet block; Phase 4 v1 runs no inferential test
    once either axis is faceted — multiple-comparisons correction is
    deferred, so describe-only is the only safe default.

    `unit` is the declared independent-repetition key (Phase 5 / item 10):
    the test counts these units, not raw rows, and a per-unit overlay layer can
    draw them. It is echoed on the model (`unit`) and named in the design
    sentence so the inference basis is explicit.

    `layers` are the spec's geom layers; a `line`/`trend` layer (registry family
    `timeseries`) breaks the numeric/numeric tie toward a time-series design
    rather than `correlation` — the geom's declared family is authoritative when
    column types alone are ambiguous."""
    unit = unit or []
    x = _col(encodings, "x")
    y = _col(encodings, "y")
    color = _col(encodings, "color")
    xk, yk = _kind(schema, x), _kind(schema, y)

    # Time series breaks the numeric/numeric tie before it can fall through to
    # `correlation`: an x-vs-y plot with an ordered x, described only (no
    # inferential test in the first cut — comparing time courses needs
    # mixed-effects / functional-data methods that don't fit the picker).
    if xk == "numeric" and yk == "numeric" and _is_timeseries(layers):
        return {"design": f"{y} over {x}", "family": "timeseries",
                "factors": [{"column": x, "role": "time"},
                            {"column": y, "role": "response"}],
                "test": None, "facet_handling": None,
                "chosen_by": "describe_only", "unit": unit, "issues": []}

    # One-sample (vs-reference) location test — opt-in via an explicit
    # `stats.family == "location"`, like a geom's declared `timeseries` family,
    # because a categorical-x + numeric-y spec otherwise infers `group_comparison`
    # (and most such plots genuinely are group comparisons). The grouping factor
    # is read exactly as group_comparison does (x for vertical, y for horizontal);
    # `reference` rides on the model so render/compiler can draw the line.
    if declared_family == "location":
        if xk == "categorical" and yk == "numeric":
            group, value = x, y
        elif xk == "numeric" and yk == "categorical":
            group, value = y, x
        else:
            group, value = None, y  # single unnamed group (degenerate)
        if group:
            design = f"location of {value} per group of {group} vs reference {reference:g}"
            factors = [{"column": group, "role": "group"}]
        else:
            design = f"location of {value} vs reference {reference:g}"
            factors = [{"column": value, "role": "variable"}]
        if unit and group:
            design += f"; n counts independent units ({' × '.join(unit)})"
        faceted = bool((facet or {}).get("row") or (facet or {}).get("col"))
        if faceted:
            design += " — describe-only per facet (Phase 4 v1 runs no per-facet test)"
            return {"design": design, "family": "location", "factors": factors,
                    "test": None, "facet_handling": None, "reference": reference,
                    "chosen_by": "describe_only", "unit": unit, "issues": []}
        return {"design": design, "family": "location", "factors": factors,
                "test": override, "facet_handling": None, "reference": reference,
                "chosen_by": "inferred", "unit": unit, "issues": []}

    if xk == "categorical" and yk == "numeric":
        family = "group_comparison"
        design = f"comparison of {y} between groups of {x}"
        factors = [{"column": x, "role": "group"}]
    # Phase 3c: horizontal orientation — categorical y + numeric x is still a
    # group comparison; the grouping factor is y and the measurement is x.
    elif xk == "numeric" and yk == "categorical":
        family = "group_comparison"
        design = f"comparison of {x} between groups of {y}"
        factors = [{"column": y, "role": "group"}]
    # Both axes categorical → contingency. The figure is a count tile; the
    # inferential cell (chi-square / Fisher's exact, §5) runs unless describe-only.
    elif xk == "categorical" and yk == "categorical":
        family = "contingency"
        design = f"count of {y} per {x}"
        factors = [{"column": x, "role": "column_factor"},
                   {"column": y, "role": "row_factor"}]
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
                "unit": unit, "issues": []}

    # Phase 5: a declared independent unit makes n explicit — the test counts
    # units (replicates averaged within each), and the figure can overlay one
    # mark per unit. State it in the design so the inference basis is unmistakable.
    if unit and family == "group_comparison":
        design += f"; n counts independent units ({' × '.join(unit)})"

    # Phase 2: a categorical color distinct from the grouping factor *could* be a
    # second factor. We surface it but do NOT run a two-way test (Tier-3 work).
    # The grouping factor is always factors[0]["column"] — x for vertical, y for
    # horizontal (Phase 3c), so we compare against that rather than hardcoding x.
    group_factor = factors[0]["column"]
    issues = []
    if (family == "group_comparison" and color and color != group_factor
            and _kind(schema, color) == "categorical"):
        design += (f"; color ({color}) could be a second factor — it is drawn "
                   f"as separate groups, but only {group_factor} is tested")
        issues.append({
            "level": "warning", "code": "color_second_factor", "geom": None,
            "message": (f"You mapped color = {color}. It may be a second factor "
                        f"in a two-way design; for now it is shown as separate "
                        f"groups and only {group_factor} is tested. A two-way test "
                        f"is planned; use the test override to change the design.")})

    faceted = bool((facet or {}).get("row") or (facet or {}).get("col"))
    if faceted:
        design += " — describe-only per facet (Phase 4 v1 runs no per-facet test)"
        return {"design": design, "family": family, "factors": factors,
                "test": None, "facet_handling": None,
                "chosen_by": "describe_only", "unit": unit, "issues": issues}

    # `override` still pins the test; chosen_by is descriptive only and no longer
    # flags the pick as a deviation from the recommendation.
    return {"design": design, "family": family, "factors": factors,
            "test": override, "facet_handling": None,
            "chosen_by": "inferred", "unit": unit, "issues": issues}
