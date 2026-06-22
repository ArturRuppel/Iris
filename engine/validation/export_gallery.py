"""Export the curated gallery cases to the frontend bundle: an openable .iris and
one .svg per analysis for each case, plus a manifest.json the gallery UI reads.

    python -m validation.export_gallery

Unlike build.py (which writes the gitignored artifacts/ dir for spot-checking),
this writes COMMITTED assets under src/examples/assets/ so they ship with the
app and the frontend build stays pure-JS.
"""
from __future__ import annotations

import json
from pathlib import Path

from iris_engine import compiler, document, main

from . import harness

# repo_root/src/examples/assets  (this file is repo_root/engine/validation/...)
ASSETS = harness.ROOT.parent.parent / "src" / "examples" / "assets"

# Curated, ordered. Each entry is a case folder name; the gallery.md prose
# references plots as example:<caseId>/<analysisId>. Order here is documentary
# only — gallery.md controls display order.
GALLERY_CASES = [
    "iris-species-comparison",
    "mann-whitney",
    "sleep-paired-t",
    "sleep-wilcoxon",
    "iris-species-anova",
    "kruskal",
    "one-sample-location",
    "one-sample-wilcoxon",
    "iris-petal-correlation",
    "iris-petal-spearman",
    "contingency-2x2",
    "fisher-exact-tea",
    "iris-sepal-descriptive",
    "timeseries-growth",
]


def _export_case(case_name: str) -> dict:
    case = harness.load_case(harness.CASES_DIR / case_name)
    data = harness.build_iris(case, write=False)
    (ASSETS / f"{case_name}.iris").write_bytes(data)

    doc = document.load_document(data)
    table = {"schema": doc["schema"], "rows": doc["rows"]}
    plots = []
    for spec in doc["analyses"]:
        analysis_id = spec.get("id") or case_name
        fig, *_ = main._run(table, spec)
        svg = compiler.figure_to_svg(fig)
        compiler.close(fig)
        svg_file = f"{analysis_id}.svg"
        (ASSETS / svg_file).write_text(svg)
        geom = (spec.get("layers") or [{}])[0].get("geom", "")
        plots.append({"analysisId": analysis_id, "svgFile": svg_file, "geom": geom})

    return {
        "caseId": case_name,
        "title": getattr(case, "TITLE", case_name),
        "source": getattr(case, "SOURCE", ""),
        "irisFile": f"{case_name}.iris",
        "filename": f"{case_name}.iris",
        "plots": plots,
    }


def export(*, write: bool = True) -> list[dict]:
    ASSETS.mkdir(parents=True, exist_ok=True)
    manifest = [_export_case(name) for name in GALLERY_CASES]
    if write:
        (ASSETS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    m = export(write=True)
    print(f"exported {len(m)} cases "
          f"({sum(len(e['plots']) for e in m)} plots) -> {ASSETS}")
