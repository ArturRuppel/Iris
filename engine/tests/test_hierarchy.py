"""Data hierarchy redesign: a spine of nested grouping columns, per-level tables
with row_ids chained to raw rows, and per-layer level binding compose a
superplot with no preset. Pairing (paired/partial/unpaired) is derived from the
spine. Stats are deferred — these pin the plotting + data-shape contracts.

See docs/superpowers/specs/2026-06-16-data-hierarchy-redesign.md.
"""
import numpy as np
import pandas as pd

from iris_engine import compiler, hierarchy


# spine: subject ⊃ rep (a subject contains several technical reps); `group` is a
# qualifier (orthogonal to the spine). Two shapes: unpaired (each subject is one
# group) and paired (each subject measured under both groups).
def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "group", "type": "categorical", "label": "Group"},
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "rep", "type": "identifier", "label": "Rep"},
        {"name": "y", "type": "numeric", "label": "Y"}]}


def _unpaired_df():
    rows, rid = [], 0
    for grp, subs in (("A", ["s1", "s2"]), ("B", ["s3", "s4"])):
        for s in subs:
            for r in range(3):
                rows.append({"id": f"r{rid}", "excluded": False, "group": grp,
                             "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)


def _paired_df():
    rows, rid = [], 0
    for s in ["s1", "s2", "s3"]:
        for grp in ("A", "B"):
            for r in range(3):
                rows.append({"id": f"r{rid}", "excluded": False, "group": grp,
                             "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)


SPINE = ["subject", "rep"]


# --------------------------------------------------------------------------- #
# materialize_levels
# --------------------------------------------------------------------------- #

def test_levels_and_grain_cardinality():
    df = _unpaired_df()
    levels, present = hierarchy.materialize_levels(df, _schema(), SPINE, {}, ["group"])
    assert present == SPINE
    assert set(levels) == {hierarchy.RAW, "subject", "rep"}
    # raw = every row; subject = one per subject; rep = one per (subject, rep)
    assert len(levels[hierarchy.RAW][0]) == len(df)
    assert len(levels["subject"][0]) == df["subject"].nunique()
    assert len(levels["rep"][0]) == df.groupby(["subject", "rep"]).ngroups


def test_row_ids_chain_to_raw():
    """Every coarse row carries exactly the raw ids it aggregates, so excluding a
    coarse mark drops the whole unit. The subject level partitions the raw ids."""
    df = _unpaired_df()
    levels, _ = hierarchy.materialize_levels(df, _schema(), SPINE, {}, ["group"])
    subj_tbl = levels["subject"][0]
    seen = []
    for _, row in subj_tbl.iterrows():
        ids = row["row_ids"]
        want = set(df[df["subject"] == row["subject"]]["id"])
        assert set(ids) == want                      # chains to exactly its raw rows
        seen += ids
    assert sorted(seen) == sorted(df["id"])          # a partition: every raw row once


def test_carried_vs_dropped_qualifier():
    """A qualifier single-valued within the grain carries; otherwise it drops.
    `group` is constant per subject (unpaired) → carried at the subject level."""
    df = _unpaired_df()
    levels, _ = hierarchy.materialize_levels(df, _schema(), SPINE, {}, [])
    subj_cols = {c["name"] for c in levels["subject"][1]["columns"]}
    assert "group" in subj_cols                      # carried
    # in the paired shape, group varies within a subject → dropped at subject level
    pdf = _paired_df()
    plev, _ = hierarchy.materialize_levels(pdf, _schema(), SPINE, {}, [])
    psubj_cols = {c["name"] for c in plev["subject"][1]["columns"]}
    assert "group" not in psubj_cols                 # dropped (multi-valued)


def test_mean_aggregation():
    df = _unpaired_df()
    levels, _ = hierarchy.materialize_levels(df, _schema(), SPINE, {}, ["group"])
    subj = levels["subject"][0]
    s1 = subj[subj["subject"] == "s1"]["y"].iloc[0]
    assert s1 == df[df["subject"] == "s1"]["y"].mean()


def test_resolve_level_fallback():
    df = _unpaired_df()
    levels, _ = hierarchy.materialize_levels(df, _schema(), SPINE, {}, [])
    # an unknown / dropped level falls back to RAW rather than blanking
    assert hierarchy.resolve_level(levels, "nope")[0] is levels[hierarchy.RAW][0]
    assert hierarchy.resolve_level(levels, None)[0] is levels[hierarchy.RAW][0]


# --------------------------------------------------------------------------- #
# pairing follows from the spine
# --------------------------------------------------------------------------- #

def test_pairing_unpaired():
    df = _unpaired_df()
    p = hierarchy.pairing(df, SPINE, "group")
    assert p["verdict"] == "unpaired"                # each subject sees one group


def test_pairing_paired():
    df = _paired_df()
    p = hierarchy.pairing(df, SPINE, "group")
    assert p["verdict"] == "paired"
    assert p["across"] == "subject"                  # paired over subjects
    assert p["n_units"] == p["n_complete"] == 3


def test_pairing_partial():
    df = _paired_df()
    df = df[~((df["subject"] == "s3") & (df["group"] == "B"))]   # drop one arm
    p = hierarchy.pairing(df, SPINE, "group")
    assert p["verdict"] == "partially_paired"
    assert p["n_complete"] == 2 and p["n_units"] == 3


def test_pairing_none_for_spine_column():
    # a spine column is not a horizontal qualifier → no pairing verdict
    assert hierarchy.pairing(_unpaired_df(), SPINE, "subject") is None


def test_home_level():
    assert hierarchy.home_level(_unpaired_df(), SPINE, "group") == "subject"
    assert hierarchy.home_level(_paired_df(), SPINE, "group") == "rep"


def test_describe_hierarchy():
    """The Data-tab summary: per-level grain cardinality + each classifier's home
    level (where it attaches to the spine)."""
    df = _unpaired_df()
    d = hierarchy.describe_hierarchy(df, SPINE, ["group"])
    assert d["spine"] == SPINE
    assert d["n_raw"] == len(df)
    counts = {l["name"]: l["n_groups"] for l in d["levels"]}
    assert counts["subject"] == df["subject"].nunique()
    assert counts["rep"] == df.groupby(["subject", "rep"]).ngroups
    grp = next(c for c in d["classifiers"] if c["name"] == "group")
    assert grp["home"] == "subject" and grp["n_levels"] == 2


# --------------------------------------------------------------------------- #
# compiler: per-layer levels compose, gids stay unique, ids chain through
# --------------------------------------------------------------------------- #

def _spec(layers):
    return {"spec_version": "2.0", "encodings": {
                "x": {"column": "group"}, "y": {"column": "y"},
                "color": None, "size": None, "shape": None},
            "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
            "layers": layers, "style": {"preset": "demo_default", "overrides": {}}}


def test_two_dot_layers_unique_gids_and_chained_ids():
    df = _unpaired_df()
    schema = _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, SPINE, {}, ["group"])
    spec = _spec([
        {"geom": "dot", "params": {}, "level": hierarchy.RAW},      # raw reps
        {"geom": "dot", "params": {}, "level": "subject"},          # one per subject
        {"geom": "summary", "params": {"error_type": "sem"}, "level": "subject"},
    ])
    fig, pg = compiler.build_comparison_figure(df, schema, spec, {}, levels)
    compiler.close(fig)
    gids = [g["gid"] for g in pg]
    assert len(gids) == len(set(gids))               # no pts-N reuse across layers
    # the subject-level dots: each mark's row_ids is a list chaining to raw rows
    flat = [ids for g in pg for ids in g["row_ids"]]
    assert any(isinstance(ids, list) and len(ids) > 1 for ids in flat)
    # every emitted raw id is a real raw row
    every = {i for ids in flat for i in (ids if isinstance(ids, list) else [ids])}
    assert every <= set(df["id"])


def test_identifier_color_colours_dots_per_grain_without_dodge():
    """Mapping an identifier (a replicate id) to colour draws each per-grain dot
    in its own swatch — the superplot replicate colouring — without dodging the
    group into sub-columns. Each (x-level × colour) sub-series is its own
    point-group so the click/exclude contract survives, and a box layer at a
    different grain keeps a single uniform mark per x-level."""
    df = _unpaired_df()
    schema = _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, SPINE, {}, ["group", "subject"])
    spec = _spec([
        {"geom": "box", "params": {}, "level": "subject"},
        {"geom": "dot", "params": {}, "level": "subject"},   # one bold dot per subject
    ])
    spec["encodings"]["color"] = {"column": "subject"}        # identifier on colour
    fig, pg = compiler.build_comparison_figure(df, schema, spec, {}, levels)
    # two groups (A, B) × two subjects each = four per-subject dot series, each a
    # single mark (one subject-level dot), and gids stay unique.
    assert len(pg) == 4
    assert all(len(g["row_ids"]) == 1 for g in pg)
    assert len({g["gid"] for g in pg}) == 4
    # the four subject dots take four distinct colours (no two subjects share)
    dot_colors = {tuple(round(x, 3) for x in coll.get_facecolors()[0])
                  for ax in fig.axes for coll in ax.collections
                  if len(coll.get_offsets()) == 1}
    assert len(dot_colors) == 4
    compiler.close(fig)


def test_summary_error_from_level_spread():
    """A summary bound to the subject level reports the spread *across subjects*
    (the honest unit-level error), not across raw reps — the spec's core claim."""
    df = _unpaired_df()
    schema = _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, SPINE, {}, ["group"])
    # group A subjects s1,s2 have raw y {0..2} and {3..5} → subject means 1 and 4.
    subj = levels["subject"][0]
    a_means = subj[subj["group"] == "A"]["y"].tolist()
    assert sorted(a_means) == [1.0, 4.0]
    # the summary geom computes _summary_of over these subject means (n=2), so the
    # SD is that of [1,4], not of the six raw values.
    s = compiler._summary_of("A", np.array(a_means))
    assert s["n"] == 2
    assert abs(s["sd"] - np.std([1.0, 4.0], ddof=1)) < 1e-9
