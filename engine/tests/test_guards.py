"""Geom-level validity guards. The point cap is the 82k-freeze fix."""
import pandas as pd

from triad_engine import guards, geoms

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "grp", "type": "categorical", "label": "Group",
     "levels": ["a", "b"]},
    {"name": "val", "type": "numeric", "label": "Value"},
]}


def frame(n_per_group):
    rows = []
    for g in ("a", "b"):
        for i in range(n_per_group):
            rows.append({"id": f"{g}{i}", "grp": g, "val": float(i),
                         "excluded": False})
    return pd.DataFrame(rows)


def spec(*geom_names):
    return {"encodings": {"x": {"column": "grp"}, "y": {"column": "val"},
                          "color": None, "size": None, "shape": None},
            "layers": [{"geom": g, "params": {}} for g in geom_names]}


def test_dot_over_cap_is_blocking():
    df = frame(geoms.POINT_CAP)  # 2 * POINT_CAP rows, well over the cap
    issues = guards.evaluate(df, SCHEMA, spec("dot"), stat_model=None)
    blocking = [i for i in issues if i["level"] == "blocking"]
    assert blocking and blocking[0]["geom"] == "dot"
    assert f"{len(df):,}" in blocking[0]["message"]  # comma-formatted count


def test_dot_under_cap_is_clean():
    df = frame(5)  # 10 rows
    issues = guards.evaluate(df, SCHEMA, spec("dot"), stat_model=None)
    assert [i for i in issues if i["level"] == "blocking"] == []


def test_aggregating_geom_never_trips_the_point_cap():
    df = frame(geoms.POINT_CAP)
    issues = guards.evaluate(df, SCHEMA, spec("bar"), stat_model=None)
    assert issues == []


def test_box_below_min_n_warns():
    df = frame(2)  # 2 per group, below the box minimum
    issues = guards.evaluate(df, SCHEMA, spec("box"), stat_model=None)
    warn = [i for i in issues if i["level"] == "warning"]
    assert warn and warn[0]["geom"] == "box"
