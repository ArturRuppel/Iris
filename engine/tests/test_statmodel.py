"""Stat-model inference: encodings + schema -> an explicit, legible model."""
from triad_engine import statmodel

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "treatment", "type": "categorical", "label": "Treatment",
     "levels": ["control", "drug_a"]},
    {"name": "dose", "type": "numeric", "label": "Dose"},
    {"name": "response", "type": "numeric", "label": "Response"},
]}


def enc(x=None, y=None):
    return {"x": {"column": x} if x else None,
            "y": {"column": y} if y else None,
            "color": None, "size": None, "shape": None}


def test_categorical_x_numeric_y_is_comparison():
    m = statmodel.infer(enc("treatment", "response"), SCHEMA, override=None)
    assert m["family"] == "group_comparison"
    assert m["chosen_by"] == "inferred"
    assert m["test"] is None  # let stats.py recommend
    assert "treatment" in m["design"] and "response" in m["design"]


def test_two_numerics_is_correlation():
    m = statmodel.infer(enc("dose", "response"), SCHEMA, override=None)
    assert m["family"] == "correlation"


def test_single_numeric_is_descriptive():
    m = statmodel.infer(enc(None, "response"), SCHEMA, override=None)
    assert m["family"] == "descriptive"


def test_override_is_recorded_and_carried():
    m = statmodel.infer(enc("treatment", "response"), SCHEMA,
                        override="mann_whitney")
    assert m["chosen_by"] == "user_override"
    assert m["test"] == "mann_whitney"


def test_describe_only_when_unmapped():
    m = statmodel.infer(enc(None, None), SCHEMA, override=None)
    assert m["family"] == "none"
    assert m["chosen_by"] == "describe_only"


SCHEMA2 = {"schema_version": "1.0", "columns": SCHEMA["columns"] + [
    {"name": "genotype", "type": "categorical", "label": "Genotype",
     "levels": ["wt", "ko"]},
]}


def enc_color(x, y, color):
    e = enc(x, y)
    e["color"] = {"column": color} if color else None
    return e


def test_categorical_color_distinct_from_x_surfaces_second_factor():
    m = statmodel.infer(enc_color("treatment", "response", "genotype"),
                        SCHEMA2, override=None)
    # the family/test for the one-factor design is UNCHANGED (no two-way here)
    assert m["family"] == "group_comparison"
    codes = {i["code"] for i in m["issues"]}
    assert "color_second_factor" in codes
    assert "genotype" in m["design"]


def test_color_equal_to_x_raises_no_second_factor_issue():
    m = statmodel.infer(enc_color("treatment", "response", "treatment"),
                        SCHEMA2, override=None)
    assert [i for i in m["issues"] if i["code"] == "color_second_factor"] == []
