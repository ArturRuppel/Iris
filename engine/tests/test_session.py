import pandas as pd
import pytest
from iris_engine import session


SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "g", "type": "categorical", "label": "G", "levels": ["a", "b"]},
    {"name": "y", "type": "numeric", "label": "Y"},
]}


def _df(n=5):
    return pd.DataFrame({
        "id": [str(i + 1) for i in range(n)],
        "excluded": [False] * n,
        "g": (["a", "b"] * n)[:n],
        "y": [float(i) for i in range(n)],
    })


def test_create_returns_id_and_window():
    store = session.SessionStore()
    tid = store.create(SCHEMA, _df())
    t = store.get(tid)
    assert t is not None
    assert t.n == 5
    assert t.version == 0
    win = t.window(0, 2)
    assert [r["id"] for r in win] == ["1", "2"]
    assert win[0]["y"] == 0.0 and win[0]["g"] == "a"


def test_window_clamps_and_handles_nan_as_none():
    store = session.SessionStore()
    df = _df(3)
    df.loc[1, "y"] = float("nan")
    tid = store.create(SCHEMA, df)
    t = store.get(tid)
    win = t.window(1, 99)             # end past the tail clamps
    assert win[0]["y"] is None        # NaN -> JSON null
    assert len(win) == 2


def test_edit_cell_bumps_version_and_persists():
    store = session.SessionStore()
    tid = store.create(SCHEMA, _df())
    t = store.get(tid)
    t.edit_cell("2", "y", 99.0)
    assert t.version == 1
    assert t.window(1, 2)[0]["y"] == 99.0


def test_edit_unknown_row_or_column_raises():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df()))
    with pytest.raises(KeyError):
        t.edit_cell("nope", "y", 1.0)
    with pytest.raises(KeyError):
        t.edit_cell("1", "nope", 1.0)


def test_toggle_exclusion_returns_new_state():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df()))
    assert t.toggle_exclusion("1") is True
    assert t.window(0, 1)[0]["excluded"] is True
    assert t.toggle_exclusion("1") is False
    assert t.version == 2


def test_distinct_levels_sorted_strings_capped():
    store = session.SessionStore()
    df = _df(6)
    df["g"] = ["b", "a", "c", "a", "b", "a"]
    t = store.get(store.create(SCHEMA, df))
    assert t.distinct("g") == ["a", "b", "c"]
