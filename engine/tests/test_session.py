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


def test_edit_bool_flag_cell_persists():
    # The replacement for the removed exclusion toggle: a boolean flag is an
    # ordinary editable cell on the session table (filtered on downstream).
    store = session.SessionStore()
    df = _df()
    df["flag"] = [False] * 5
    t = store.get(store.create(SCHEMA, df))
    t.edit_cell("1", "flag", True)
    assert t.version == 1
    assert t.window(0, 1)[0]["flag"] is True


def test_distinct_levels_sorted_strings_capped():
    store = session.SessionStore()
    df = _df(6)
    df["g"] = ["b", "a", "c", "a", "b", "a"]
    t = store.get(store.create(SCHEMA, df))
    assert t.distinct("g") == ["a", "b", "c"]


def test_counts_total():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df(4)))
    assert t.counts() == {"total": 4}


def test_get_refreshes_lru_so_active_table_survives_eviction():
    # Regression: a `get` must count as a use. The "main" table is created first
    # but stays active (analyze/save touch it every request); a burst of derived
    # tables must NOT evict it. Before true-LRU `get`, eviction was FIFO and the
    # first-created (main) table was the first to go — silently breaking re-save.
    store = session.SessionStore(maxlen=3)
    main = store.create(SCHEMA, _df())
    for _ in range(5):                 # well past maxlen
        derived = store.create(SCHEMA, _df())
        assert store.get(main) is not None   # touch keeps it alive
        assert store.get(derived) is not None
    assert store.get(main) is not None        # survived the whole burst


def test_untouched_table_still_evicts_under_pressure():
    # The bound still holds: an id nobody touches is the one that falls out.
    store = session.SessionStore(maxlen=2)
    cold = store.create(SCHEMA, _df())
    a = store.create(SCHEMA, _df())
    b = store.create(SCHEMA, _df())   # pushes `cold` out (never touched)
    assert store.get(cold) is None
    assert store.get(a) is not None and store.get(b) is not None


def test_ensure_capacity_keeps_a_loaded_document_cohort_resident():
    # Regression: loading a >maxlen multi-table document creates one session per
    # table in a burst; ALL must survive (the load hands their ids back). Without
    # ensure_capacity the default bound evicts the earliest before the loop ends.
    store = session.SessionStore()       # default maxlen=8
    n = 11                               # a document with more tables than the cap
    store.ensure_capacity(n)
    ids = [store.create(SCHEMA, _df()) for _ in range(n)]
    for tid in ids:
        assert store.get(tid) is not None   # every table of the cohort survived


def test_ensure_capacity_only_grows_the_bound():
    # Never shrink: a smaller later load must not drop a still-referenced table.
    store = session.SessionStore(maxlen=5)
    store.ensure_capacity(2)             # below current -> no-op
    ids = [store.create(SCHEMA, _df()) for _ in range(5)]
    for tid in ids:
        assert store.get(tid) is not None
