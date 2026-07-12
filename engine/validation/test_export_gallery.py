"""The bundled gallery assets must stay openable AND byte-deterministic: every
.iris named in the generated manifest round-trips through document.load_document,
every plot SVG it lists exists on disk, and re-exporting produces identical
bytes (so the committed assets never churn). Guards against a stale, partial, or
non-reproducible export.

The export writes into a tmp dir (ASSETS redirected per-test), never the committed
src/examples/assets — regenerating those is `npm run examples:build`'s job, not a
side effect of running the suite."""
from __future__ import annotations

import json

import pytest

from iris_engine import document

from . import export_gallery


@pytest.fixture
def assets(tmp_path, monkeypatch):
    """Redirect the exporter's output dir to a throwaway path for the test."""
    monkeypatch.setattr(export_gallery, "ASSETS", tmp_path)
    return tmp_path


def test_manifest_assets_round_trip(assets):
    export_gallery.export(write=True)
    manifest = json.loads((assets / "manifest.json").read_text())
    assert manifest, "manifest is empty"
    for entry in manifest:
        iris_path = assets / entry["irisFile"]
        assert iris_path.exists(), f"missing {entry['irisFile']}"
        doc = document.load_document(iris_path.read_bytes())   # raises if corrupt
        assert doc["analyses"], f"{entry['caseId']} has no analyses"
        for plot in entry["plots"]:
            assert (assets / plot["svgFile"]).exists(), \
                f"missing {plot['svgFile']}"


def test_committed_examples_are_reduce_dag():
    """Every COMMITTED example .iris must be format 2.2 with a DAG-shaped reduce
    (nodes + output, no legacy linear `steps`). A stale 2.1 fixture crashes the
    frontend's adoptReduceDag on open (it reads reduce.nodes), so this guards the
    shipped assets against drifting behind the reduce-DAG spec. Reads the real
    src/examples/assets dir (no ASSETS redirect), not a rebuilt tmp copy."""
    iris_files = sorted(export_gallery.ASSETS.glob("*.iris"))
    assert iris_files, "no committed example .iris files found"
    for f in iris_files:
        doc = document.load_document(f.read_bytes())
        assert doc["manifest"]["format_version"] == "2.2", \
            f"{f.name}: manifest format_version {doc['manifest']['format_version']!r} != 2.2"
        for spec in doc["analyses"]:
            sid = spec.get("id")
            assert spec.get("spec_version") == "2.2", \
                f"{f.name}/{sid}: spec_version {spec.get('spec_version')!r} != 2.2"
            reduce = spec.get("reduce") or {}
            assert "nodes" in reduce and "output" in reduce, \
                f"{f.name}/{sid}: reduce is not a DAG (missing nodes/output)"
            assert "steps" not in reduce, \
                f"{f.name}/{sid}: reduce still carries a legacy `steps` list"


def test_export_is_byte_deterministic(assets):
    """Two exports of the same case must yield identical .iris and .svg bytes —
    committed assets would otherwise churn on every rebuild."""
    a = export_gallery._export_case("kruskal")
    iris_a = (assets / a["irisFile"]).read_bytes()
    svg_a = (assets / a["plots"][0]["svgFile"]).read_text()
    export_gallery._export_case("kruskal")
    iris_b = (assets / a["irisFile"]).read_bytes()
    svg_b = (assets / a["plots"][0]["svgFile"]).read_text()
    assert iris_a == iris_b, ".iris export is not byte-deterministic"
    assert svg_a == svg_b, ".svg export is not byte-deterministic"
