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


def test_relabel_category_renames_across_rows_no_merge():
    # Renaming a level to a fresh name just relabels its rows; not a merge.
    store = session.SessionStore()
    df = _df(4)
    df["g"] = ["a", "a", "b", "b"]
    t = store.get(store.create(SCHEMA, df))
    info = t.relabel_category("g", "a", "c")
    assert info == {"n": 2, "merged": False}
    assert t.version == 1
    assert [r["g"] for r in t.window(0, 4)] == ["c", "c", "b", "b"]
    # explicit schema levels track the rename
    assert t.schema["columns"][0]["levels"] == ["c", "b"]


def test_relabel_category_into_sibling_merges_and_reports():
    # Renaming "a" -> "b" when "b" already exists fuses the two levels: rows keep
    # their values but now share a level (two grouped columns collapse to one).
    store = session.SessionStore()
    df = _df(4)
    df["g"] = ["a", "a", "b", "b"]
    t = store.get(store.create(SCHEMA, df))
    info = t.relabel_category("g", "a", "b")
    assert info == {"n": 2, "merged": True}
    assert [r["g"] for r in t.window(0, 4)] == ["b", "b", "b", "b"]
    assert t.schema["columns"][0]["levels"] == ["b"]   # deduped on merge


def test_relabel_unknown_column_or_absent_level_raises():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df()))
    with pytest.raises(KeyError):
        t.relabel_category("nope", "a", "b")
    with pytest.raises(KeyError):
        t.relabel_category("g", "ghost", "b")    # no rows carry that level
    assert t.version == 0                          # rejected: no partial mutation


def test_delete_rows_drops_by_id_and_reports_count():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df(5)))
    removed = t.delete_rows(["2", "4"])
    assert removed == 2
    assert t.version == 1
    assert [r["id"] for r in t.window(0, 99)] == ["1", "3", "5"]


def test_delete_rows_ignores_unknown_ids_and_is_a_noop_when_empty():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df(3)))
    removed = t.delete_rows(["ghost", "2"])   # only "2" is real
    assert removed == 1
    assert t.version == 1
    # a delete that matches nothing changes nothing and does not bump the version
    assert t.delete_rows(["ghost"]) == 0
    assert t.version == 1


SCHEMA2 = {"schema_version": "1.0", "columns": [
    {"name": "g", "type": "categorical", "label": "G", "levels": ["a", "b"]},
    {"name": "d", "type": "categorical", "label": "D", "levels": ["D1", "D2"]},
    {"name": "y", "type": "numeric", "label": "Y"},
]}


def _df2():
    # balanced 2 (g) × 2 (d) × 2 reps = 8 rows
    rows, k = [], 0
    for g in ["a", "b"]:
        for d in ["D1", "D2"]:
            for _ in range(2):
                rows.append({"id": str(k + 1), "g": g, "d": d, "y": float(k)})
                k += 1
    return pd.DataFrame(rows)


def test_add_level_single_factor_appends_full_height_column():
    # One factor: "add a column" appends `depth` blank rows for the new level,
    # depth = the current tallest group so the new column is full-height.
    store = session.SessionStore()
    df = _df(4)
    df["g"] = ["a", "a", "b", "b"]        # depth 2 per level
    t = store.get(store.create(SCHEMA, df))
    info = t.add_level("g", "c")
    assert info == {"added": 2, "combos": 1, "depth": 2}
    assert t.version == 1
    win = t.window(0, 99)
    added = [r for r in win if r["g"] == "c"]
    assert len(added) == 2
    assert all(r["y"] is None for r in added)     # blank values
    assert len({r["id"] for r in win}) == 6       # fresh, unique ids
    assert t.schema["columns"][0]["levels"] == ["a", "b", "c"]   # level list grows


def test_add_level_lays_blanks_across_every_other_combination():
    # Two factors: adding a "d" level fills it in under *every* existing g, blank.
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA2, _df2()))
    info = t.add_level("d", "D3")
    assert info == {"added": 4, "combos": 2, "depth": 2}   # 2 groups × depth 2
    win = t.window(0, 99)
    new = [r for r in win if r["d"] == "D3"]
    assert sorted(r["g"] for r in new) == ["a", "a", "b", "b"]   # under both groups
    assert all(r["y"] is None for r in new)
    assert t.schema["columns"][1]["levels"] == ["D1", "D2", "D3"]


def test_add_level_rejects_existing_level_and_non_factor():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df(4)))
    with pytest.raises(KeyError):
        t.add_level("g", "a")             # "a" already a level → would pad, not add
    with pytest.raises(KeyError):
        t.add_level("y", "z")             # y is the value column, not a factor
    with pytest.raises(KeyError):
        t.add_level("nope", "z")
    assert t.version == 0                  # rejected: no partial mutation


def test_drop_column_removes_factor_and_syncs_schema():
    # Dropping a factor removes its column (and schema entry) but keeps every row.
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA2, _df2()))
    info = t.drop_column("d")
    assert info == {"dropped": "d"}
    assert t.version == 1
    assert t.n == 8                                    # no rows dropped
    win = t.window(0, 99)
    assert "d" not in win[0]                           # column gone from the frame
    assert [c["name"] for c in t.schema["columns"]] == ["g", "y"]   # and the schema
    assert win[0]["y"] == 0.0                          # values untouched


def test_drop_column_rejects_value_or_unknown_column():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA2, _df2()))
    with pytest.raises(KeyError):
        t.drop_column("y")               # the value column is not a factor
    with pytest.raises(KeyError):
        t.drop_column("nope")
    assert t.version == 0                  # rejected: no partial mutation


def test_set_schema_retypes_in_place_and_bumps_version():
    # The Data-tab role change: retype a column without touching the data. The
    # bumped version invalidates result caches keyed on it.
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df()))
    retyped = {**SCHEMA, "columns": [
        {**SCHEMA["columns"][0], "type": "identifier"},  # g: categorical -> identifier
        SCHEMA["columns"][1],
    ]}
    t.set_schema(retyped)
    assert t.version == 1
    assert t.schema["columns"][0]["type"] == "identifier"
    assert t.window(0, 2)[0]["g"] == "a"     # data untouched


def test_set_schema_rejects_columns_absent_from_frame():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df()))
    bad = {**SCHEMA, "columns": SCHEMA["columns"] + [
        {"name": "ghost", "type": "numeric", "label": "Ghost"}]}
    with pytest.raises(KeyError):
        t.set_schema(bad)
    assert t.version == 0                     # rejected: no partial mutation


def test_set_schema_fixes_test_inference_drift():
    # §1.3: statmodel.infer reads the SESSION schema, so a column retyped only on
    # the frontend leaves the engine inferring the wrong family. With g typed
    # `identifier`, a g-on-X + y-on-Y spec matches no branch (family "none");
    # after set_schema retypes g to categorical, it infers group_comparison.
    from iris_engine import statmodel
    ident_schema = {**SCHEMA, "columns": [
        {**SCHEMA["columns"][0], "type": "identifier"},
        SCHEMA["columns"][1]]}
    store = session.SessionStore()
    t = store.get(store.create(ident_schema, _df()))
    enc = {"x": {"column": "g"}, "y": {"column": "y"}}

    stale = statmodel.infer(enc, t.schema, None)
    assert stale["family"] == "none"          # the drift the review documented

    t.set_schema(SCHEMA)                       # g back to categorical
    fixed = statmodel.infer(enc, t.schema, None)
    assert fixed["family"] == "group_comparison"


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
