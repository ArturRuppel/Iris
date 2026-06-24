"""Phase 3d: tile / contingency-matrix geom.

categorical x × categorical y → count matrix rendered as a heatmap.
No inferential test is run (describe-only by the engine); chi-square is
planned for a later tier.
"""
import re

import pytest
from fastapi.testclient import TestClient

from iris_engine import geoms, statmodel
from iris_engine.main import app

client = TestClient(app)

# ── fixtures ──────────────────────────────────────────────────────────────────

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "id",        "type": "identifier",  "label": "ID"},
    {"name": "treatment", "type": "categorical",  "label": "Treatment",
     "levels": ["ctrl", "drug_a", "drug_b"]},
    {"name": "outcome",   "type": "categorical",  "label": "Outcome",
     "levels": ["responder", "non_responder"]},
    {"name": "score",     "type": "numeric",      "label": "Score"},
]}

# 6 rows × 2 levels → counts should total 6 per treatment for 3 treatments = 18
ROWS = [
    {"id": "r1",  "treatment": "ctrl",   "outcome": "responder",     "score": 1.0},
    {"id": "r2",  "treatment": "ctrl",   "outcome": "responder",     "score": 2.0},
    {"id": "r3",  "treatment": "ctrl",   "outcome": "non_responder", "score": 3.0},
    {"id": "r4",  "treatment": "drug_a", "outcome": "responder",     "score": 4.0},
    {"id": "r5",  "treatment": "drug_a", "outcome": "non_responder", "score": 5.0},
    {"id": "r6",  "treatment": "drug_a", "outcome": "non_responder", "score": 6.0},
    {"id": "r7",  "treatment": "drug_b", "outcome": "responder",     "score": 7.0},
    {"id": "r8",  "treatment": "drug_b", "outcome": "responder",     "score": 8.0},
    {"id": "r9",  "treatment": "drug_b", "outcome": "non_responder", "score": 9.0},
]

TABLE = {"schema": SCHEMA, "rows": ROWS}


def tile_spec(**overrides):
    base = {
        "spec_version": "2.1",
        "id": "tile_test", "title": "Tile test",
        "data": {"filter": []},
        "reduce": {"steps": []},
        "encodings": {
            "x": {"column": "treatment"},
            "y": {"column": "outcome"},
            "color": None, "size": None, "shape": None,
        },
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "layers": [{"geom": "tile", "params": {}}],
        "stats": {
            "family": "contingency", "test": "none",
            "describe_only": True, "alpha": 0.05,
        },
        "annotations": {"significance_brackets": "auto", "show_n": False},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }
    base.update(overrides)
    return base


# ── geom registry ─────────────────────────────────────────────────────────────

def test_tile_geom_registered():
    assert "tile" in geoms.GEOMS


def test_tile_geom_axis_types():
    tile = geoms.GEOMS["tile"]
    assert tile.x_type == "categorical"
    assert tile.y_type == "categorical"


def test_tile_geom_family_and_aggregates():
    tile = geoms.GEOMS["tile"]
    assert tile.family == "contingency"
    assert tile.aggregates is True


def test_tile_geom_no_h_orient():
    # tile renders as a matrix — horizontal orientation is not applicable
    assert geoms.GEOMS["tile"].h_orient is False


def test_tile_in_registry_payload():
    payload = geoms.registry_payload()
    assert "tile" in payload["geoms"]
    t = payload["geoms"]["tile"]
    assert t["x_type"] == "categorical"
    assert t["y_type"] == "categorical"
    assert t["family"] == "contingency"
    assert t["h_orient"] is False


# ── statmodel ─────────────────────────────────────────────────────────────────

def test_statmodel_infers_contingency():
    schema = {"columns": [
        {"name": "treatment", "type": "categorical"},
        {"name": "outcome",   "type": "categorical"},
    ]}
    encodings = {"x": {"column": "treatment"}, "y": {"column": "outcome"},
                 "color": None, "size": None, "shape": None}
    model = statmodel.infer(encodings, schema, None)
    assert model["family"] == "contingency"


def test_statmodel_contingency_factors():
    schema = {"columns": [
        {"name": "treatment", "type": "categorical"},
        {"name": "outcome",   "type": "categorical"},
    ]}
    encodings = {"x": {"column": "treatment"}, "y": {"column": "outcome"},
                 "color": None, "size": None, "shape": None}
    model = statmodel.infer(encodings, schema, None)
    roles = {f["column"]: f["role"] for f in model["factors"]}
    assert roles["treatment"] == "column_factor"
    assert roles["outcome"] == "row_factor"


# ── stats.contingency_counts ──────────────────────────────────────────────────

def test_contingency_counts_shape():
    import pandas as pd
    from iris_engine.stats import contingency_counts

    df = pd.DataFrame(ROWS)
    res = contingency_counts(df, "treatment", "outcome",
                             ["ctrl", "drug_a", "drug_b"],
                             ["responder", "non_responder"])
    assert res["x_levels"] == ["ctrl", "drug_a", "drug_b"]
    assert res["y_levels"] == ["responder", "non_responder"]
    assert len(res["counts"]) == 2          # rows = y_levels
    assert len(res["counts"][0]) == 3       # cols = x_levels


