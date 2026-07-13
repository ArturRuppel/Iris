"""The identifier invariant: the identifier columns must jointly key the raw
table. set_schema rejects a role configuration that leaves rows indistinguishable
(so every downstream n stays honest), and never touches the data."""
import pandas as pd
import pytest

from iris_engine.session import IdentifierError, SessionTable


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


def test_accepts_identifiers_that_key_the_table():
    t = _table()
    t.set_schema(_schema("subject", "t"))          # (subject, t) is unique per row
    assert t.version == 1
    assert [c["name"] for c in t.schema["columns"] if c.get("identifier")] == ["subject", "t"]


def test_rejects_identifiers_that_do_not_key_the_table():
    t = _table()
    with pytest.raises(IdentifierError) as ei:
        t.set_schema(_schema("subject"))           # subject alone: 2 rows collide × 2
    err = ei.value
    assert err.ids == ["subject"]
    assert err.n_rows == 4                          # all four rows are in a collision
    assert err.example.get("subject") in ("s1", "s2")
    # rejected: the schema was NOT swapped in and no version bump happened
    assert t.version == 0
    assert t.schema["columns"][0].get("identifier") is True  # untouched original


def test_no_identifiers_is_vacuously_ok():
    t = _table()
    t.set_schema(_schema())                          # nothing claimed → no error
    assert t.version == 1


def test_demotion_that_breaks_the_key_is_rejected():
    t = _table()
    t.set_schema(_schema("subject", "t"))            # start keyed
    with pytest.raises(IdentifierError):
        t.set_schema(_schema("subject"))             # demote t → subject no longer keys
    # still at the last good version (the demotion did not commit)
    assert t.version == 1


def test_data_is_never_touched_on_rejection():
    t = _table()
    before = t._df.copy()
    with pytest.raises(IdentifierError):
        t.set_schema(_schema("subject"))
    # the frame is unchanged (validation reads, never writes)
    assert t._df.equals(before)
