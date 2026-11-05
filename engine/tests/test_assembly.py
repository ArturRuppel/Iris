"""Multi-panel figure assembly (assembly.py): the document part, the layout
normalisation, the one-figure render, its endpoints, and the guarantee that a
single analysis renders byte for byte as it did before assemblies existed."""
import base64
import io
import json
import zipfile

import matplotlib
import pytest
from fastapi.testclient import TestClient

from iris_engine import assembly, autosave, compiler, document, render
from iris_engine.main import app

client = TestClient(app)

SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "g", "type": "categorical", "label": "Group", "levels": ["a", "b"]},
    {"name": "t", "type": "numeric", "label": "Time (h)"},
    {"name": "y", "type": "numeric", "label": "Response"},
    {"name": "z", "type": "numeric", "label": "Other response (long label)"}]}
ROWS = [{"id": str(i + 1), "g": "ab"[i % 2], "t": float(i // 2),
         "y": float((i * 7) % 11), "z": float((i * 37) % 1000) * 10}
        for i in range(40)]
TABLES = {"cells": {"schema": SCHEMA, "hierarchy": {"spine": [], "fn": {}}, "rows": ROWS}}


def _an(id, x, y, tag=None, geom="dot"):
    a = {"spec_version": "2.2", "id": id, "title": id, "table_id": "cells",
         "reduce": {"nodes": [{"id": "src", "kind": "source", "table_id": "cells"}],
                    "output": "src"},
         "encodings": {"x": {"column": x}, "y": {"column": y}, "color": None,
                       "size": None, "shape": None},
         "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
         "hierarchy": {"spine": [], "fn": {}},
         "layers": [{"geom": geom, "level": ""}],
         "stats": {"alpha": 0.05, "describe_only": True},
         "style": {"overrides": {"width_mm": 90, "height_mm": 50}},
         "engine_snapshot": {}}
    if tag is not None:
        a["tag"] = tag
    return a


def _two():
    return [_an("first", "t", "y", "A"), _an("second", "t", "z", "B")]


@pytest.fixture(autouse=True)
def _fixed_svg_salt(monkeypatch):
    # matplotlib salts SVG clip-path ids randomly and stamps the date; fix both
    # so two renders compare
    monkeypatch.setenv("SOURCE_DATE_EPOCH", "0")
    with matplotlib.rc_context({"svg.hashsalt": "iris-test"}):
        yield


# ------------------------------------------------------------ normalisation

def test_normalize_fills_defaults_and_is_idempotent():
    n = assembly.normalize({})
    assert n == assembly.normalize(n)
    assert n["direction"] == "rows" and n["sizes"] is None and n["share_x"] is False
    assert n["letters"] == {"show": True, "size_pt": 10.0, "weight": "bold",
                            "position": "outside"}
    assert assembly.normalize(None) is None


def test_normalize_drops_bad_values():
    n = assembly.normalize({"direction": "diagonal", "gap_mm": -3, "panels": ["a", "a", 3, "b"],
                            "sizes": {"a": 2, "b": "x"}, "letters": {"size_pt": 999},
                            "width_mm": "wide", "junk": 1})
    assert n["direction"] == "rows" and n["gap_mm"] == 3.0
    assert n["panels"] == ["a", "b"] and n["sizes"] == {"a": 2.0}
    assert n["letters"]["size_pt"] == 10.0 and n["width_mm"] is None
    assert "junk" not in n


def test_panel_order_follows_the_list_then_document_order():
    ans = [_an("u", "t", "y"), _an("p", "t", "y", "B"), _an("q", "t", "y", "A"),
           _an("r", "t", "y", " ")]
    assert [a["id"] for a in assembly.panel_order({"panels": ["q"]}, ans)] == ["q", "p"]
    assert [a["id"] for a in assembly.panel_order(None, ans)] == ["p", "q"]


# ------------------------------------------------------------ document part

def test_document_round_trip_with_assembly():
    fig = {"panels": ["second", "first"], "direction": "columns", "share_x": False,
           "gap_mm": 5, "width_mm": 180}
    data = document.save_document(TABLES, _two(), {}, {}, figure=fig)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert "figure.json" in z.namelist()
    doc = document.load_document(data)
    assert doc["figure"] == assembly.normalize(fig)
    assert [a["tag"] for a in doc["analyses"]] == ["A", "B"]


def test_document_without_assembly_is_unchanged():
    data = document.save_document(TABLES, [_an("only", "t", "y")], {}, {})
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert "figure.json" not in z.namelist()
    assert document.load_document(data)["figure"] is None


def test_autosave_sidecar_carries_the_assembly(tmp_path):
    iris = document.save_document(TABLES, _two(), {}, {})
    autosave.write_snapshot(tmp_path, analyses=_two(), table_meta=[], provenance={},
                            fingerprint="f", iris_bytes=lambda: iris,
                            figure={"share_x": True})
    assert autosave.load_snapshot(tmp_path)["figure"]["share_x"] is True


# ------------------------------------------------------------ rendering

def test_render_figure_draws_one_figure_with_aligned_panels():
    fig = assembly.render_figure(TABLES, _two(), {"share_x": True})
    try:
        assert len(fig.subfigs) == 2
        a, b = (assembly._main_axes(s)[0] for s in fig.subfigs)
        pa, pb = a.get_window_extent(), b.get_window_extent()
        assert pa.x0 == pytest.approx(pb.x0, abs=0.01)     # left edges
        assert pa.x1 == pytest.approx(pb.x1, abs=0.01)     # and, shared x, right edges
        assert a.get_xlim() == b.get_xlim()
        assert not any(t.get_visible() and t.get_text()
                       for t in a.get_xticklabels()) and a.get_xlabel() == ""
        assert b.get_xlabel()
        boxes = [p["box"] for p in fig._iris_panels]
        # the letter band sits above the first panel; the last reaches the bottom
        assert 0 < boxes[0][1] < 0.15 and boxes[1][3] == pytest.approx(1)
        assert [p["tag"] for p in fig._iris_panels] == ["A", "B"]
        svg = compiler.figure_to_svg(fig)
        assert 'id="panel-letter-0"' in svg and 'id="p1-plot-area"' in svg
    finally:
        compiler.close(fig)


@pytest.mark.parametrize("direction", ["rows", "columns"])
def test_letters_sit_clear_of_the_panel(direction):
    # a long rotated y label reaches the top of the axes; the letter's band must
    # still be free of every part of the panel
    fig = assembly.render_figure(TABLES, _two(), {"direction": direction, "share_x": True})
    try:
        r = fig.canvas.get_renderer()
        letters = {t.get_gid(): t for t in fig.texts if (t.get_gid() or "").startswith("panel-letter-")}
        assert len(letters) == 2
        for i, s in enumerate(fig.subfigs):
            band = letters[f"panel-letter-{i}"].get_window_extent(r)
            assert s.bbox.y1 <= band.y0 + 0.5          # the band is above the canvas
            assert band.x0 >= s.bbox.x0 - 0.5           # at the panel's left edge
            for a in s.axes:
                assert a.get_tightbbox(r).y1 <= band.y0 + 0.5
    finally:
        compiler.close(fig)


def test_a_pinned_plot_size_is_kept_inside_its_panel():
    a, b = _two()
    b["style"]["overrides"].update(plot_w_mm=40, plot_h_mm=30)
    fig = assembly.render_figure(TABLES, [a, b], {"direction": "columns"})
    try:
        sub = fig.subfigs[1]
        ax = sub.axes[0]
        mm = 25.4 / fig.dpi
        # exactly the pinned size: neither the letter band nor the alignment scales it
        e = ax.get_window_extent()
        assert e.width * mm == pytest.approx(40, abs=0.05)
        assert e.height * mm == pytest.approx(30, abs=0.05)
        assert abs(sub.bbox.height * mm - 50) < 0.5   # the canvas keeps its 50 mm
        # its labels fit inside the panel
        tight = ax.get_tightbbox(fig.canvas.get_renderer())
        assert tight.x0 >= sub.bbox.x0 - 0.5 and tight.y0 >= sub.bbox.y0 - 0.5
    finally:
        compiler.close(fig)


def test_each_panel_keeps_its_own_canvas():
    a, b = _two()
    b["style"]["overrides"].update(width_mm=60, height_mm=30)
    fig = assembly.render_figure(TABLES, [a, b], {"direction": "rows"})
    try:
        mm = 25.4 / fig.dpi
        wa, ha = fig.subfigs[0].bbox.width * mm, fig.subfigs[0].bbox.height * mm
        wb, hb = fig.subfigs[1].bbox.width * mm, fig.subfigs[1].bbox.height * mm
        assert abs(wa - 90) < 0.5 and abs(wb - 60) < 0.5      # not stretched to 90
        assert abs(ha / hb - 50 / 30) < 0.02
        assert fig.subfigs[1].bbox.x0 < 0.5                     # left-aligned
    finally:
        compiler.close(fig)


def test_side_by_side_plot_areas_share_top_and_bottom():
    a, b = _two()
    b["style"]["overrides"].update(plot_w_mm=40, plot_h_mm=30)
    fig = assembly.render_figure(TABLES, [a, b], {"direction": "columns"})
    try:
        ea, eb = (s.axes[0].get_window_extent() for s in fig.subfigs)
        assert abs(ea.y0 - eb.y0) < 0.5 and abs(ea.y1 - eb.y1) < 0.5
        assert eb.height * 25.4 / fig.dpi == pytest.approx(30, abs=0.05)   # the pin wins
    finally:
        compiler.close(fig)


def test_rows_are_left_aligned_without_shared_x():
    fig = assembly.render_figure(TABLES, _two(), {})
    try:
        a, b = (assembly._main_axes(s)[0] for s in fig.subfigs)
        assert a.get_window_extent().x0 == pytest.approx(b.get_window_extent().x0, abs=0.01)
    finally:
        compiler.close(fig)


def test_size_and_columns():
    fig = assembly.render_figure(TABLES, _two(),
                                 {"direction": "columns", "width_mm": 170, "height_mm": 60})
    try:
        w, h = fig.get_size_inches() * 25.4
        assert (w, h) == (pytest.approx(170), pytest.approx(60))
        a, b = (assembly._main_axes(s)[0] for s in fig.subfigs)
        assert a.get_window_extent().y0 == pytest.approx(b.get_window_extent().y0, abs=0.01)
    finally:
        compiler.close(fig)


@pytest.mark.parametrize("fmt,magic", [("svg", b"<?xml"), ("pdf", b"%PDF"),
                                       ("png", b"\x89PNG")])
def test_every_export_format(fmt, magic):
    fig = assembly.render_figure(TABLES, _two(), {})
    try:
        assert compiler.figure_to_bytes(fig, fmt, dpi=72).startswith(magic)
    finally:
        compiler.close(fig)


def test_strict_failure_names_the_panel():
    bad = _two()
    bad[1]["encodings"]["y"] = {"column": "missing"}
    with pytest.raises(assembly.AssemblyError, match="panel B"):
        assembly.render_figure(TABLES, bad, {})


def test_no_panels_is_an_error():
    with pytest.raises(assembly.AssemblyError, match="no panels"):
        assembly.render_figure(TABLES, [_an("x", "t", "y")], {})


def test_render_iris_uses_the_assembly_or_the_single_analysis():
    fig = assembly.render_iris(document.save_document(TABLES, _two(), {}, {}, figure={}))
    assert len(fig.subfigs) == 2
    compiler.close(fig)
    fig = assembly.render_iris(document.save_document(TABLES, [_an("s", "t", "y")], {}, {}))
    assert not fig.subfigs
    compiler.close(fig)
    with pytest.raises(assembly.AssemblyError, match="no figure assembly"):
        assembly.render_iris(document.save_document(TABLES, _two(), {}, {}))


def _single_svg(spec):
    table, bound = assembly._bind_tables(spec, TABLES)
    fig = render.render(table, bound)[0]
    try:
        return compiler.figure_to_svg(fig)
    finally:
        compiler.close(fig)


def test_single_figure_is_byte_identical_around_an_assembly():
    """The assembly hook must leave the ordinary path alone: a single analysis
    renders the same bytes before and after an assembly has been drawn, and the
    panel hook is unset outside it. (The full corpus check — every validation
    and example .iris, SVG/PNG/PDF hashed before and after the change — was run
    by hand when the hook went in.)"""
    spec = _an("solo", "g", "y", geom="box")
    before = _single_svg(spec)
    fig = assembly.render_figure(TABLES, _two(), {"share_x": True})
    compiler.close(fig)
    assert compiler._PANEL_PARENT.get() is None
    assert _single_svg(spec) == before
    # a tag is not a figure property of the single analysis
    assert _single_svg({**spec, "tag": "A"}) == before


# ------------------------------------------------------------ endpoints

def _panels():
    table = {"schema": SCHEMA, "rows": ROWS}
    out = []
    for a in _two():
        nodes = [{**n, "table": table} for n in a["reduce"]["nodes"]]
        out.append({"table": table, "spec": {**a, "reduce": {**a["reduce"], "nodes": nodes}},
                    "tag": a["tag"]})
    return out


def test_figure_render_endpoint():
    r = client.post("/figure/render", json={"panels": _panels(), "figure": {}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["svg"].lstrip().startswith("<?xml")
    assert [p["id"] for p in body["panels"]] == ["first", "second"]
    band = assembly._band_mm(assembly.normalize({}))      # a letter band per stacked panel
    assert body["width_mm"] == pytest.approx(90) and body["height_mm"] == pytest.approx(103 + 2 * band)


def test_figure_render_shows_a_failing_panel_instead_of_failing():
    panels = _panels()
    panels[1]["spec"]["encodings"]["y"] = {"column": "missing"}
    body = client.post("/figure/render", json={"panels": panels, "figure": {}}).json()
    assert body["panels"][1]["error"] and body["panels"][0]["error"] is None
    r = client.post("/figure/export", json={"panels": panels, "figure": {}, "format": "svg"})
    assert r.status_code == 422


def test_figure_export_endpoint():
    r = client.post("/figure/export", json={"panels": _panels(), "figure": {},
                                            "format": "pdf", "dpi": 72})
    assert r.status_code == 200, r.text
    assert base64.b64decode(r.json()["data_base64"]).startswith(b"%PDF")


def test_save_and_load_endpoints_carry_the_assembly():
    save = client.post("/document/save", json={
        "tables": [{"name": "cells", "table": {"schema": SCHEMA, "rows": ROWS}}],
        "analyses": _two(), "provenance": {}, "figure": {"gap_mm": 7}})
    assert save.status_code == 200, save.text
    doc = client.post("/document/load", json={"data_base64": save.json()["data_base64"]}).json()
    assert doc["figure"]["gap_mm"] == 7
    plain = client.post("/document/save", json={
        "tables": [{"name": "cells", "table": {"schema": SCHEMA, "rows": ROWS}}],
        "analyses": _two(), "provenance": {}})
    doc = client.post("/document/load", json={"data_base64": plain.json()["data_base64"]}).json()
    assert doc["figure"] is None
    assert json.dumps(doc["analyses"])   # analyses ride back untouched
