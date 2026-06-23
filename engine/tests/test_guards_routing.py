# engine/tests/test_guards_routing.py
import pandas as pd
from iris_engine import hierarchy

def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "experiment", "type": "identifier", "label": "Experiment"},
        {"name": "field", "type": "identifier", "label": "Field"},
        {"name": "cell", "type": "identifier", "label": "Cell"},
        {"name": "frame", "type": "numeric", "label": "Frame"},
        {"name": "area", "type": "numeric", "label": "Area"}]}

def _df():
    rows, rid = [], 0
    for e in ("e1", "e2", "e3"):
        for f in ("f1", "f2"):
            for c in range(4):            # cell ids repeat across fields
                for fr in range(5):
                    rows.append({"id": f"r{rid}", "experiment": e, "field": f,
                                 "cell": c, "frame": fr, "area": float(rid)})
                    rid += 1
    return pd.DataFrame(rows)

SPINE = ["experiment", "field", "cell", "frame"]

def test_pseudoreplication_flags_test_finer_than_coarsest():
    df = _df()
    plan = hierarchy.default_plan(SPINE, {})
    v = hierarchy.pseudoreplication(df, plan, test_grain="")   # test at raw
    assert v["risk"] is True
    assert v["n_test"] == len(df)
    assert v["n_coarsest"] == 3            # 3 experiments
    assert v["coarsest_grain"] == "experiment"

def test_pseudoreplication_clear_at_coarsest():
    df = _df()
    plan = hierarchy.default_plan(SPINE, {})
    v = hierarchy.pseudoreplication(df, plan, test_grain="experiment")
    assert v["risk"] is False