def test_contingency_counts_values():
    import pandas as pd
    from iris_engine.stats import contingency_counts

    df = pd.DataFrame(ROWS)
    res = contingency_counts(df, "treatment", "outcome",
                             ["ctrl", "drug_a", "drug_b"],
                             ["responder", "non_responder"])
    # row 0 = "responder" counts across [ctrl, drug_a, drug_b]
    assert res["counts"][0] == [2, 1, 2]
    # row 1 = "non_responder"
    assert res["counts"][1] == [1, 2, 1]


def test_contingency_counts_total():
    import pandas as pd
    from iris_engine.stats import contingency_counts

    df = pd.DataFrame(ROWS)
    res = contingency_counts(df, "treatment", "outcome",
                             ["ctrl", "drug_a", "drug_b"],
                             ["responder", "non_responder"])
    assert res["total"] == 9


def test_contingency_result_shape():
    """Result key structure must be compatible with the AnalyzeResponse contract."""
    import pandas as pd
    from iris_engine.stats import contingency_counts

    df = pd.DataFrame(ROWS)
    res = contingency_counts(df, "treatment", "outcome", ["ctrl"], ["responder"])
    # required by the response contract
    assert "levels" in res
    assert "checks" in res
    assert "recommendation" in res
    assert "result" in res
    assert "summaries" in res
    assert "methods_text" in res


# ── full render pipeline ──────────────────────────────────────────────────────

def test_tile_renders():
    r = client.post("/analyze", json={"table": TABLE, "spec": tile_spec()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "<svg" in body["figure"]["svg"]


def test_figure_payload_has_no_point_groups():
    """Item I: dots are not clickable, so the figure payload is svg-only —
    no point_groups field on any figure (tile or otherwise)."""
    r = client.post("/analyze", json={"table": TABLE, "spec": tile_spec()})
    assert r.status_code == 200
    assert "point_groups" not in r.json()["figure"]


def test_tile_stat_model_is_contingency():
    r = client.post("/analyze", json={"table": TABLE, "spec": tile_spec()})
    assert r.status_code == 200
    body = r.json()
    assert body["stat_model"]["family"] == "contingency"


def test_tile_svg_contains_count_cells():
    """show_annotation: cell count numbers should appear in the SVG.
    With svg.fonttype=none the labels are real <text> nodes (selectable, not
    outlined to paths), so the count string is the text element's content."""
    spec = tile_spec()
    spec["style"] = {"overrides": {"show_annotation": True}}
    r = client.post("/analyze", json={"table": TABLE, "spec": spec})
    assert r.status_code == 200
    svg = r.json()["figure"]["svg"]
    # counts for the 9-row fixture: ctrl→responder=2, drug_a→responder=1, etc.
    assert re.search(r"<text[^>]*>2</text>", svg)
    assert re.search(r"<text[^>]*>1</text>", svg)


def test_tile_respects_level_order():
    """x/y-axis tick order follows schema levels, not sort order."""
    r = client.post("/analyze", json={"table": TABLE, "spec": tile_spec()})
    assert r.status_code == 200
    svg = r.json()["figure"]["svg"]
    # "ctrl" should appear before "drug_a" in the SVG (leftmost x tick)
    ctrl_pos = svg.find("ctrl")
    drug_a_pos = svg.find("drug_a")
    assert ctrl_pos != -1 and drug_a_pos != -1
    assert ctrl_pos < drug_a_pos


def test_tile_family_routes_correctly_not_descriptive():
    """categorical×categorical must not fall through to the descriptive branch."""
    r = client.post("/analyze", json={"table": TABLE, "spec": tile_spec()})
    assert r.status_code == 200
    body = r.json()
    assert body["stat_model"]["family"] != "descriptive"
    assert body["stat_model"]["family"] == "contingency"


def test_tile_missing_x_column_raises_422():
    """A tile spec with no x encoding should get a 422, not a server error."""
    spec = tile_spec()
    spec["encodings"]["x"] = None
    r = client.post("/analyze", json={"table": TABLE, "spec": spec})
    # family will be "none" (no x) → 422 from the engine guard
    assert r.status_code == 422


@pytest.mark.parametrize("excl_id", ["r1", "r4"])
def test_tile_filter_on_flag_drops_row(excl_id):
    """Filtering on a boolean flag column drops the row from the matrix — the
    replacement for the removed exclusion mechanism."""
    schema = {**SCHEMA, "columns": [*SCHEMA["columns"],
              {"name": "flag", "type": "bool", "label": "Flag"}]}
    rows = [{**row, "flag": row["id"] == excl_id} for row in ROWS]
    table = {"schema": schema, "rows": rows}
    spec = tile_spec()
    spec["reduce"] = {"steps": [{"kind": "filter", "conditions": [
        {"column": "flag", "op": "==", "value": False}]}]}
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200
    total = r.json()["stats"]["total"]
    assert total == len(ROWS) - 1
