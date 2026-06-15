"""Normalize any legacy spec to the 2.0 grammar shape, idempotently."""
from triad_engine import specnorm


def legacy_spec():
    return {
        "spec_version": "1.0", "id": "an", "title": "t",
        "mappings": {"x": {"column": "treatment"}, "y": {"column": "response"},
                     "color": {"column": "treatment"}, "pair_by": None,
                     "facet": None},
        "layers": [{"mark": "dot", "options": {"jitter": 0.18}},
                   {"mark": "summary", "stat": {"center": "mean", "error": "ci95"}}],
        "stats": {"family": "group_comparison", "test": "mann_whitney",
                  "chosen_by": "user_override"},
        "style": {"preset": "demo_default", "overrides": {}},
    }


def test_mappings_become_encodings():
    out = specnorm.normalize(legacy_spec())
    assert out["spec_version"] == "2.0"
    assert out["encodings"]["x"] == {"column": "treatment"}
    assert out["encodings"]["y"] == {"column": "response"}
    assert out["encodings"]["color"] == {"column": "treatment"}
    assert out["encodings"]["size"] is None
    assert "mappings" not in out


def test_marks_become_geoms_preserving_order_and_options():
    out = specnorm.normalize(legacy_spec())
    assert [l["geom"] for l in out["layers"]] == ["dot", "summary"]
    assert out["layers"][0]["params"] == {"jitter": 0.18}


def test_carries_the_user_override_for_inference():
    out = specnorm.normalize(legacy_spec())
    assert out["_override"] == "mann_whitney"  # chosen_by was user_override


def test_no_override_when_recommendation_accepted():
    spec = legacy_spec()
    spec["stats"]["chosen_by"] = "recommendation_accepted"
    out = specnorm.normalize(spec)
    assert out["_override"] is None


def test_idempotent_on_2_0():
    out = specnorm.normalize(legacy_spec())
    again = specnorm.normalize(out)
    assert again["encodings"] == out["encodings"]
    assert [l["geom"] for l in again["layers"]] == ["dot", "summary"]
