"""The bundled gallery assets must stay openable: every .iris named in the
generated manifest round-trips through document.load_document, and every plot
SVG it lists exists on disk. Guards against a stale or partial export."""
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
