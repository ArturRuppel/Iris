"""`stats.off` — the "no statistics" decision. The analysis is a plot only: no
test, no descriptives, no stats annotation on the figure, and a stats payload
flagged ``off: True`` the frontend keys on to hide every stats surface. A spec
without `off` behaves exactly as before."""
import copy

from fastapi.testclient import TestClient

from iris_engine import render as render_mod, specnorm
from iris_engine.main import app
from test_engine import make_spec, make_table, make_scatter_spec, make_scatter_table
from test_document_roundtrip import _save_then_load, _spec as _rt_spec

client = TestClient(app)


def _analyze(table, spec):
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200, r.text
    return r.json()


def test_specnorm_carries_the_off_flag_for_legacy_and_modern_specs():
    legacy = make_spec(off=True)
    assert specnorm.normalize(legacy)["_stats_off"] is True
    modern = _rt_spec(off=True)
    out = specnorm.normalize(modern)
    assert out["_stats_off"] is True
    assert out["stats"]["off"] is True            # the decision itself survives
    assert specnorm.normalize(make_spec())["_stats_off"] is False


def test_off_comparison_runs_no_test_and_no_descriptives():
    body = _analyze(make_table(), make_spec(off=True))
    s = body["stats"]
    assert s["off"] is True
    assert s["chosen_by"] == "off"
    assert s["result"] == {"test": "none"}
    assert s["summaries"] == [] and s["checks"] == []
    assert s["methods_text"] == ""
    # the palette knob still names its series
    assert s["levels"] == ["control", "drug_a"]
    assert body["stat_model"]["chosen_by"] == "off"
    assert body["stat_model"]["test"] is None
    assert "<svg" in body["figure"]["svg"]


def test_off_suppresses_the_significance_bracket():
    on = make_spec()
    on["style"]["overrides"] = {"show_significance": True}
    off = copy.deepcopy(on)
    off["stats"]["off"] = True
    assert "***" in _analyze(make_table(), on)["figure"]["svg"]
    assert "***" not in _analyze(make_table(), off)["figure"]["svg"]


def test_off_correlation_draws_no_readout():
    body = _analyze(make_scatter_table(), make_scatter_spec(off=True))
    assert body["stats"]["off"] is True
    assert "r = " not in body["figure"]["svg"]
    assert "r = " in _analyze(make_scatter_table(), make_scatter_spec())["figure"]["svg"]


def test_off_histogram_draws_no_median():
    spec = make_spec(off=True)
    spec["mappings"] = {"x": None, "y": {"column": "response"}, "color": None}
    spec["layers"] = [{"mark": "histogram", "options": {}}]
    spec["stats"]["family"] = "descriptive"
    body = _analyze(make_table(), spec)
    assert body["stats"]["off"] is True
    assert "median" not in body["figure"]["svg"]
    spec["stats"].pop("off")
    assert "median" in _analyze(make_table(), spec)["figure"]["svg"]


def test_off_toggles_through_the_stats_cache():
    """Toggling `off` on the same data must not serve the other state's result."""
    table = make_table()
    assert "off" not in _analyze(table, make_spec())["stats"]
    assert _analyze(table, make_spec(off=True))["stats"]["off"] is True
    assert "off" not in _analyze(table, make_spec())["stats"]


def test_render_module_off_path():
    fig, res, *_ = render_mod.render(make_table(), make_spec(off=True))
    assert res == render_mod.stats_off_result(0.05, levels=["control", "drug_a"])


def test_off_survives_save_load_and_is_honored_after_load():
    doc = _save_then_load(_rt_spec(off=True))
    loaded = doc["analyses"][0]
    assert loaded["stats"]["off"] is True
    table = {"schema": doc["tables"][0]["schema"], "rows": doc["tables"][0]["rows"]}
    body = _analyze(table, loaded)
    assert body["stats"]["off"] is True
    assert body["stat_model"]["chosen_by"] == "off"


def test_methods_export_does_not_claim_statistics_for_an_off_analysis():
    from iris_engine import methods
    spec = _rt_spec(off=True)
    spec["hierarchy"] = {"spine": ["id"], "fn": {}}
    assert "statistics were computed" not in methods.shaping_prose(spec)
    spec["stats"].pop("off")
    assert "statistics were computed" in methods.shaping_prose(spec)
