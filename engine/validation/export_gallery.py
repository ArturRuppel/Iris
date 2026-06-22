"""Export the curated gallery cases to the frontend bundle: an openable .iris and
one .svg per analysis for each case, plus a manifest.json the gallery UI reads.

    python -m validation.export_gallery

Unlike build.py (which writes the gitignored artifacts/ dir for spot-checking),
this writes COMMITTED assets under src/examples/assets/ so they ship with the
app and the frontend build stays pure-JS.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

import matplotlib

from iris_engine import compiler, document, main

from . import harness

# repo_root/src/examples/assets  (this file is repo_root/engine/validation/...)
ASSETS = harness.ROOT.parent.parent / "src" / "examples" / "assets"

# These assets are committed to git, so the export must be byte-deterministic or
# every rebuild churns the diff. Two sources of non-determinism are neutralised:
#   - matplotlib stamps each SVG with a render date and salts its element ids;
#   - save_document stamps the .iris manifest with a "modified" time and the ZIP
#     records per-entry mtimes.
# A fixed hashsalt + stripping the date settle the SVG; a fixed manifest time +
# a fixed ZIP date_time settle the .iris. Pinned epoch: 1980-01-01 (the minimum
# a ZIP can store).
_HASHSALT = "iris-gallery"
matplotlib.rcParams["svg.hashsalt"] = _HASHSALT   # stable SVG element ids

_FIXED_TS = "1980-01-01T00:00:00+00:00"
_ZIP_DATE = (1980, 1, 1, 0, 0, 0)
_DC_DATE = re.compile(r"<dc:date>.*?</dc:date>", re.DOTALL)
_MODIFIED = re.compile(r'("modified":\s*")[^"]*(")')


def _normalize_svg(svg: str) -> str:
    """Drop matplotlib's per-render date stamp (element ids are already stable
    via the fixed svg.hashsalt set in export())."""
    return _DC_DATE.sub("<dc:date/>", svg)


def _normalize_iris(data: bytes) -> bytes:
    """Rebuild the .iris ZIP deterministically: neutralise the manifest's
    "modified" timestamp and pin every entry's mtime, preserving entry order and
    per-entry compression (parquet is stored pre-compressed)."""
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            payload = src.read(info.filename)
            if info.filename == "manifest.json":
                payload = _MODIFIED.sub(
                    rf"\g<1>{_FIXED_TS}\g<2>", payload.decode()).encode()
            zi = zipfile.ZipInfo(info.filename, date_time=_ZIP_DATE)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            dst.writestr(zi, payload)
    return out.getvalue()

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
    "potential-double-well",
    "event-rate-by-group",
    "timeseries-growth",
    "superplot-nested",
]


def _export_case(case_name: str) -> dict:
    case = harness.load_case(harness.CASES_DIR / case_name)
    data = _normalize_iris(harness.build_iris(case, write=False))
    (ASSETS / f"{case_name}.iris").write_bytes(data)

    doc = document.load_document(data)
    table = {"schema": doc["schema"], "rows": doc["rows"]}
    plots = []
    for spec in doc["analyses"]:
        analysis_id = spec.get("id") or case_name
        fig, *_ = main._run(table, spec)
        try:
            svg = _normalize_svg(compiler.figure_to_svg(fig))
        finally:
            compiler.close(fig)   # never leak the figure, even on a render error
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
