"""The bundled gallery assets must stay openable AND byte-deterministic: every
.iris named in the generated manifest round-trips through document.load_document,
every plot SVG it lists exists on disk, and re-exporting produces identical
bytes (so the committed assets never churn). Guards against a stale, partial, or
non-reproducible export."""
from __future__ import annotations

import json

from iris_engine import document

from . import export_gallery


def test_manifest_assets_round_trip():
    export_gallery.export(write=True)
    manifest = json.loads((export_gallery.ASSETS / "manifest.json").read_text())
    assert manifest, "manifest is empty"
    for entry in manifest:
        iris_path = export_gallery.ASSETS / entry["irisFile"]
        assert iris_path.exists(), f"missing {entry['irisFile']}"
        doc = document.load_document(iris_path.read_bytes())   # raises if corrupt
        assert doc["analyses"], f"{entry['caseId']} has no analyses"
        for plot in entry["plots"]:
            assert (export_gallery.ASSETS / plot["svgFile"]).exists(), \
                f"missing {plot['svgFile']}"


def test_export_is_byte_deterministic():
    """Two exports of the same case must yield identical .iris and .svg bytes —
    committed assets would otherwise churn on every rebuild."""
    a = export_gallery._export_case("kruskal")
    iris_a = (export_gallery.ASSETS / a["irisFile"]).read_bytes()
    svg_a = (export_gallery.ASSETS / a["plots"][0]["svgFile"]).read_text()
    export_gallery._export_case("kruskal")
    iris_b = (export_gallery.ASSETS / a["irisFile"]).read_bytes()
    svg_b = (export_gallery.ASSETS / a["plots"][0]["svgFile"]).read_text()
    assert iris_a == iris_b, ".iris export is not byte-deterministic"
    assert svg_a == svg_b, ".svg export is not byte-deterministic"
