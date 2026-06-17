"""Normalize any legacy spec to the 2.0 grammar shape, idempotently."""
from iris_engine import specnorm


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


def test_legacy_color_distinct_from_x_survives_as_a_channel():
    # a legacy doc that colored by a SECOND column keeps that mapping, so it
    # opens in Phase 2 as an independent color channel (now a dodged factor)
    spec = legacy_spec()
    spec["mappings"]["color"] = {"column": "genotype"}
    out = specnorm.normalize(spec)
    assert out["encodings"]["color"] == {"column": "genotype"}
    assert out["encodings"]["x"] == {"column": "treatment"}


def test_marks_become_geoms_preserving_order_and_options():
    out = specnorm.normalize(legacy_spec())
    assert [l["geom"] for l in out["layers"]] == ["dot", "summary"]
    assert out["layers"][0]["params"] == {"jitter": 0.18}


def test_carries_the_pinned_test_from_the_override_field():
    # the decoupled transport: the pin rides in stats.override, independent of the
    # neutral chosen_by label.
    spec = legacy_spec()
    spec["stats"] = {"family": "group_comparison", "test": "mann_whitney",
                     "chosen_by": "recommendation_accepted", "override": "mann_whitney"}
    out = specnorm.normalize(spec)
    assert out["_override"] == "mann_whitney"


def test_carries_the_legacy_user_override_for_inference():
    # back-compat: pre-decoupling specs encoded the pin as chosen_by == user_override
    out = specnorm.normalize(legacy_spec())
    assert out["_override"] == "mann_whitney"


def test_no_override_when_recommendation_accepted_and_no_override_field():
    spec = legacy_spec()
    spec["stats"]["chosen_by"] = "recommendation_accepted"
    out = specnorm.normalize(spec)
    assert out["_override"] is None


def test_legacy_descriptive_drops_x_so_inference_reads_it_right():
    # legacy descriptive specs left x mapped; the grammar reads family from the
    # encodings, so x must be dropped or it would misinfer as comparison
    spec = legacy_spec()
    spec["stats"]["family"] = "descriptive"
    out = specnorm.normalize(spec)
    assert out["encodings"]["x"] is None
    assert out["encodings"]["y"] == {"column": "response"}


def test_idempotent_on_2_0():
    out = specnorm.normalize(legacy_spec())
    again = specnorm.normalize(out)
    assert again["encodings"] == out["encodings"]
    assert [l["geom"] for l in again["layers"]] == ["dot", "summary"]


def _descriptive_legacy(marks):
    spec = legacy_spec()
    spec["stats"]["family"] = "descriptive"
    spec["layers"] = [{"mark": m, "options": o} for m, o in marks]
    return spec


def test_legacy_histogram_folds_into_distribution_bars():
    out = specnorm.normalize(_descriptive_legacy([("histogram", {"hist_bins": 12})]))
    assert [l["geom"] for l in out["layers"]] == ["distribution"]
    p = out["layers"][0]["params"]
    assert p["dist_render"] == "bars"
    assert p["hist_bins"] == 12          # the fixed bin count carries over
    assert not p.get("overlay_smooth")


def test_legacy_density_folds_into_distribution_smooth():
    out = specnorm.normalize(_descriptive_legacy([("density", {})]))
    assert [l["geom"] for l in out["layers"]] == ["distribution"]
    assert out["layers"][0]["params"]["dist_render"] == "smooth"


def test_legacy_histogram_plus_density_collapses_to_one_overlaid_layer():
    out = specnorm.normalize(
        _descriptive_legacy([("histogram", {}), ("density", {})]))
    assert [l["geom"] for l in out["layers"]] == ["distribution"]
    p = out["layers"][0]["params"]
    assert p["dist_render"] == "bars"
    assert p["overlay_smooth"] is True


def test_distribution_migration_is_idempotent_on_2_0():
    # a 2.0 doc still carrying the retired geoms is migrated on the early path
    spec = {"spec_version": "2.0", "id": "a", "title": "t",
            "encodings": {"x": None, "y": {"column": "response"}, "color": None,
                          "size": None, "shape": None},
            "layers": [{"geom": "density", "params": {}, "level": ""}],
            "stats": {"family": "descriptive", "test": None}}
    once = specnorm.normalize(spec)
    twice = specnorm.normalize(once)
    assert [l["geom"] for l in once["layers"]] == ["distribution"]
    assert [l["geom"] for l in twice["layers"]] == ["distribution"]
    assert once["layers"][0]["params"]["dist_render"] == "smooth"
