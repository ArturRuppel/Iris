"""Tier-1 validation suite. Run: pytest engine/tests -q"""
import base64
import re

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from iris_engine import compiler, document, stats
from iris_engine.main import app

client = TestClient(app)

A = [72.1, 68.4, 75.3, 80.2, 69.9, 77.5, 74.0, 71.2, 66.8, 79.1,
     73.3, 70.6, 76.2, 68.0, 72.9, 75.8, 71.7, 69.3, 78.4, 74.6]
B = [61.2, 58.7, 65.1, 55.9, 63.4, 60.8, 57.2, 64.0, 59.5, 62.3,
     56.8, 66.2, 61.9, 58.1, 63.7, 60.0, 57.9, 65.5, 62.6, 59.3]


def make_table():
    rows = []
    for i, v in enumerate(A, 1):
        rows.append({"id": f"r{i}", "subject": f"S{i:02d}", "treatment": "control",
                     "dose": 1.0, "response": v})
    for i, v in enumerate(B, 21):
        rows.append({"id": f"r{i}", "subject": f"S{i:02d}", "treatment": "drug_a",
                     "dose": 1.0, "response": v})
    return {"schema": document.SAMPLE_SCHEMA, "rows": rows}


def make_spec(**stats_extra):
    return {
        "spec_version": "1.0", "id": "an_test", "title": "test",
        "data": {"filter": []},
        "mappings": {"x": {"column": "treatment"}, "y": {"column": "response"},
                     "color": {"column": "treatment"}, "pair_by": None,
                     "facet": None},
        "layers": [{"mark": "dot", "options": {"jitter": 0.18}},
                   {"mark": "summary", "stat": {"center": "mean", "error": "ci95"}}],
        "stats": {"family": "group_comparison", "test": "welch_t",
                  "chosen_by": "recommendation_accepted",
                  "alternatives_offered": ["mann_whitney"],
                  "assumption_checks": [{"check": "shapiro_wilk", "per": "group"}],
                  "alpha": 0.05, "report": ["effect_size", "ci", "n_per_group"],
                  **stats_extra},
        "annotations": {"significance_brackets": "auto", "show_n": True},
        "style": {"preset": "demo_default", "overrides": {}},
        "engine_snapshot": {},
    }


def test_stats_match_scipy_ground_truth():
    df = pd.DataFrame(make_table()["rows"])
    res = stats.group_comparison(df, "treatment", "response",
                                 ["control", "drug_a"])
    r = res["result"]
    assert r["test"] == "welch_t"
    assert r["t"] == pytest.approx(11.11510, abs=1e-4)
    assert r["df"] == pytest.approx(36.148, abs=1e-2)
    assert r["p"] == pytest.approx(3.2436e-13, rel=1e-3)
    assert r["effect"]["value"] == pytest.approx(3.44507, abs=1e-4)
    sw = res["checks"][0]
    assert sw["W"] == pytest.approx(0.97732, abs=1e-4)
    assert sw["p"] == pytest.approx(0.89509, abs=1e-4)


def test_mann_whitney_override():
    df = pd.DataFrame(make_table()["rows"])
    res = stats.group_comparison(df, "treatment", "response",
                                 ["control", "drug_a"], override="mann_whitney")
    # the pin takes effect; chosen_by stays neutral (no deviation marker)
    assert res["result"]["test"] == "mann_whitney"
    assert res["chosen_by"] == "recommendation_accepted"
    assert res["result"]["U"] == pytest.approx(400, abs=0.5)
    assert res["result"]["p"] == pytest.approx(6.7956e-08, rel=1e-2)


def test_small_group_recommends_rank_based():
    rows = make_table()["rows"][:10] + make_table()["rows"][20:]
    df = pd.DataFrame(rows)
    res = stats.group_comparison(df, "treatment", "response",
                                 ["control", "drug_a"])
    assert res["recommendation"]["test"] == "mann_whitney"
    assert "< 12" in res["recommendation"]["reason"]  # small-n rule fired


def test_rank_floor_blocks_mann_whitney_at_three_per_group():
    """item R: two independent groups of 3 give a Mann–Whitney floor of
    2/C(6,3) = 0.10 > 0.05 — the rank test can never reject, so the guard
    recommends Welch's t instead and names the floor."""
    df = pd.DataFrame({"g": ["A"] * 3 + ["B"] * 3,
                       "y": [1.0, 1.2, 0.9, 5.0, 5.1, 4.8]})
    res = stats.group_comparison(df, "g", "y", ["A", "B"])
    assert res["recommendation"]["test"] == "welch_t"          # NOT mann_whitney
    assert res["decision"]["assumption"]["recommended"] == "parametric"
    assert "Mann–Whitney U" in res["decision"]["assumption"]["reason"]
    assert "0.100" in res["decision"]["assumption"]["reason"]


def test_rank_floor_survives_large_non_normal_groups():
    """Regression: C(n1+n2, n1) is an arbitrary-precision int that overflows when
    converted to float for the 2/c floor — large non-normal groups crashed the
    Mann–Whitney guard with OverflowError. The floor underflows to 0 (far below
    any alpha), so the rank test stands and analyze must not 500."""
    rng = np.random.default_rng(0)
    n = 600
    df = pd.DataFrame({
        "g": ["A"] * n + ["B"] * n,
        "y": np.concatenate([rng.exponential(1.0, n), rng.exponential(1.0, n)])})
    res = stats.group_comparison(df, "g", "y", ["A", "B"])   # must not raise
    assert res["recommendation"]["test"] == "mann_whitney"   # floor never fires


def test_analyze_endpoint_svg_draws_marks_without_point_groups():
    # Item I: dots draw as plain vector marks; the payload carries no point_groups
    # and the SVG has no per-point gid/click structure (just <use> glyphs).
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_spec()})
    assert r.status_code == 200
    body = r.json()
    svg = body["figure"]["svg"]
    assert "point_groups" not in body["figure"]
    assert 'id="pts-' not in svg               # no per-point group tags
    assert "<use" in svg                       # marks still drawn as vector glyphs
    # The two-group comparison draws its significance bracket on the figure
    # (re-introduced with the multi-comparison work); this fixture is significant.
    # svg.fonttype=none: the label is a real <text> node, not an outlined path.
    assert re.search(r"<text[^>]*>\*\*\*</text>", svg)


def test_schema_patch_endpoint_refixes_session_test_inference():
    # §1.3 end-to-end: /analyze reads the SESSION schema, so retyping a grouping
    # column on the frontend alone leaves the engine inferring the wrong test.
    # POST /table/{id}/schema retypes the session in place; the next /analyze on
    # the same token then infers the corrected family.
    table = make_table()
    # retype the grouping column to bool: bool×numeric matches no inference branch,
    # so the engine can't build a model — the user-visible face of the drift.
    ident_schema = {**document.SAMPLE_SCHEMA, "columns": [
        {**c, "type": "bool"} if c["name"] == "treatment" else c
        for c in document.SAMPLE_SCHEMA["columns"]]}
    table["schema"] = ident_schema

    created = client.post("/table/create", json={"table": table})
    tid = created.json()["id"]
    v0 = created.json()["version"]

    # With treatment typed `identifier`, x-vs-y matches no inference branch: the
    # engine can't build a model and 422s — the user-visible face of the drift.
    stale = client.post("/analyze", json={"table_token": tid, "spec": make_spec()})
    assert stale.status_code == 422

    cat_schema = {**document.SAMPLE_SCHEMA}   # treatment back to categorical
    patched = client.post(f"/table/{tid}/schema", json={"table_schema": cat_schema})
    assert patched.status_code == 200
    assert patched.json()["version"] == v0 + 1

    fixed = client.post("/analyze", json={"table_token": tid, "spec": make_spec()})
    assert fixed.status_code == 200
    assert fixed.json()["stat_model"]["family"] == "group_comparison"


def test_schema_patch_endpoint_rejects_unknown_column():
    created = client.post("/table/create", json={"table": make_table()})
    tid = created.json()["id"]
    bad = {**document.SAMPLE_SCHEMA, "columns": [
        *document.SAMPLE_SCHEMA["columns"],
        {"name": "ghost", "type": "numeric", "label": "Ghost"}]}
    r = client.post(f"/table/{tid}/schema", json={"table_schema": bad})
    assert r.status_code == 422


