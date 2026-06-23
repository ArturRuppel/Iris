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

def _paired_df():
    # paired by SUBJECT (each subject sees both groups) but NOT by rep: group A
    # uses reps 0-2, group B uses reps 3-5, so no single rep crosses both groups.
    # Testing at the subject grain is paired; testing at the rep grain is not.
    rows, rid = [], 0
    for s in ["s1", "s2", "s3"]:
        for grp, reps in (("A", [0, 1, 2]), ("B", [3, 4, 5])):
            for r in reps:
                rows.append({"id": f"r{rid}", "group": grp,
                             "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)

PSPINE = ["subject", "rep"]

def test_pairing_flip_detects_paired_to_unpaired():
    df = _paired_df()
    v = hierarchy.pairing_flip(df, PSPINE, "group",
        default_grain="subject", chosen_grain="subject/rep")
    assert v["flipped"] is True
    assert v["from"] == "paired"
    assert v["to"] in ("unpaired", "partially_paired")

def test_pairing_flip_none_when_verdict_unchanged():
    df = _paired_df()
    v = hierarchy.pairing_flip(df, PSPINE, "group",
        default_grain="subject", chosen_grain="subject")
    assert v["flipped"] is False

def test_identity_merge_flags_dropping_field_keeping_cell():
    df = _df()
    plan = [{"keep": ["experiment", "field", "cell"], "fn": "median"},
            {"keep": ["experiment", "cell"], "fn": "median"}]
    out = hierarchy.identity_merge(df, _schema(), SPINE, plan)
    assert len(out) == 1
    m = out[0]
    assert m["dim"] == "field"
    assert m["before"] == df.groupby(["experiment", "cell", "field"]).ngroups  # 24
    assert m["after"] == df.groupby(["experiment", "cell"]).ngroups            # 12
    assert m["after"] < m["before"]

def test_identity_merge_exempts_numeric_coordinate():
    df = _df()
    plan = [{"keep": ["experiment", "field", "cell", "frame"], "fn": "mean"},
            {"keep": ["experiment", "field", "frame"], "fn": "mean"}]
    assert hierarchy.identity_merge(df, _schema(), SPINE, plan) == []

def test_identity_merge_clear_for_default_chain():
    df = _df()
    assert hierarchy.identity_merge(
        df, _schema(), SPINE, hierarchy.default_plan(SPINE, {})) == []
