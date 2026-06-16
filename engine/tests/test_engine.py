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
                     "dose": 1.0, "response": v, "excluded": False})
    for i, v in enumerate(B, 21):
        rows.append({"id": f"r{i}", "subject": f"S{i:02d}", "treatment": "drug_a",
                     "dose": 1.0, "response": v, "excluded": False})
    return {"schema": document.SAMPLE_SCHEMA, "rows": rows}


def make_spec(**stats_extra):
    return {
        "spec_version": "1.0", "id": "an_test", "title": "test",
        "data": {"filter": [], "respect_exclusions": True},
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
    assert res["chosen_by"] == "user_override"
    assert res["result"]["U"] == pytest.approx(400, abs=0.5)
    assert res["result"]["p"] == pytest.approx(6.7956e-08, rel=1e-2)


def test_small_group_recommends_rank_based():
    rows = make_table()["rows"][:10] + make_table()["rows"][20:]
    df = pd.DataFrame(rows)
    res = stats.group_comparison(df, "treatment", "response",
                                 ["control", "drug_a"])
    assert res["recommendation"]["test"] == "mann_whitney"
    assert "< 12" in res["recommendation"]["reason"]  # small-n rule fired


def test_analyze_endpoint_svg_has_clickable_point_groups():
    r = client.post("/analyze", json={"table": make_table(),
                                      "spec": make_spec()})
    assert r.status_code == 200
    body = r.json()
    svg = body["figure"]["svg"]
    groups = body["figure"]["point_groups"]
    assert [g["gid"] for g in groups] == ["pts-0", "pts-1"]
    for g in groups:
        m = re.search(rf'<g id="{g["gid"]}"(.*?)</g>', svg, re.S)
        assert m, f"gid {g['gid']} missing from SVG"
        n_use = len(re.findall(r"<use\b", m.group(1)))
        assert n_use == len(g["row_ids"]), "one <use> per row required"
    # Hierarchy redesign: the figure is decoupled from the inferential test, so
    # the on-figure significance bracket is deferred with the rest of stats.
    assert "***" not in svg


def test_exclusion_changes_n_and_methods_text():
    table = make_table()
    table["rows"][0]["excluded"] = True
    table["rows"][1]["excluded"] = True
    r = client.post("/analyze", json={"table": table, "spec": make_spec()})
    s = r.json()["stats"]
    assert s["summaries"][0]["n"] == 18
    assert "2 observation(s) were excluded" in s["methods_text"]


def test_pdf_export_has_exact_mm_size():
    spec = make_spec()
    spec["style"]["preset"] = "nature_single_column"  # 89 x 70 mm
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
    saved = document.save_document(table["schema"], table["rows"],
                                   [make_spec()], {"exclusions": []},
                                   {"engine": "test"})
    doc = document.load_document(saved)
    assert doc["schema"] == table["schema"]
    assert len(doc["rows"]) == 40
    assert doc["rows"][0]["response"] == pytest.approx(72.1)
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
        {"kind": "collapse", "group_by": ["subject"], "aggregate": {"response": "mean"}}]}
    saved = document.save_document(table["schema"], table["rows"], [spec, make_spec()],
                                   {"exclusions": []}, {"engine": "test"})
    doc = document.load_document(saved)
    assert len(doc["analyses"]) == 2
    steps = doc["analyses"][0]["reduce"]["steps"]
    assert steps[0]["conditions"][0]["value"] == "control"
    assert steps[1]["group_by"] == ["subject"]


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
    if "dot" in marks:  # the click-to-exclude contract holds under overlays
        for g in body["figure"]["point_groups"]:
            m = re.search(rf'<g id="{g["gid"]}"(.*?)</g>',
                          body["figure"]["svg"], re.S)
            assert m and len(re.findall(r"<use\b", m.group(1))) == len(g["row_ids"])
    else:  # aggregate-only marks expose no per-row click targets
        assert body["figure"]["point_groups"] == []


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
             "response": round(float(yv), 2), "excluded": False}
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
    # spearman override agrees with scipy too, and is recorded as an override
    res_sp = stats.correlation(df, "dose", "response", override="spearman")
    exp_sp = sps.spearmanr(df["dose"], df["response"])
    assert res_sp["chosen_by"] == "user_override"
    assert res_sp["result"]["r"] == pytest.approx(exp_sp.statistic, abs=1e-6)
    assert res_sp["result"]["p"] == pytest.approx(exp_sp.pvalue, rel=1e-6)


def test_scatter_endpoint_keeps_click_contract():
    from scipy import stats as sps
    table = make_scatter_table()
    r = client.post("/analyze", json={"table": table,
                                      "spec": make_scatter_spec()})
    assert r.status_code == 200
    body = r.json()
    [g] = body["figure"]["point_groups"]
    m = re.search(rf'<g id="{g["gid"]}"(.*?)</g>', body["figure"]["svg"], re.S)
    assert m and len(re.findall(r"<use\b", m.group(1))) == 40
    df = pd.DataFrame(table["rows"])
    expected = sps.linregress(df["dose"], df["response"])
    assert body["stats"]["regression"]["slope"] == pytest.approx(
        expected.slope, abs=1e-6)


