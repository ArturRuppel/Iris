"""The identifier signal: identifier columns *ideally* jointly key the raw table,
but non-unique identifiers are legitimate — a coarse spine over replicate rows (the
SuperPlot idiom) names a nesting level without reaching unique rows. So set_schema
never blocks on it; it commits and returns a warning message the Data tab surfaces,
and never touches the data."""
import pandas as pd

from iris_engine.session import SessionTable, identifier_collision


def _table():
    # two subjects, two timepoints each — subject ALONE does not key the table,
    # but (subject, t) does.
    df = pd.DataFrame({
        "subject": ["s1", "s1", "s2", "s2"],
        "t": [1, 2, 1, 2],
        "y": [10.0, 11.0, 12.0, 13.0],
    })
    schema = {"schema_version": "1.0", "columns": [
        {"name": "subject", "type": "categorical", "identifier": True},
        {"name": "t", "type": "numeric", "identifier": True},
        {"name": "y", "type": "numeric"},
    ]}
    return SessionTable(schema, df)


def _schema(*identifiers):
    ids = set(identifiers)
    cols = []
    for name, typ in (("subject", "categorical"), ("t", "numeric"), ("y", "numeric")):
        c = {"name": name, "type": typ}
        if name in ids:
            c["identifier"] = True
        cols.append(c)
    return {"schema_version": "1.0", "columns": cols}


def test_keying_identifiers_commit_with_no_warning():
    t = _table()
    warning = t.set_schema(_schema("subject", "t"))   # (subject, t) is unique per row
    assert warning is None
    assert t.version == 1
    assert [c["name"] for c in t.schema["columns"] if c.get("identifier")] == ["subject", "t"]


def test_non_keying_identifiers_commit_with_a_warning():
    t = _table()
    warning = t.set_schema(_schema("subject"))        # subject alone: rows collide
    # committed (not rejected), with a legible note about replication below
    assert t.version == 1
    assert [c["name"] for c in t.schema["columns"] if c.get("identifier")] == ["subject"]
    assert warning is not None
    assert "don't uniquely key" in warning
    assert "4 rows share an identity" in warning


def test_collision_info_reports_the_offending_ids():
    t = _table()
    collision = identifier_collision(t._df, _schema("subject"))
    assert collision["ids"] == ["subject"]
    assert collision["n_rows"] == 4                    # all four rows are in a collision
    assert collision["example"].get("subject") in ("s1", "s2")
    # a keying set has no collision
    assert identifier_collision(t._df, _schema("subject", "t")) is None


def test_no_identifiers_commits_cleanly():
    t = _table()
    assert t.set_schema(_schema()) is None             # nothing claimed → no warning
    assert t.version == 1


def test_demotion_that_breaks_the_key_commits_and_warns():
    t = _table()
    assert t.set_schema(_schema("subject", "t")) is None     # start keyed
    warning = t.set_schema(_schema("subject"))               # demote t → no longer keys
    assert warning is not None                               # surfaced, not blocked
    assert t.version == 2                                     # committed


def test_data_is_never_touched():
    t = _table()
    before = t._df.copy()
    t.set_schema(_schema("subject"))                   # warns, but reads only
    assert t._df.equals(before)