def test_schema_patch_endpoint_warns_on_non_keying_identifiers():
    # the contract the frontend depends on: marking `treatment` (2 levels, 20 rows
    # each) the only identifier leaves rows sharing an identity — but that is a
    # legitimate coarse-over-replicates spine, so the toggle COMMITS (200) and the
    # response carries a non-blocking `identifier_warning` the Data tab surfaces.
    created = client.post("/table/create", json={"table": make_table()})
    tid = created.json()["id"]
    # treatment alone as the only identifier: subject demoted, so 2 levels × 20
    # rows collide. (Building on SAMPLE_SCHEMA where subject would otherwise key it.)
    def _fix(c):
        if c["name"] == "treatment":
            return {**c, "identifier": True}
        return {k: v for k, v in c.items() if k != "identifier"}
    bad = {**document.SAMPLE_SCHEMA,
           "columns": [_fix(c) for c in document.SAMPLE_SCHEMA["columns"]]}
    r = client.post(f"/table/{tid}/schema", json={"table_schema": bad})
    assert r.status_code == 200
    warning = r.json()["identifier_warning"]
    assert warning and "don't uniquely key" in warning
    # committed: the session now carries the new role (version bumped)
    assert r.json()["version"] == 1


def _modern_spec_size_on_categorical(font_pt):
    # A modern-shape spec that maps `size` to a categorical column — an
    # UNRENDERABLE pairing the guards drop before render. Only `style.font_pt`
    # varies, so two of these share a (style-independent) pipeline-cache key.
    return {
        "spec_version": "2.0", "id": "an_test", "title": "t",
        "encodings": {
            "x": {"column": "treatment"}, "y": {"column": "response"},
            "color": None, "size": {"column": "treatment"}, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": [], "fn": {}},
        "layers": [{"geom": "dot", "level": ""}],
        "stats": {"family": "group_comparison", "test": "welch_t", "alpha": 0.05},
        "style": {"preset": "demo_default", "overrides": {"font_pt": font_pt}},
        "engine_snapshot": {},
    }


def test_pipeline_cache_hit_still_drops_unrenderable_channels():
    # §1.4: guards.evaluate mutates the spec (drops an unrenderable channel) before
    # the compiler runs. On a cache MISS that happens inside render(); the pipeline
    # cache stores the OUTPUT, not the mutated spec, and its key ignores style. So a
    # style-only re-render (same key, hit path) used to reach the compiler with the
    # channel still mapped -> 500 (to_numpy(float) on categorical strings). Both the
    # miss and the hit must return the same 200 + channel_unrenderable warning.
    created = client.post("/table/create", json={"table": make_table()})
    tid = created.json()["id"]

    miss = client.post("/analyze", json={
        "table_token": tid, "spec": _modern_spec_size_on_categorical(10)})
    assert miss.status_code == 200
    miss_codes = [i["code"] for i in miss.json()["issues"]]
    assert "channel_unrenderable" in miss_codes

    hit = client.post("/analyze", json={          # identical but for font size
        "table_token": tid, "spec": _modern_spec_size_on_categorical(14)})
    assert hit.status_code == 200                  # was 500 before the fix
    assert [i["code"] for i in hit.json()["issues"]] == miss_codes


def _ungrouped_location_spec(describe_only=False):
    # The frontend's "descriptive mapping (only Y) + a reference" case: a one-sample
    # location test with NO grouping column (x=None).
    stats = {"family": "location", "reference": 70.0, "alpha": 0.05}
    if describe_only:
        stats["describe_only"] = True
    return {
        "spec_version": "2.0", "id": "an_loc", "title": "loc",
        "encodings": {"x": None, "y": {"column": "response"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": [], "fn": {}},
        "layers": [{"geom": "dot", "level": ""},
                   {"geom": "summary", "level": ""}],
        "stats": stats,
        "style": {"preset": "demo_default", "overrides": {"show_n": True}},
        "engine_snapshot": {},
    }


def test_ungrouped_location_renders():
    # §1.5: the ungrouped one-sample location test used to 422 in render (cat_col
    # None -> "grouping column None not found") and, once past that, KeyError in the
    # compiler. It must now render as a single "all" lane with a real test result.
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": _ungrouped_location_spec()})
    assert r.status_code == 200                       # was 422 before the fix
    s = r.json()["stats"]
    assert s["family"] == "location"
    assert s["levels"] == ["all"]                     # single synthetic lane
    per = {g["level"]: g for g in s["per_group"]}
    assert "all" in per and per["all"]["test"] in ("one_sample_t", "wilcoxon_signed")
    assert "svg" in r.json()["figure"]                # figure drew without crashing


def test_ungrouped_location_describe_only_renders():
    # The describe-only sub-path routes through describe_groups, which also assumed
    # a grouping column (df[[None, y]] -> KeyError). It must summarize the lone
    # "all" group instead.
    r = client.post("/analyze", json={
        "table": make_table(), "spec": _ungrouped_location_spec(describe_only=True)})
    assert r.status_code == 200
    s = r.json()["stats"]
    assert s["chosen_by"] == "describe_only"
    assert [g["group"] for g in s["summaries"]] == ["all"]
    assert s["summaries"][0]["n"] == 40               # all rows, ungrouped


def test_filter_on_flag_drops_rows():
    # The replacement for the removed exclusion mechanism: flag rows in a bool
    # column and drop them with a normal filter reduce step.
    table = make_table()
    table["schema"] = {**document.SAMPLE_SCHEMA, "columns": [
        *document.SAMPLE_SCHEMA["columns"],
        {"name": "flag", "type": "bool", "label": "Flag"}]}
    for i, row in enumerate(table["rows"]):
        row["flag"] = i < 2                       # flag the first two control rows
    spec = make_spec()
    spec["reduce"] = {"steps": [{"kind": "filter", "conditions": [
        {"column": "flag", "op": "==", "value": False}]}]}
    r = client.post("/analyze", json={"table": table, "spec": spec})
    s = r.json()["stats"]
    assert s["summaries"][0]["n"] == 18           # two control rows dropped


def test_analyze_endpoint_accepts_a_dag_reduce():
    # spec 2.2: reduce is a DAG (nodes+output) instead of the linear {steps}
    # fold — render.py must still apply the pipeline, not silently drop it.
    # The DAG's source node carries NO inline rows: render.py binds it from the
    # request's own already-resolved `table` (the main table still rides on
    # `table`/`table_token`, never inlined into the DAG itself).
    table = make_table()
    table["schema"] = {**document.SAMPLE_SCHEMA, "columns": [
        *document.SAMPLE_SCHEMA["columns"],
        {"name": "flag", "type": "bool", "label": "Flag"}]}
    for i, row in enumerate(table["rows"]):
        row["flag"] = i < 2                       # flag the first two control rows
    spec = make_spec()
    spec["reduce"] = {"nodes": [
        {"id": "src", "kind": "source"},
        {"id": "n0", "kind": "step", "inputs": ["src"],
         "step": {"kind": "filter", "conditions": [
             {"column": "flag", "op": "==", "value": False}]}}],
        "output": "n0"}
    r = client.post("/analyze", json={"table": table, "spec": spec})
    s = r.json()["stats"]
    assert s["summaries"][0]["n"] == 18           # two control rows dropped


def test_analyze_renders_a_node_pinned_layer_end_to_end():
    # spec 2.3 Stage 1 through the real endpoint: a modern (2.2) spec with a DAG
    # reduce (src -> filter) and a dot layer PINNED to the raw source overlays the
    # pre-filter frame under a filtered box. Guards that normalize preserves
    # `nodeId` (a modern spec passes layers through) and that render.py's traced
    # eval feeds the pinned layer its own node frame.
    table = make_table()
    table["schema"] = {**document.SAMPLE_SCHEMA, "columns": [
        *document.SAMPLE_SCHEMA["columns"],
        {"name": "flag", "type": "bool", "label": "Flag"}]}
    for i, row in enumerate(table["rows"]):
        row["flag"] = i < 4                       # flag drops some control rows on filter
    spec = {
        "spec_version": "2.2", "id": "an_test", "title": "t",
        "encodings": {"x": {"column": "treatment"}, "y": {"column": "response"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": [], "fn": {}},
        "layers": [
            {"id": "raw", "geom": "dot", "level": "", "nodeId": "src"},  # raw pre-filter dots
            {"id": "box", "geom": "box", "level": ""}],                  # filtered output box
        "reduce": {"nodes": [
            {"id": "src", "kind": "source"},
            {"id": "n0", "kind": "step", "inputs": ["src"],
             "step": {"kind": "filter", "conditions": [
                 {"column": "flag", "op": "==", "value": False}]}}],
            "output": "n0"},
        "stats": {"family": "group_comparison", "test": "welch_t", "alpha": 0.05},
        "style": {"preset": "demo_default", "overrides": {}},
    }
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "<svg" in body["figure"]["svg"]
    assert "<use" in body["figure"]["svg"]        # the dot layer drew glyphs
    # the test is bound to the OUTPUT lineage (filtered), not the raw overlay:
    # control lost 4 rows -> 16, drug_a keeps 20.
    ns = {s["group"]: s["n"] for s in body["stats"]["summaries"]}
    assert ns.get("control") == 16 and ns.get("drug_a") == 20


def test_pdf_export_has_exact_mm_size():
    spec = make_spec()
    spec["style"]["overrides"] = {"width_mm": 89, "height_mm": 70}
    r = client.post("/export", json={"table": make_table(), "spec": spec,
                                     "format": "pdf"})
    pdf = base64.b64decode(r.json()["data_base64"])
    m = re.search(rb"/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", pdf)
    assert m, "no MediaBox in PDF"
    w_pt, h_pt = float(m.group(1)), float(m.group(2))
    assert w_pt * 25.4 / 72 == pytest.approx(89, abs=0.5)
    assert h_pt * 25.4 / 72 == pytest.approx(70, abs=0.5)


def test_document_roundtrip():
    table = make_table()
    tables = {"table_1": {"schema": table["schema"],
                          "hierarchy": {"spine": [], "fn": {}},
                          "rows": table["rows"]}}
    saved = document.save_document(tables, [make_spec()], {"exclusions": []},
                                   {"engine": "test"})
    doc = document.load_document(saved)
    t = doc["tables"]["table_1"]
    assert t["schema"] == table["schema"]
    assert len(t["rows"]) == 40
    assert t["rows"][0]["response"] == pytest.approx(72.1)
    assert doc["analyses"][0]["id"] == "an_test"


def test_document_roundtrip_keeps_reduce_clause():
    # the document layer is spec-agnostic; guard that a reduce pipeline survives
    # save/load so a saved plottable recomputes identically on reopen
    table = make_table()
    spec = make_spec()
    spec["spec_version"] = "1.3"
    spec["reduce"] = {"steps": [
        {"kind": "filter",
         "conditions": [{"column": "treatment", "op": "==", "value": "control"}]},
        {"kind": "drop", "columns": ["subject", "dose"]}]}
    tables = {"table_1": {"schema": table["schema"],
                          "hierarchy": {"spine": [], "fn": {}},
                          "rows": table["rows"]}}
    saved = document.save_document(tables, [spec, make_spec()],
                                   {"exclusions": []}, {"engine": "test"})
    doc = document.load_document(saved)
    assert len(doc["analyses"]) == 2
    steps = doc["analyses"][0]["reduce"]["steps"]
    assert steps[0]["conditions"][0]["value"] == "control"
    assert steps[1]["columns"] == ["subject", "dose"]


def test_health_reports_versions():
    r = client.get("/health")
    snap = r.json()["engine_snapshot"]
    assert all(k in snap for k in ("scipy", "pingouin", "matplotlib"))


# ---------------- tier-2: plot marks ----------------

def _spec_with_layers(*marks):
    spec = make_spec()
    spec["layers"] = [{"mark": m, "options": {}} for m in marks]
    return spec


@pytest.mark.parametrize("marks", [("box", "dot"), ("violin", "dot"), ("bar",)])
def test_marks_render(marks):
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": _spec_with_layers(*marks)})
    assert r.status_code == 200
    body = r.json()
    assert "<svg" in body["figure"]["svg"]
    assert "point_groups" not in body["figure"]   # item I: no per-point contract
    if "dot" in marks:  # dots still draw as vector glyphs under the overlays
        assert "<use" in body["figure"]["svg"]


# ---------------- tier-2: correlation family ----------------

def make_scatter_table():
    rng = np.random.default_rng(7)
    x = rng.uniform(0, 50, 40)
    y = 80 - 0.4 * x + rng.normal(0, 5, 40)
    schema = {"schema_version": "1.0", "columns": [
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "dose", "type": "numeric", "label": "Dose (µM)"},
        {"name": "response", "type": "numeric", "label": "Response (%)"},
    ]}
    rows = [{"id": f"r{i+1}", "subject": f"S{i+1:02d}", "dose": round(float(xv), 2),
             "response": round(float(yv), 2)}
            for i, (xv, yv) in enumerate(zip(x, y))]
    return {"schema": schema, "rows": rows}


def make_scatter_spec(**stats_extra):
    spec = make_spec()
    spec["mappings"] = {"x": {"column": "dose"}, "y": {"column": "response"},
                        "color": None, "pair_by": None, "facet": None}
    spec["layers"] = [{"mark": "scatter", "options": {}},
                      {"mark": "regression", "options": {}}]
    spec["stats"] = {**spec["stats"], "family": "correlation",
                     "test": "pearson", **stats_extra}
    return spec


def test_correlation_matches_scipy_ground_truth():
    from scipy import stats as sps
    table = make_scatter_table()
    df = pd.DataFrame(table["rows"])
    res = stats.correlation(df, "dose", "response")
    expected = sps.pearsonr(df["dose"], df["response"])
    assert res["result"]["test"] == "pearson"
    assert res["result"]["r"] == pytest.approx(expected.statistic, abs=1e-6)
    assert res["result"]["p"] == pytest.approx(expected.pvalue, rel=1e-6)
    # spearman override agrees with scipy too, and the pin takes effect
    res_sp = stats.correlation(df, "dose", "response", override="spearman")
    exp_sp = sps.spearmanr(df["dose"], df["response"])
    assert res_sp["result"]["test"] == "spearman"
    assert res_sp["chosen_by"] == "recommendation_accepted"
    assert res_sp["result"]["r"] == pytest.approx(exp_sp.statistic, abs=1e-6)
    assert res_sp["result"]["p"] == pytest.approx(exp_sp.pvalue, rel=1e-6)


def test_scatter_endpoint_draws_marks_without_point_groups():
    from scipy import stats as sps
    table = make_scatter_table()
    r = client.post("/analyze", json={"table": table,
                                      "spec": make_scatter_spec()})
    assert r.status_code == 200
    body = r.json()
    assert "point_groups" not in body["figure"]       # item I
    assert "<use" in body["figure"]["svg"]            # marks drawn as vector glyphs
    df = pd.DataFrame(table["rows"])
    expected = sps.linregress(df["dose"], df["response"])
    assert body["stats"]["regression"]["slope"] == pytest.approx(
        expected.slope, abs=1e-6)


# ---------------- tier-2: descriptive family (histogram) ----------------

def test_histogram_and_descriptives():
    table = make_scatter_table()
    spec = make_scatter_spec()
    # legacy histogram+density marks still normalize and render (back-compat)
    spec["layers"] = [{"mark": "histogram", "options": {}},
                      {"mark": "density", "options": {}}]
    spec["stats"]["family"] = "descriptive"
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200
    body = r.json()
    vals = np.array([row["response"] for row in table["rows"]])
    res = body["stats"]["result"]
    assert res["n"] == 40
    assert res["mean"] == pytest.approx(vals.mean(), abs=1e-6)
    assert res["median"] == pytest.approx(np.median(vals), abs=1e-6)
    assert res["sd"] == pytest.approx(vals.std(ddof=1), abs=1e-6)
    assert "point_groups" not in body["figure"]
    assert "<svg" in body["figure"]["svg"]


def _distribution_fig(params):
    """Render a single descriptive `distribution` layer and hand back the figure
    so a test can inspect the artists each render mode draws. Annotations off so
    the median axvline doesn't pollute the Line2D count."""
    import matplotlib
    matplotlib.use("Agg")
    from iris_engine import specnorm
    table = make_scatter_table()
    df = pd.DataFrame(table["rows"])
    spec = make_scatter_spec()
    spec["stats"]["family"] = "descriptive"
    spec["mappings"] = {"x": None, "y": {"column": "response"},
                        "color": None, "pair_by": None, "facet": None}
    spec["layers"] = [{"mark": "distribution", "options": {}}]
    overrides = spec.setdefault("style", {}).setdefault("overrides", {})
    overrides["show_annotation"] = False
    overrides.setdefault("geoms", {})["distribution"] = dict(params)
    spec = specnorm.normalize(spec)
    st = stats.descriptive(df, "response", alpha=0.05)
    fig = compiler.build_histogram_figure(df, table["schema"], spec, st)
    return fig.axes[0]


def test_distribution_fixed_bins_control_bar_count():
    assert len(_distribution_fig({"bin_method": "fixed", "hist_bins": 5}).patches) == 5
    assert len(_distribution_fig({"bin_method": "fixed", "hist_bins": 23}).patches) == 23


def test_distribution_adaptive_bin_methods_render():
    # each numpy strategy yields *some* bars and they need not match each other
    counts = {m: len(_distribution_fig({"bin_method": m}).patches)
              for m in ("auto", "fd", "scott", "sturges", "sqrt")}
    assert all(c > 0 for c in counts.values())


def test_distribution_render_modes_draw_the_right_artists():
    bars = _distribution_fig({"dist_render": "bars"})
    assert bars.patches and not bars.lines          # rectangles, no curve

    line = _distribution_fig({"dist_render": "line"})
    assert line.lines and not line.patches          # a polyline, no bars

    points = _distribution_fig({"dist_render": "points"})
    assert points.lines and not points.patches

    smooth = _distribution_fig({"dist_render": "smooth"})
    assert smooth.lines and not smooth.patches       # KDE only — no bars (the fix)


def test_distribution_overlay_smooth_adds_a_curve_over_bars():
    ax = _distribution_fig({"dist_render": "bars", "overlay_smooth": True})
    assert ax.patches      # bars present
    assert ax.lines        # plus a KDE overlay


def test_distribution_potential_draws_a_curve_not_bars():
    ax = _distribution_fig({"dist_render": "potential"})
    assert ax.lines and not ax.patches       # a U(x) polyline, no histogram bars
    assert ax.get_ylabel() == "−ln P"


def _potential_xy(vals, bin_method="fixed", hist_bins=10):
    """The (x, U) the potential render draws over *vals*, plus the ground-truth
    −ln P computed straight from the same histogram — for an exact comparison."""
    import matplotlib
    matplotlib.use("Agg")
    ax = _draw_into_potential(vals, {"bin_method": bin_method, "hist_bins": hist_bins})
    line = ax.lines[0]
    counts, _ = np.histogram(vals, bins=hist_bins)
    occ = counts > 0
    expected_u = -np.log(counts[occ] / counts.sum())
    return line.get_ydata(), expected_u, occ


def _draw_into_potential(vals, params):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    geom_overrides = {**params, "dist_render": "potential"}
    style = compiler.resolve_style(
        {"style": {"overrides": {"geoms": {"distribution": geom_overrides}}}})
    fig, ax = plt.subplots()
    compiler._draw_distribution(ax, np.asarray(vals, dtype=float), style)
    return ax


def test_geom_style_resolves_in_three_tiers():
    # Item K: a geom may appear more than once; style resolves
    # registry default → geoms.<geom> → layers.<id>, most specific winning.
    style = compiler.resolve_style({"style": {"overrides": {
        "geoms": {"dot": {"marker_size": 22.0, "alpha": 0.55}},
        "layers": {"ly_raw": {"marker_size": 8.0},
                   "ly_agg": {"marker_size": 60.0, "alpha": 1.0}},
    }}})
    # no layer id → the shared geom tier
    base = compiler.resolve_geom_style(style, "dot")
    assert base["marker_size"] == 22.0 and base["alpha"] == 0.55
    # raw layer overrides only marker_size; alpha falls back to the geom tier
    raw = compiler.resolve_geom_style(style, "dot", "ly_raw")
    assert raw["marker_size"] == 8.0 and raw["alpha"] == 0.55
    # aggregate layer overrides both
    agg = compiler.resolve_geom_style(style, "dot", "ly_agg")
    assert agg["marker_size"] == 60.0 and agg["alpha"] == 1.0
    # an unknown layer id falls back entirely to the geom tier
    other = compiler.resolve_geom_style(style, "dot", "ly_missing")
    assert other["marker_size"] == 22.0 and other["alpha"] == 0.55


def test_repeated_dot_layers_draw_at_different_sizes():
    # The superplot overlay: faint small raw dots + bold big aggregate dots,
    # two `dot` layers distinguished only by their per-layer style.
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.collections import PathCollection
    schema = {"schema_version": "1.0", "columns": [
        {"name": "grp", "type": "categorical", "label": "G", "levels": ["a", "b"]},
        {"name": "y", "type": "numeric", "label": "Y"},
        {"name": "rep", "type": "identifier", "label": "Rep"}]}
    df = pd.DataFrame({
        "id": [f"r{i}" for i in range(8)],
        "grp": ["a", "a", "a", "a", "b", "b", "b", "b"],
        "rep": ["1", "1", "2", "2", "1", "1", "2", "2"],
        "y": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]})
    spec = {
        "encodings": {k: None for k in ("x", "y", "color", "size", "shape")},
        "layers": [
            {"id": "ly_raw", "geom": "dot", "level": ""},
            {"id": "ly_agg", "geom": "dot", "level": "rep"}],
        "hierarchy": {"spine": ["rep"], "fn": {"rep": "mean"}},
        "style": {"overrides": {"layers": {
            "ly_raw": {"marker_size": 6.0, "layout": "jitter"},
            "ly_agg": {"marker_size": 80.0, "layout": "jitter"}}}}}
    spec["encodings"]["x"] = {"column": "grp"}
    spec["encodings"]["y"] = {"column": "y"}
    fig = compiler.build_comparison_figure(df, schema, spec, {"result": {}})
    sizes = set()
    for ax in fig.axes:
        for c in ax.collections:
            if isinstance(c, PathCollection):
                for s in c.get_sizes():
                    sizes.add(round(float(s), 1))
    assert 6.0 in sizes and 80.0 in sizes  # both layers drew, at their own sizes
    compiler.close(fig)


def test_layer_pinned_to_a_node_draws_that_nodes_frame():
    # spec 2.3 Stage 1: a layer pinned to a non-output reduce-DAG node draws THAT
    # node's frame (the raw pre-filter rows), not the output. The reported
    # raw-vs-filtered overlay: the pinned dot must draw the source's 8 rows, while
    # the same layer left unpinned draws only the filtered output's 4.
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.collections import PathCollection
    schema = {"schema_version": "1.0", "columns": [
        {"name": "grp", "type": "categorical", "label": "G", "levels": ["a", "b"]},
        {"name": "y", "type": "numeric", "label": "Y"}]}
    src_df = pd.DataFrame([{"id": f"{g}{i}", "grp": g, "y": float(i)}
                           for g in ("a", "b") for i in range(4)])   # 8 rows, both grps
    out_df = src_df.iloc[[0, 1, 4, 5]].reset_index(drop=True)         # "filtered": 4 rows, both grps
    node_frames = {"src": (src_df, schema), "out": (out_df, schema)}
    base = {
        "encodings": {"x": {"column": "grp"}, "y": {"column": "y"},
                      "color": None, "size": None, "shape": None},
        "reduce": {"output": "out"},
        "style": {"overrides": {}}}

    def n_points(layers):
        spec = {**base, "layers": layers}
        # df/schema passed in is the OUTPUT frame (4 rows); a pinned layer must
        # ignore it in favour of its node frame.
        fig = compiler.build_comparison_figure(
            out_df, schema, spec, {"result": {}}, None, node_frames)
        n = sum(len(c.get_offsets()) for ax in fig.axes for c in ax.collections
                if isinstance(c, PathCollection))
        compiler.close(fig)
        return n

    pinned = n_points([{"id": "raw", "geom": "dot", "level": "", "nodeId": "src"}])
    plain = n_points([{"id": "raw", "geom": "dot", "level": ""}])
    assert pinned == 8   # drew the pinned source frame, not the 4-row output
    assert plain == 4    # unpinned still draws the output


def test_repeated_dot_layers_honor_per_layer_layout():
    # Item K, layout knob: two `dot` layers must pick swarm vs jitter
    # independently. Swarm packs marks toward the lane centre (a narrow spread);
    # jitter scatters them across the lane width (a wide spread). So the layer
    # set to jitter must occupy a visibly wider categorical band than the one set
    # to swarm — and flipping which layer is which must flip the spreads.
    import matplotlib
    matplotlib.use("Agg")
    import numpy as np
    from matplotlib.collections import PathCollection
    schema = {"schema_version": "1.0", "columns": [
        {"name": "grp", "type": "categorical", "label": "G", "levels": ["a", "b"]},
        {"name": "y", "type": "numeric", "label": "Y"}]}
    rng = np.random.default_rng(0)
    df = pd.DataFrame([
        {"id": f"{g}{i}", "grp": g, "y": float(rng.normal(5, 1))}
        for g in ("a", "b") for i in range(20)])

    def spreads(layout_small, layout_big):
        spec = {
            "encodings": {k: None for k in ("x", "y", "color", "size", "shape")},
            "layers": [{"id": "small", "geom": "dot", "level": ""},
                       {"id": "big", "geom": "dot", "level": ""}],
            "hierarchy": {"spine": [], "fn": {}},
            "style": {"overrides": {"layers": {
                "small": {"marker_size": 6.0, "layout": layout_small},
                "big": {"marker_size": 60.0, "layout": layout_big}}}}}
        spec["encodings"]["x"] = {"column": "grp"}
        spec["encodings"]["y"] = {"column": "y"}
        fig = compiler.build_comparison_figure(df, schema, spec, {"result": {}})
        compiler._finalize_deferred(fig)
        by_size: dict[float, float] = {}
        for c in fig.axes[0].collections:
            if not isinstance(c, PathCollection):
                continue
            offs = np.asarray(c.get_offsets())
            if not len(offs):
                continue
            sz = round(float(c.get_sizes()[0]), 0)
            xr = float(offs[:, 0].max() - offs[:, 0].min())
            by_size[sz] = max(by_size.get(sz, 0.0), xr)
        compiler.close(fig)
        return by_size[6.0], by_size[60.0]   # (small spread, big spread)

    small_sw, big_ji = spreads("swarm", "jitter")
    assert big_ji > small_sw * 2     # the jittered (big) layer spreads much wider
    small_ji, big_sw = spreads("jitter", "swarm")
    assert small_ji > big_sw * 2     # flipped: now the small layer is the wide one


def test_potential_is_neg_log_density():
    rng = np.random.default_rng(0)
    vals = rng.normal(size=400)
    drawn_u, expected_u, _ = _potential_xy(vals)
    assert np.allclose(np.sort(drawn_u), np.sort(expected_u))


def test_potential_drops_empty_bins():
    # a gap in the middle leaves empty bins, which must not become −ln(0)=inf
    vals = np.concatenate([np.zeros(50), np.full(50, 10.0)])
    ax = _draw_into_potential(vals, {"bin_method": "fixed", "hist_bins": 10})
    u = ax.lines[0].get_ydata()
    assert len(u) < 10                  # fewer drawn points than bins (gap dropped)
    assert np.all(np.isfinite(u))       # no infinities from empty bins


def test_sinh_bin_edges_concentrate_near_zero():
    edges = compiler._sinh_bin_edges(-10.0, 10.0, 20, sharpness=3.0)
    assert len(edges) == 21
    assert edges[0] == -10.0 and edges[-1] == 10.0    # real range preserved
    widths = np.diff(edges)
    mid = len(widths) // 2
    assert widths.argmin() in (mid - 1, mid)          # narrowest bin straddles 0
    assert widths[mid] < widths[0] and widths[mid] < widths[-1]   # widen outward


def test_sinh_bin_edges_fall_back_to_uniform():
    uni = compiler._sinh_bin_edges(-5.0, 5.0, 10, sharpness=0.0)
    assert np.allclose(np.diff(uni), 1.0)             # sharpness 0 → uniform
    deg = compiler._sinh_bin_edges(3.0, 3.0, 8)       # degenerate range, no crash
    assert len(deg) == 9 and np.all(np.isfinite(deg))


def test_distribution_sinh_renders_requested_bin_count():
    assert len(_distribution_fig({"bin_method": "sinh", "hist_bins": 16}).patches) == 16


def test_potential_with_sinh_bins_composes():
    rng = np.random.default_rng(2)
    vals = np.concatenate([rng.normal(-2, 0.5, 200), rng.normal(2, 0.5, 200)])
    u = _draw_into_potential(vals, {"bin_method": "sinh", "hist_bins": 21}).lines[0].get_ydata()
    assert len(u) > 0 and np.all(np.isfinite(u))


# ---------------- tier-2: import ----------------

def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


SEMICOLON_CSV = (
    "Subject;Treatment;Dose (µM);Response\n"
    "S01;control;1,5;82,3\n"
    "S02;control;2,0;79,1\n"
    "S03;drug_a;1,5;NA\n"
    "S04;drug_a;2,5;65,8\n"
).encode()


def test_import_preview_sniffs_european_csv():
    r = client.post("/import/preview", json={
        "filename": "data.csv", "data_base64": _b64(SEMICOLON_CSV)})
    assert r.status_code == 200
    body = r.json()
    assert body["options"]["delimiter"] == ";"
    assert body["options"]["decimal"] == ","
    cols = {c["name"]: c for c in body["columns"]}
    assert cols["treatment"]["type"] == "categorical"
    assert cols["treatment"]["levels"] == ["control", "drug_a"]
    assert cols["dose_µm"]["type"] == "numeric"  # \W+ is Unicode-aware: µ stays
    assert cols["response"]["n_missing"] == 1  # the NA token
    assert body["rows"][0]["dose_µm"] == pytest.approx(1.5)
    assert body["rows"][0]["response"] == pytest.approx(82.3)


def test_decimal_sniff_is_content_aware():
    from iris_engine import importer

    # a comma is never the decimal when it's the field separator
    assert importer._sniff("a,b\n1.5,2.5\n")["decimal"] == "."
    # US thousands + decimals in a tab file: '.' wins, comma is NOT the decimal
    assert importer._sniff("x\ty\n1,234.56\t10\n999.5\t20\n")["decimal"] == "."
    # a stray comma in a free-text cell must not flip clean US numbers
    assert importer._sniff("note\tvalue\nok\t0.5\ncells 3,4 apart\t1.5\n")["decimal"] == "."
    # genuine European (comma decimals, one trailing digit) is still detected
    assert importer._sniff("Subject;Dose\nS01;1,5\nS02;2,0\n")["decimal"] == ","


def test_decimal_sniff_free_text_comma_does_not_corrupt_numbers():
    # regression: one incidental '3,4' in a text column used to sniff decimal=','
    # and silently multiply every numeric value by 10 (0.5 -> 5.0).
    csv = b"note\tvalue\nok\t0.5\ncells 3,4 um apart\t1.5\nok\t2.5\n"
    body = client.post("/import/preview", json={
        "filename": "data.tsv", "data_base64": _b64(csv)}).json()
    assert body["options"]["decimal"] == "."
    value = {c["name"]: c for c in body["columns"]}["value"]
    assert value["type"] == "numeric" and value["n_unparsed"] == 0
    assert [r["value"] for r in body["rows"]] == pytest.approx([0.5, 1.5, 2.5])


def test_import_headers_first_then_full(monkeypatch):
    # headers pass: columns + a provisional type guess, no full-data stats/rows
    from iris_engine import importer
    monkeypatch.setattr(importer, "HEADER_SAMPLE", 2)  # parse only 2 rows
    up = client.post("/import/upload", json={
        "filename": "data.csv", "data_base64": _b64(SEMICOLON_CSV)}).json()
    heads = client.post("/import/headers", json={
        "filename": "data.csv", "file_token": up["token"]}).json()
    assert heads["provisional"] is True
    assert heads["n_rows"] is None and heads["rows"] == []
    hcols = {c["name"]: c for c in heads["columns"]}
    assert hcols["treatment"]["type"] == "categorical"   # inferred from sample
    assert "n_distinct" not in hcols["treatment"]        # stats deferred

    # full pass over the same token fills in the deferred stats + rows
    full = client.post("/import/preview", json={
        "filename": "data.csv", "file_token": up["token"]}).json()
    assert full.get("provisional") is None
    fcols = {c["name"]: c for c in full["columns"]}
    assert fcols["response"]["n_missing"] == 1
    assert isinstance(full["n_rows"], int) and full["n_rows"] >= len(full["rows"])
    # the headers guess and the full inference agree on type
    assert {n: c["type"] for n, c in hcols.items()} == \
           {n: c["type"] for n, c in fcols.items()}


def test_import_commit_feeds_analyze():
    rng = np.random.default_rng(3)
    lines = ["subject,group,value"]
    for i in range(40):
        grp = "treated" if i >= 20 else "control"
        shift = 8 if grp == "treated" else 0
        lines.append(f"P{i:02d},{grp},{50 + shift + rng.normal(0, 4):.2f}")
    csv_data = "\n".join(lines).encode()

    prev = client.post("/import/preview", json={
        "filename": "study.csv", "data_base64": _b64(csv_data)}).json()
    cols = {c["name"]: c for c in prev["columns"]}
    # subject (P00..P39, all distinct) is a categorical *identifier* — a key, not
    # a free classifier; the role is orthogonal to the value type.
    assert cols["subject"]["type"] == "categorical"
    assert cols["subject"]["identifier"] is True
    assert cols["group"]["type"] == "categorical"
    assert cols["group"].get("identifier") in (False, None)
    assert cols["value"]["type"] == "numeric"

    commit = client.post("/import/commit", json={
        "filename": "study.csv", "data_base64": _b64(csv_data),
        "options": prev["options"], "columns": prev["columns"]})
    assert commit.status_code == 200
    table = commit.json()
    # /import/commit returns the compact columnar form (+ a cache token)
    assert table["n"] == 40
    assert len(table["columns"]["value"]) == 40
    assert "token" in table

    spec = make_spec()
    spec["mappings"]["x"] = {"column": "group"}
    spec["mappings"]["y"] = {"column": "value"}
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200
    assert r.json()["stats"]["result"]["p"] < 0.001


def test_import_bool_type_plots_as_fraction():
    # a true/false column is the fourth data type (a stochastic-event flag); it
    # imports as `bool` and, on analyze, collapses to numeric 1/0 so a group
    # summary reads as the fraction of trues.
    csv_data = (b"group,divided\n"
                b"control,no\ncontrol,no\ncontrol,no\ncontrol,yes\n"
                b"treated,yes\ntreated,yes\ntreated,yes\ntreated,no\n")
    prev = client.post("/import/preview", json={
        "filename": "events.csv", "data_base64": _b64(csv_data)}).json()
    cols = {c["name"]: c for c in prev["columns"]}
    assert cols["divided"]["type"] == "bool"
    assert cols["group"]["type"] == "categorical"

    commit = client.post("/import/commit", json={
        "filename": "events.csv", "data_base64": _b64(csv_data),
        "options": prev["options"], "columns": prev["columns"]}).json()
    # bool values are emitted as JSON booleans, not strings
    assert commit["columns"]["divided"][:2] == [False, False]
    assert commit["columns"]["divided"][3] is True

    spec = make_spec()
    spec["mappings"]["x"] = {"column": "group"}
    spec["mappings"]["y"] = {"column": "divided"}
    spec["mappings"]["color"] = {"column": "group"}
    r = client.post("/analyze", json={"table": commit, "spec": spec})
    assert r.status_code == 200
    means = {s["group"]: s["mean"] for s in r.json()["stats"]["summaries"]}
    assert means["control"] == pytest.approx(0.25)  # 1 of 4 divided
    assert means["treated"] == pytest.approx(0.75)  # 3 of 4 divided


def test_import_zero_one_stays_numeric_but_suggests_bool():
    # a 0/1 column is NOT auto-detected as bool (a genuine numeric 0/1 measure
    # must not be hijacked), but it is flagged so the wizard can suggest bool.
    csv_data = (b"dose,divided\n"
                b"1.5,0\n2.0,1\n2.5,1\n3.0,0\n3.5,1\n4.0,0\n")
    prev = client.post("/import/preview", json={
        "filename": "events.csv", "data_base64": _b64(csv_data)}).json()
    cols = {c["name"]: c for c in prev["columns"]}
    assert cols["divided"]["type"] == "numeric"          # default, not hijacked
    assert cols["divided"].get("suggest_bool") is True     # but bool is suggested
    assert cols["dose"]["type"] == "numeric"
    assert "suggest_bool" not in cols["dose"]              # 1.5..4.0 isn't 0/1


def test_import_retype_zero_one_to_bool_converts_on_commit():
    # confirming the suggestion (retype to bool) converts 0/1 -> true/false.
    csv_data = b"divided\n0\n1\n1\n0\n"
    prev = client.post("/import/preview", json={
        "filename": "e.csv", "data_base64": _b64(csv_data)}).json()
    columns = prev["columns"]
    for c in columns:
        if c["name"] == "divided":
            c["type"] = "bool"                            # user accepts the suggestion
    commit = client.post("/import/commit", json={
        "filename": "e.csv", "data_base64": _b64(csv_data),
        "options": prev["options"], "columns": columns}).json()
    assert commit["columns"]["divided"] == [False, True, True, False]


def test_import_reserved_and_duplicate_names():
    csv_data = b"id,excluded,value,value\n1,yes,3.2,4.1\n2,no,3.5,4.4\n3,no,3.1,4.2\n"
    body = client.post("/import/preview", json={
        "filename": "t.csv", "data_base64": _b64(csv_data)}).json()
    names = [c["name"] for c in body["columns"]]
    assert "id" not in names              # the bookkeeping id is reserved
    assert "excluded" in names            # no longer reserved — a normal column now
    assert len(set(names)) == len(names)  # deduplicated
    assert body["rows"][0]["id"] == "r1"  # bookkeeping id untouched


def test_import_preserves_dotted_family_names():
    # the '.' family separator must survive sanitization so the column picker
    # can group cell_shape.area / cell_shape.perimeter under "cell_shape"
    csv_data = (b"cell_shape.area,cell_shape.perimeter,Nucleus Count\n"
                b"1.2,3.4,5\n2.1,4.3,6\n")
    body = client.post("/import/preview", json={
        "filename": "t.csv", "data_base64": _b64(csv_data)}).json()
    names = [c["name"] for c in body["columns"]]
    assert names == ["cell_shape.area", "cell_shape.perimeter", "nucleus_count"]


# ---------------- tier-2: style overrides + draggable labels ----------------

def test_style_overrides_reach_the_svg():
    spec = make_spec()
    spec["style"]["overrides"] = {
        "palette": ["#ff0066", "#00ff66"],
        "marker_size": 60, "marker_alpha": 0.9,
        "axis_linewidth": 1.8, "grid_x": False, "grid_y": False,
        "frame": "closed",
        "title": "My title", "x_label": "Custom X", "y_label": "Custom Y",
        "offsets": {"lbl-y": [4, -6]},
        "tick_direction": "in", "minor_ticks": True, "y_tick_spacing": 5,
        "x_tick_rotation": 30, "error_type": "sem", "capsize": 5,
        "show_n": False,
    }
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    svg = r.json()["figure"]["svg"]
    assert "#ff0066" in svg and "#00ff66" in svg  # custom group colors
    assert "n = 20" not in svg  # show_n off
    # draggable labels are gid-tagged groups carrying the custom text; with
    # svg.fonttype=none the text is a real <text> node inside the group.
    for gid, text in [("lbl-title", "My title"), ("lbl-x", "Custom X"),
                      ("lbl-y", "Custom Y")]:
        m = re.search(rf'<g id="{gid}">.*?<text[^>]*>(.*?)</text>', svg, re.S)
        assert m and m.group(1) == text


def test_box_anatomy_and_scales():
    # notched boxes without dot overlay, custom outliers, log y, no bracket
    spec = _spec_with_layers("box")
    spec["style"]["overrides"] = {
        "notch": True, "outlier_marker": "x", "outlier_size": 5,
        "mark_width": 0.6, "y_scale": "log", "show_significance": False,
        "y_min": 40, "y_max": 120,
    }
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    svg = r.json()["figure"]["svg"]
    assert "***" not in svg  # bracket suppressed
    # outlier_marker "none" also kills the fliers entirely
    spec["style"]["overrides"] = {"outlier_marker": "none"}
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200


def test_style_default_spec_unchanged():
    # empty overrides keep the tier-1 contract intact (regression guard)
    r = client.post("/analyze", json={"table": make_table(), "spec": make_spec()})
    body = r.json()
    assert "point_groups" not in body["figure"]   # item I: no per-point contract
    assert "<use" in body["figure"]["svg"]        # dot marks still drawn
    assert 'id="lbl-y"' in body["figure"]["svg"]  # y label always draggable


# ---------------- tier-2: wide → long reshape ----------------

WIDE_CSV = (
    "Control;10 µM;50 µM\n"
    "5,1;7,2;9,9\n"
    "4,8;6,9;10,4\n"
    "5,5;7,8;9,1\n"
    "5,0;;9,6\n"          # ragged: one condition has fewer values
).encode()


def test_import_reshape_wide_to_long():
    prev = client.post("/import/preview", json={
        "filename": "wide.csv", "data_base64": _b64(WIDE_CSV)}).json()
    names = [c["name"] for c in prev["columns"]]
    assert names == ["control", "10_µm", "50_µm"]

    opts = {**prev["options"],
            "reshape": {"value_columns": names,
                        "var_name": "Dose", "value_name": "Response"}}
    prev2 = client.post("/import/preview", json={
        "filename": "wide.csv", "data_base64": _b64(WIDE_CSV),
        "options": opts}).json()
    cols = {c["name"]: c for c in prev2["columns"]}
    assert set(cols) == {"dose", "response"}
    assert cols["dose"]["type"] == "categorical"
    assert cols["dose"]["levels"] == ["Control", "10 µM", "50 µM"]
    assert cols["response"]["type"] == "numeric"
    assert prev2["n_rows"] == 11  # 12 cells minus the one empty

    table = client.post("/import/commit", json={
        "filename": "wide.csv", "data_base64": _b64(WIDE_CSV),
        "options": opts, "columns": prev2["columns"]}).json()
    assert table["n"] == 11
    by_level = {}
    for dose, resp in zip(table["columns"]["dose"], table["columns"]["response"]):
        by_level.setdefault(dose, []).append(resp)
    assert by_level["Control"] == pytest.approx([5.1, 4.8, 5.5, 5.0])
    assert by_level["10 µM"] == pytest.approx([7.2, 6.9, 7.8])


# a nested-header sheet (the data-entry grid): Control/Treatment groups, each
# over Day 1/Day 2 columns. Synthetic headers c0..c3 carry the hierarchy in
# `groups`, one path per leaf; the melt splits the path into a column per level.
NESTED_CSV = (
    "c0;c1;c2;c3\n"
    "1;4;6;9\n"
    "2;5;7;10\n"
    "3;;8;11\n"          # ragged: Control/Day 2 has fewer values
).encode()


def test_import_reshape_nested_to_tidy():
    opts = {"delimiter": ";", "reshape": {
        "value_columns": ["c0", "c1", "c2", "c3"],
        "value_name": "Value",
        "level_names": ["group", "subgroup"],
        "groups": {"c0": ["Control", "Day 1"], "c1": ["Control", "Day 2"],
                   "c2": ["Treatment", "Day 1"], "c3": ["Treatment", "Day 2"]},
    }}
    prev = client.post("/import/preview", json={
        "filename": "nested.csv", "data_base64": _b64(NESTED_CSV),
        "options": opts}).json()
    cols = {c["name"]: c for c in prev["columns"]}
    assert set(cols) == {"group", "subgroup", "value"}
    assert cols["group"]["type"] == "categorical"
    assert cols["group"]["levels"] == ["Control", "Treatment"]
    assert cols["subgroup"]["levels"] == ["Day 1", "Day 2"]
    assert cols["value"]["type"] == "numeric"
    assert prev["n_rows"] == 11  # 12 cells minus the one empty

    table = client.post("/import/commit", json={
        "filename": "nested.csv", "data_base64": _b64(NESTED_CSV),
        "options": opts, "columns": prev["columns"]}).json()
    assert table["n"] == 11
    cells = list(zip(table["columns"]["group"], table["columns"]["subgroup"],
                     table["columns"]["value"]))
    assert ("Control", "Day 1", 1.0) in cells
    assert ("Treatment", "Day 2", 11.0) in cells
    # the ragged blank (Control/Day 2, 3rd row) was dropped, not carried as null
    assert sum(1 for g, s, _ in cells if g == "Control" and s == "Day 2") == 2


def test_import_excel():
    import io as _io
    df = pd.DataFrame({"Group": ["a", "a", "b", "b"],
                       "Score": [1.1, 2.2, 3.3, 4.4]})
    buf = _io.BytesIO()
    df.to_excel(buf, index=False, sheet_name="Data")
    body = client.post("/import/preview", json={
        "filename": "wb.xlsx", "data_base64": _b64(buf.getvalue())}).json()
    assert body["options"]["sheet"] == "Data"
    cols = {c["name"]: c for c in body["columns"]}
    assert cols["group"]["type"] == "categorical"
    assert cols["score"]["type"] == "numeric"
    assert body["rows"][2]["score"] == pytest.approx(3.3)


# ---------------- reduce clause ----------------

def _spec_with_steps(steps, **mapping):
    spec = make_spec()
    spec["reduce"] = {"steps": steps}
    spec["spec_version"] = "1.3"
    spec["mappings"].update(mapping)
    return spec


def test_analyze_filter_changes_n():
    spec = _spec_with_steps(
        [{"kind": "filter",
          "conditions": [{"column": "treatment", "op": "==", "value": "control"}]}])
    spec["stats"]["family"] = "descriptive"
    spec["layers"] = [{"mark": "histogram", "options": {}}]
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    assert r.json()["stats"]["result"]["n"] == 20  # only control rows


def test_analyze_reduce_error_is_422():
    spec = _spec_with_steps(
        [{"kind": "filter",
          "conditions": [{"column": "ghost", "op": "==", "value": 1}]}])
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 422


def test_analyze_without_reduce_key_still_works():
    spec = make_spec()
    assert "reduce" not in spec
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    assert "figure" in r.json() and "reduced_table" not in r.json()


# ---------------- /reduce preview endpoint ----------------

def test_reduce_preview_caps_rows_and_reports_total():
    from iris_engine import main as main_mod
    # build a table bigger than the cap
    rows = [{"id": f"r{i}", "subject": f"S{i}", "treatment": "control",
             "dose": 1.0, "response": float(i)}
            for i in range(main_mod.PREVIEW_CAP + 50)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    r = client.post("/reduce", json={"table": table, "steps": []})
    assert r.status_code == 200
    body = r.json()
    assert body["n_total"] == main_mod.PREVIEW_CAP + 50
    assert len(body["preview"]["rows"]) == main_mod.PREVIEW_CAP


def test_reduce_preview_trace_per_step():
    table = make_table()  # 40 rows, 20 per treatment
    steps = [
        {"kind": "drop", "columns": ["dose"]},
        {"kind": "filter",
         "conditions": [{"column": "treatment", "op": "==", "value": "control"}]},
        {"kind": "drop", "columns": ["subject"]},
    ]
    r = client.post("/reduce", json={"table": table, "steps": steps})
    assert r.status_code == 200
    body = r.json()
    assert [t["n_rows_out"] for t in body["trace"]] == [40, 20, 20]
    assert body["n_total"] == 20
    cols = [c["name"] for c in body["preview"]["schema"]["columns"]]
    assert "treatment" in cols and "response" in cols
    assert "subject" not in cols and "dose" not in cols


def test_reduce_preview_at_step_returns_intermediate_table():
    table = make_table()  # 40 rows, 20 per treatment
    steps = [
        {"kind": "filter",
         "conditions": [{"column": "treatment", "op": "==", "value": "control"}]},
        {"kind": "drop", "columns": ["dose"]},
    ]

    def cols(body):
        return [c["name"] for c in body["preview"]["schema"]["columns"]]

    # at_step = -1 → raw table, before any step
    r0 = client.post("/reduce", json={"table": table, "steps": steps, "at_step": -1})
    assert r0.status_code == 200 and r0.json()["n_total"] == 40
    assert "dose" in cols(r0.json())

    # at_step = 0 → after the filter only
    r1 = client.post("/reduce", json={"table": table, "steps": steps, "at_step": 0})
    assert r1.json()["n_total"] == 20
    assert "dose" in cols(r1.json())

    # at_step = 1 → after the drop
    r2 = client.post("/reduce", json={"table": table, "steps": steps, "at_step": 1})
    assert r2.json()["n_total"] == 20
    assert "dose" not in cols(r2.json())


def test_reduce_preview_summary_counts():
    table = make_table()
    r = client.post("/reduce", json={"table": table, "steps": []})
    assert r.status_code == 200
    summary = {s["column"]: s for s in r.json()["summary"]}
    assert summary["treatment"]["n_distinct"] == 2
    assert summary["response"]["n"] == 40


def test_reduce_preview_error_is_422():
    r = client.post("/reduce", json={
        "table": make_table(),
        "steps": [{"kind": "drop", "columns": ["ghost"]}]})
    assert r.status_code == 422


def test_reduce_preview_at_step_below_minus_one_is_422():
    r = client.post("/reduce", json={
        "table": make_table(),
        "steps": [{"kind": "filter",
                   "conditions": [{"column": "treatment", "op": "==", "value": "control"}]}],
        "at_step": -2})
    assert r.status_code == 422


# ---------------- table cache (token transport) ----------------

def test_table_token_roundtrip_analyze_and_reduce():
    table = make_table()
    tok = client.post("/table", json={"table": table}).json()["token"]
    assert tok
    # analyze by token only — no inline table
    spec = make_spec()
    r = client.post("/analyze", json={"table_token": tok, "spec": spec})
    assert r.status_code == 200 and "figure" in r.json()
    # reduce by token only
    r2 = client.post("/reduce", json={"table_token": tok, "steps": []})
    assert r2.status_code == 200 and r2.json()["n_total"] == 40


def test_unknown_table_token_is_409():
    r = client.post("/analyze", json={"table_token": "deadbeef", "spec": make_spec()})
    assert r.status_code == 409


# ---------------- phase 1: layered renderer honors order + params ----------

def test_layer_params_override_style_jitter():
    # a 2.0 spec whose dot layer sets its own jitter must reach the SVG
    # regardless of the global style jitter
    spec = make_spec()
    spec["spec_version"] = "2.0"
    spec["encodings"] = {"x": {"column": "treatment"},
                         "y": {"column": "response"},
                         "color": {"column": "treatment"},
                         "size": None, "shape": None}
    spec.pop("mappings", None)
    spec["layers"] = [{"geom": "dot", "params": {}}]
    spec.setdefault("style", {}).setdefault("overrides", {})["geoms"] = {
        "dot": {"jitter": 0.0}}
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    # the dot layer renders its marks (as plain vector glyphs, item I)
    body = r.json()
    assert "<use" in body["figure"]["svg"]
    assert "point_groups" not in body["figure"]


def test_blocking_point_cap_returns_422():
    # a dot layer over POINT_CAP raw points must block, not freeze
    from iris_engine import geoms
    rows = [{"id": f"r{i}", "subject": f"S{i}",
             "treatment": "control" if i % 2 else "drug_a",
             "dose": 1.0, "response": float(i)}
            for i in range(geoms.POINT_CAP * 2 + 10)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    r = client.post("/analyze", json={"table": table, "spec": make_spec()})
    assert r.status_code == 422
    assert "too many" in r.json()["detail"].lower()


def test_analyze_returns_stat_model_and_issues():
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_spec()})
    assert r.status_code == 200
    body = r.json()
    assert body["stat_model"]["family"] == "group_comparison"
    assert "design" in body["stat_model"]
    assert body["issues"] == []  # default sample is small + clean


def test_health_serves_the_geom_registry():
    body = client.get("/health").json()
    assert "registry" in body
    assert "dot" in body["registry"]["geoms"]
    assert body["registry"]["point_cap"] == 10000


# ---------------- phase 1: describe-only (run no test) ----------------------

def test_describe_only_comparison_renders_without_a_test():
    # ticking "describe only" must render the figure but run no inferential
    # test: no p, no significance bracket, methods text says so
    spec = make_spec()
    spec["stats"] = {**spec["stats"], "describe_only": True}
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    body = r.json()
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert body["stat_model"]["test"] is None
    assert "p" not in body["stats"]["result"]
    assert "no statistical test was run" in body["stats"]["methods_text"]
    assert "***" not in body["figure"]["svg"]  # bracket suppressed
    # per-group summaries are still present (the figure needs the means)
    assert [s["group"] for s in body["stats"]["summaries"]] == ["control", "drug_a"]


def test_describe_only_correlation_has_no_regression_or_r():
    spec = make_scatter_spec()
    spec["stats"] = {**spec["stats"], "describe_only": True}
    r = client.post("/analyze", json={"table": make_scatter_table(), "spec": spec})
    assert r.status_code == 200
    body = r.json()
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert "regression" not in body["stats"]
    assert body["stats"]["result"].get("r") is None


def test_session_create_window_and_ops():
    rows = [{"id": str(i + 1), "treatment": "control",
             "dose": float(i), "response": float(i)} for i in range(40)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    cid = client.post("/table/create", json={"table": table}).json()
    assert cid["n"] == 40 and cid["version"] == 0 and "id" in cid
    tid = cid["id"]

    win = client.post(f"/table/{tid}/rows", json={"start": 0, "end": 10}).json()
    assert len(win["rows"]) == 10 and win["rows"][0]["id"] == "1"

    ed = client.post(f"/table/{tid}/edit",
                     json={"row_id": "2", "column": "dose", "value": 7.0}).json()
    assert ed["version"] == 1

    dist = client.post(f"/table/{tid}/distinct", json={"column": "treatment"}).json()
    assert dist["values"] == ["control"]


def test_session_missing_id_is_409():
    r = client.post("/table/deadbeef/rows", json={"start": 0, "end": 5})
    assert r.status_code == 409


def test_analyze_by_session_id():
    rows = [{"id": str(i + 1),
             "treatment": "control" if i < 20 else "drug_a",
             "dose": float(i % 10), "response": float(i)} for i in range(40)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    tid = client.post("/table/create", json={"table": table}).json()["id"]
    spec = make_spec()                       # existing helper
    r = client.post("/analyze", json={"table_token": tid, "spec": spec})
    assert r.status_code == 200
    assert "figure" in r.json()


def test_save_by_session_id_roundtrips():
    rows = [{"id": str(i + 1), "treatment": "control",
             "dose": float(i), "response": float(i)} for i in range(5)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    tid = client.post("/table/create", json={"table": table}).json()["id"]
    saved = client.post("/document/save", json={
        "tables": [{"name": "table_1", "table_id": tid,
                    "hierarchy": {"spine": [], "fn": {}}}],
        "analyses": [make_spec()], "provenance": {}}).json()
    assert saved["filename"] == "document.iris"


def test_descriptive_small_n_methods_text_matches_recommendation():
    """Below the normality-rule floor the recommendation says median (IQR) even
    when Shapiro passes — the methods text must say the same, not mean (SD)."""
    df = pd.DataFrame({"response": [4.8, 5.1, 4.9, 5.3, 5.0, 4.7, 5.2, 4.95]})
    st = stats.descriptive(df, "response", alpha=0.05)
    assert st["checks"][0]["ok"] and st["checks"][0]["p"] > 0.05   # Shapiro passes
    assert "median (IQR) to be safe" in st["recommendation"]["reason"]
    assert "median" in st["methods_text"] and "mean" not in st["methods_text"]
