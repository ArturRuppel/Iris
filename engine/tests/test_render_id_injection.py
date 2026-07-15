"""Pins that `iris_engine.render.render` — the documented FastAPI-free entry
point — works on a hand-built table dict that omits the `id` column.

`render`'s docstring says `table` is a resolved table dict
(`{schema, rows|columns|frame}`) and says nothing about `id` being required.
But `hierarchy.materialize_plan` indexes `raw["id"]`, and only the HTTP layer
(main.py) injected it before this fix — so a caller who builds `table` straight
from a DataFrame (the whole point of a library entry point) hit a bare
`KeyError: 'id'` instead of a working render. `_load_frame` now injects the
same row-bookkeeping `id` column main.py's GUI paths do, and only when one
isn't already present.
"""
import matplotlib
matplotlib.use("Agg")

import pandas as pd

from iris_engine import render


def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "group", "type": "categorical", "label": "Group"},
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "rep", "type": "identifier", "label": "Rep"},
        {"name": "y", "type": "numeric", "label": "Y"}]}


def _rows():
    rows, rid = [], 0
    for s in ["s1", "s2", "s3"]:
        for grp in ("A", "B"):
            for r in range(3):
                rows.append({"group": grp, "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return rows


def _spec():
    return {
        "spec_version": "2.0",
        "title": "t",
        "encodings": {"x": {"column": "group"}, "y": {"column": "y"},
                      "color": None, "size": None, "shape": None},
        "layers": [{"geom": "box", "params": {}}],
        "hierarchy": {"spine": ["subject", "rep"]},
        "stats": {"alpha": 0.05, "test": "auto"},
    }


def test_render_injects_id_when_absent():
    """A table dict with no `id` key must render, not raise KeyError('id')."""
    table = {"schema": _schema(), "rows": _rows()}  # NOTE: no "id" key
    fig, res, df, schema, model, issues, level_tables = render.render(table, _spec())
    assert "id" in df.columns
    assert list(df["id"]) == [str(i + 1) for i in range(len(df))]
    # id is row-bookkeeping, not user data: it stays out of the schema's column list.
    assert "id" not in [c["name"] for c in schema["columns"]]


def test_render_does_not_clobber_existing_id():
    """A table that already carries `id` (e.g. a round-tripped `.iris`) must keep
    its original values byte-identical — the injection is absence-only."""
    rows = _rows()
    for i, row in enumerate(rows):
        row["id"] = f"custom-{i}"
    table = {"schema": _schema(), "rows": rows}
    fig, res, df, schema, model, issues, level_tables = render.render(table, _spec())
    assert list(df["id"]) == [f"custom-{i}" for i in range(len(rows))]
