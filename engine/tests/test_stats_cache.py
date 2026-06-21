"""Stats memoization: a style-only spec edit must reuse the computed statistics
(so moving a legend re-renders in figure-build time, not a full stats rerun),
while any change to the data or the analysis must recompute. The stats functions
never read `spec["style"]`, so reusing across a style edit is exact, not an
approximation — these tests pin that contract."""
import copy

from fastapi.testclient import TestClient

from iris_engine import main, stats
from test_engine import make_table, make_spec

client = TestClient(main.app)


def _session_token():
    r = client.post("/table/create", json={"table": make_table()})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _count_group_comparison(monkeypatch):
    """Wrap stats.group_comparison with a call counter, returning the counter."""
    calls = {"n": 0}
    # The inferential stats now run inside iris_engine.render (which does
    # `from . import stats`), so patch the canonical stats module — render sees
    # the same module object.
    real = stats.group_comparison

    def counting(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(stats, "group_comparison", counting)
    main._STATS_CACHE.clear()
    main._PIPELINE_CACHE.clear()
    main._PIPELINE_CACHE_BYTES = 0
    return calls


def _count_materialize(monkeypatch):
    """Wrap hierarchy.materialize_levels with a call counter. This is the
    expensive per-render work (grouping the raw rows up each spine level); a
    style edit must skip it, not just the stats call."""
    calls = {"n": 0}
    real = main.hierarchy.materialize_levels

    def counting(*a, **k):
        calls["n"] += 1
        return real(*a, **k)

    monkeypatch.setattr(main.hierarchy, "materialize_levels", counting)
    main._STATS_CACHE.clear()
    main._PIPELINE_CACHE.clear()
    main._PIPELINE_CACHE_BYTES = 0
    return calls


def _analyze(token, spec):
    r = client.post("/analyze", json={"table_token": token, "spec": spec})
    assert r.status_code == 200, r.text
    return r.json()


def test_style_only_change_reuses_cached_stats(monkeypatch):
    calls = _count_group_comparison(monkeypatch)
    token = _session_token()
    spec = make_spec()

    first = _analyze(token, spec)
    moved = copy.deepcopy(spec)
    moved["style"]["overrides"]["offsets"] = {"legend": [40.0, 20.0]}
    second = _analyze(token, moved)

    # the test ran once, the legend move reused it
    assert calls["n"] == 1
    # ...and the reused stats are byte-for-byte the same result
    assert first["stats"] == second["stats"]


def test_mapping_change_recomputes(monkeypatch):
    calls = _count_group_comparison(monkeypatch)
    token = _session_token()
    spec = make_spec()

    _analyze(token, spec)
    swapped = copy.deepcopy(spec)
    swapped["stats"]["alpha"] = 0.01            # an analysis field, not presentation
    _analyze(token, swapped)

    assert calls["n"] == 2


def test_data_edit_busts_cache(monkeypatch):
    calls = _count_group_comparison(monkeypatch)
    token = _session_token()
    spec = make_spec()

    _analyze(token, spec)
    # an edit bumps the session version, which is part of the cache's data identity
    edit = client.post(f"/table/{token}/edit",
                       json={"row_id": "r1", "column": "response", "value": 99.0})
    assert edit.status_code == 200, edit.text
    _analyze(token, spec)

    assert calls["n"] == 2


def test_style_only_change_skips_materialization(monkeypatch):
    """The real cost of a render is materializing the hierarchy levels, not the
    stats call. A style-only edit must reuse the whole pipeline and re-run only
    build_figure — so materialize_levels is called once across the two renders."""
    calls = _count_materialize(monkeypatch)
    token = _session_token()
    spec = make_spec()

    first = _analyze(token, spec)
    moved = copy.deepcopy(spec)
    moved["style"]["overrides"]["offsets"] = {"legend": [40.0, 20.0]}
    second = _analyze(token, moved)

    assert calls["n"] == 1
    # the pipeline (and so its stats) is reused exactly; build_figure still re-runs
    # with the new style, so the figure itself is free to differ
    assert first["stats"] == second["stats"]


def test_analysis_change_rematerializes(monkeypatch):
    calls = _count_materialize(monkeypatch)
    token = _session_token()
    spec = make_spec()

    _analyze(token, spec)
    swapped = copy.deepcopy(spec)
    swapped["stats"]["alpha"] = 0.01            # an analysis field, not presentation
    _analyze(token, swapped)

    assert calls["n"] == 2


def test_cache_disabled_without_data_identity(monkeypatch):
    """An inline table with no token has no stable identity, so every call
    recomputes — never silently serving another table's stats."""
    calls = _count_group_comparison(monkeypatch)
    spec = make_spec()
    table = make_table()

    for _ in range(2):
        r = client.post("/analyze", json={"table": table, "spec": spec})
        assert r.status_code == 200, r.text

    assert calls["n"] == 2
