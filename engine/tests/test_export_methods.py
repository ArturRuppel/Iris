"""/export/methods smoke: a two-analysis document assembles a methods `.md` and a
statistics `.csv` from freshly-run stats."""
import base64
import csv
import io

from fastapi.testclient import TestClient

from iris_engine import main, methods
from test_engine import make_spec, make_table

client = TestClient(main.app)


def _doc(fmt):
    table = make_table()      # {schema, rows}: treatment × response
    save_table = {"name": "t1", "table": table, "hierarchy": {"spine": [], "fn": {}}}
    a = {**make_spec(), "title": "Fig 1", "table_id": "t1"}
    b = {**make_spec(override="mann_whitney"), "title": "Fig 2", "table_id": "t1"}
    return {"tables": [save_table], "analyses": [a, b], "format": fmt}


def _decode(r):
    return base64.b64decode(r.json()["data_base64"]).decode()


def test_methods_markdown_covers_every_analysis():
    r = client.post("/export/methods", json=_doc("md"))
    assert r.status_code == 200
    assert r.json()["filename"] == "methods.md"
    md = _decode(r)
    assert md.startswith("# Statistical methods")
    assert "**Fig 1.**" in md and "**Fig 2.**" in md
    assert "Welch's t-test" in md and "Mann–Whitney U test" in md
    assert "## Statistics table" in md
    assert "| Analysis | Comparison | Test | n | Statistic | p | Effect size |" in md
    # the software line names a real backend version from the live snapshot
    assert "Statistical analyses were performed in Iris" in md
    assert "scipy" in md


def test_stats_csv_has_a_row_per_test():
    r = client.post("/export/methods", json=_doc("csv"))
    assert r.status_code == 200
    assert r.json()["filename"] == "statistics.csv"
    rows = list(csv.reader(io.StringIO(_decode(r))))
    assert rows[0] == methods.TABLE_COLUMNS
    assert len(rows) == 3            # header + two single-test analyses
    assert rows[1][0] == "Fig 1" and rows[1][2] == "Welch's t-test"
    assert rows[2][2] == "Mann–Whitney U test"


def test_bad_format_is_400():
    r = client.post("/export/methods", json=_doc("docx"))
    assert r.status_code == 400


def test_unresolvable_analysis_is_skipped_not_fatal():
    doc = _doc("csv")
    doc["analyses"].append({**make_spec(), "title": "Orphan", "table_id": "missing"})
    r = client.post("/export/methods", json=doc)
    assert r.status_code == 200
    rows = list(csv.reader(io.StringIO(_decode(r))))
    assert len(rows) == 3            # the orphan (no resolvable table) contributes nothing
    assert "Orphan" not in _decode(r)
