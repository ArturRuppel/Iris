"""A file whose analyses disagree with their table's hierarchy renders by the
table's, as the app does (it keeps one hierarchy per table)."""
from iris_engine import document


def _doc(table_h, an_h):
    cols = [{"name": "g", "type": "categorical", "identifier": True},
            {"name": "v", "type": "numeric"}]
    tables = {"t": {"schema": {"schema_version": "1.0", "columns": cols},
                    "hierarchy": table_h, "rows": [{"g": "a", "v": 1.0}]}}
    an = [{"id": "x", "table_id": "t", "hierarchy": an_h}]
    return document.load_document(document.save_document(tables, an, {}, {}))


def test_table_hierarchy_wins():
    d = _doc({"spine": ["g"], "fn": {"g": "median"}}, {"spine": ["g"], "fn": {"g": "sum"}})
    assert d["analyses"][0]["hierarchy"] == {"spine": ["g"], "fn": {"g": "median"}}


def test_empty_table_spine_falls_back_to_first_analysis():
    d = _doc({"spine": [], "fn": {}}, {"spine": ["g"], "fn": {"g": "sum"}})
    assert d["analyses"][0]["hierarchy"] == {"spine": ["g"], "fn": {"g": "sum"}}


def test_no_spine_anywhere_uses_identifiers():
    d = _doc({"spine": [], "fn": {}}, {"spine": [], "fn": {}})
    assert d["analyses"][0]["hierarchy"] == {"spine": ["g"], "fn": {}}