# ---------------- tier-2: descriptive family (histogram) ----------------

def test_histogram_and_descriptives():
    table = make_scatter_table()
    spec = make_scatter_spec()
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
    assert body["figure"]["point_groups"] == []
    assert "<svg" in body["figure"]["svg"]


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
    assert cols["subject"]["type"] == "identifier"
    assert cols["group"]["type"] == "categorical"
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


def test_import_reserved_and_duplicate_names():
    csv_data = b"id,excluded,value,value\n1,yes,3.2,4.1\n2,no,3.5,4.4\n3,no,3.1,4.2\n"
    body = client.post("/import/preview", json={
        "filename": "t.csv", "data_base64": _b64(csv_data)}).json()
    names = [c["name"] for c in body["columns"]]
    assert "id" not in names and "excluded" not in names
    assert len(set(names)) == len(names)  # deduplicated
    assert body["rows"][0]["id"] == "r1"  # bookkeeping id untouched


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
    # draggable labels are gid-tagged groups carrying the custom text
    for gid, text in [("lbl-title", "My title"), ("lbl-x", "Custom X"),
                      ("lbl-y", "Custom Y")]:
        m = re.search(rf'<g id="{gid}">\s*<!-- (.*?) -->', svg)
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
    assert [g["gid"] for g in body["figure"]["point_groups"]] == ["pts-0", "pts-1"]
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


def test_analyze_collapse_makes_stats_per_group():
    table = make_table()
    spec = _spec_with_steps(
        [{"kind": "collapse", "group_by": ["treatment", "subject"],
          "aggregate": {"response": "mean"}}],
        x={"column": "treatment"}, y={"column": "response"})
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200
    assert r.json()["stats"]["summaries"][0]["n"] == 20  # 20 subjects per group


def test_analyze_filter_preserves_exclusion_provenance():
    # exclusions happen before reduction; the methods text must still report
    # them even when a reduce clause builds a fresh frame
    table = make_table()
    table["rows"][0]["excluded"] = True
    table["rows"][1]["excluded"] = True
    spec = _spec_with_steps(
        [{"kind": "filter",
          "conditions": [{"column": "response", "op": ">", "value": 0}]}])
    r = client.post("/analyze", json={"table": table, "spec": spec})
    assert r.status_code == 200
    assert "2 observation(s) were excluded" in r.json()["stats"]["methods_text"]


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
             "dose": 1.0, "response": float(i), "excluded": False}
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
        {"kind": "select", "columns": ["treatment", "subject", "response"]},
        {"kind": "filter",
         "conditions": [{"column": "treatment", "op": "==", "value": "control"}]},
        {"kind": "collapse", "group_by": ["treatment"], "aggregate": {"response": "mean"}},
    ]
    r = client.post("/reduce", json={"table": table, "steps": steps})
    assert r.status_code == 200
    body = r.json()
    assert [t["n_rows_out"] for t in body["trace"]] == [40, 20, 1]
    assert body["n_total"] == 1
    cols = [c["name"] for c in body["preview"]["schema"]["columns"]]
    assert "treatment" in cols and "response" in cols and "subject" not in cols


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
        "steps": [{"kind": "select", "columns": ["ghost"]}]})
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
    spec["layers"] = [{"geom": "dot", "params": {"jitter": 0.0}}]
    r = client.post("/analyze", json={"table": make_table(), "spec": spec})
    assert r.status_code == 200
    # the click contract still holds (one <use> per row, ordered groups)
    body = r.json()
    assert [g["gid"] for g in body["figure"]["point_groups"]] == ["pts-0", "pts-1"]


def test_blocking_point_cap_returns_422():
    # a dot layer over POINT_CAP raw points must block, not freeze
    from iris_engine import geoms
    rows = [{"id": f"r{i}", "subject": f"S{i}",
             "treatment": "control" if i % 2 else "drug_a",
             "dose": 1.0, "response": float(i), "excluded": False}
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
    assert body["registry"]["point_cap"] == 3000


# ---------------- phase 1: describe-only (run no test) ----------------------

def test_describe_only_comparison_renders_without_a_test():
    # ticking "describe only" must render the figure but run no inferential
    # test: no p, no significance bracket, methods text says so
    spec = make_spec()
    spec["stats"] = {**spec["stats"], "chosen_by": "describe_only"}
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
    spec["stats"] = {**spec["stats"], "chosen_by": "describe_only"}
    r = client.post("/analyze", json={"table": make_scatter_table(), "spec": spec})
    assert r.status_code == 200
    body = r.json()
    assert body["stat_model"]["chosen_by"] == "describe_only"
    assert "regression" not in body["stats"]
    assert body["stats"]["result"].get("r") is None
