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
                rows.append({"id": f"r{rid}", "group": grp,
                             "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)


def _paired_df():
    rows, rid = [], 0
    for s in ["s1", "s2", "s3"]:
        for grp in ("A", "B"):
            for r in range(3):
                rows.append({"id": f"r{rid}", "group": grp,
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
    """Every coarse row carries exactly the raw ids it aggregates (provenance of
    the unit). The subject level partitions the raw ids."""
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


def _unbalanced_three_level_df():
    """A 3-level spine (field ⊃ cell ⊃ frame) with *unbalanced* fan-out: one cell
    has a long track of small values, the rest one big value each. Pooling raw
    leaves and nesting sequentially then give different coarse summaries, so this
    pins which one materialize_levels does."""
    rows, rid = [], 0
    data = [("f1", "A", [1, 1, 1, 1, 1]), ("f1", "B", [100]),
            ("f2", "C", [100]), ("f2", "D", [100])]
    for fov, cell, vals in data:
        for fr, v in enumerate(vals):
            rows.append({"id": f"r{rid}", "fov": fov, "cell": f"{fov}{cell}",
                         "frame": fr, "y": float(v)})
            rid += 1
    schema = {"schema_version": "1.0", "columns": [
        {"name": "fov", "type": "identifier", "label": "FOV"},
        {"name": "cell", "type": "identifier", "label": "Cell"},
        {"name": "frame", "type": "numeric", "label": "Frame"},
        {"name": "y", "type": "numeric", "label": "Y"}]}
    return pd.DataFrame(rows), schema


def test_collapse_is_sequential_nested_not_pooled():
    """Coarsening nests: each level summarizes the finer level's summaries
    (median-of-medians), each child weighted equally — NOT a pool of raw leaves
    (which the long small-valued track would dominate)."""
    df, schema = _unbalanced_three_level_df()
    spine = ["fov", "cell", "frame"]
    levels, _ = hierarchy.materialize_levels(
        df, schema, spine, {lv: "median" for lv in spine}, [])
    cell = levels["cell"][0].set_index("cell")["y"].to_dict()
    assert cell == {"f1A": 1.0, "f1B": 100.0, "f2C": 100.0, "f2D": 100.0}
    fov = levels["fov"][0].set_index("fov")["y"].to_dict()
    assert fov == {"f1": 50.5, "f2": 100.0}     # median(1,100)=50.5 ; median(100,100)=100
    # pooling the 8 raw leaves would give median = 1.0 (five 1s, three 100s) — not this
    assert fov["f1"] != float(df[df["fov"] == "f1"]["y"].median())


def test_row_ids_union_up_the_chain():
    """A coarse unit's row_ids is the union of its children's — provenance still
    resolves to the exact raw rows even though levels build finest → coarsest."""
    df, schema = _unbalanced_three_level_df()
    levels, _ = hierarchy.materialize_levels(
        df, schema, ["fov", "cell", "frame"], {}, [])
    fov = levels["fov"][0]
    for _, row in fov.iterrows():
        want = set(df[df["fov"] == row["fov"]]["id"])
        assert set(row["row_ids"]) == want


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


def _nested_partition_df():
    """A classifier that partitions cells within each FOV (each cell is one
    label, but every FOV holds both) — the SuperPlot shape."""
    rows, rid = [], 0
    for fov in ("f1", "f2"):                 # coarser unit (e.g. field of view)
        for cell in range(4):                # sub-identity (home); each is one label
            label = "pos" if cell < 2 else "neg"
            for r in range(3):               # finest grain (e.g. frame)
                rows.append({"id": f"r{rid}", "label": label,
                             "fov": fov, "cell": f"{fov}c{cell}", "rep": r,
                             "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)


def test_pairing_nested_partition_is_unpaired_at_raw_grain():
    """At the *raw* grain (no inferential level) a qualifier that partitions a
    sub-identity (each unit's children belong to one level each, never the same
    child under both) is a nested batch design, not a pairing — a field of view
    holding both `+` and `-` cells where no cell is ever both. Containment of both
    levels in the coarser unit must not be mistaken for pairing among raw cells."""
    df = _nested_partition_df()
    spine = ["fov", "cell", "rep"]
    # every fov contains both labels (containment) but via *different* cells —
    # no cell is seen under both, so among raw cells it is unpaired, not paired.
    p = hierarchy.pairing(df, spine, "label")
    assert p["verdict"] == "unpaired"
    assert p["n_complete"] == 0 and p["n_units"] == 2


def test_pairing_block_grain_pairs_by_inferential_unit():
    """The same nested-partition design becomes *paired by the block* once the
    test runs at a grain coarser than the qualifier's home: the per-FOV means of
    `+` and `-` are paired by FOV (the SuperPlot replicate-pairing). The verdict
    is grain-dependent — unpaired among cells, paired across the block."""
    df = _nested_partition_df()
    spine = ["fov", "cell", "rep"]
    p = hierarchy.pairing(df, spine, "label", inferential_level="fov")
    assert p["verdict"] == "paired"
    assert p["across"] == "fov" and p["unit_cols"] == ["fov"]
    assert p["n_units"] == 2 and p["n_complete"] == 2


def test_pairing_block_grain_partial_when_a_block_lacks_a_level():
    """A block missing one level → partially paired (drop-out), not paired."""
    df = _nested_partition_df()
    # make f2 all-positive so it carries only one label
    df.loc[df["fov"] == "f2", "label"] = "pos"
    p = hierarchy.pairing(df, ["fov", "cell", "rep"], "label",
                          inferential_level="fov")
    assert p["verdict"] == "partially_paired"
    assert p["n_complete"] == 1 and p["n_units"] == 2


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


def test_two_dot_layers_draw_their_own_grain():
    from matplotlib.collections import PathCollection
    df = _unpaired_df()
    schema = _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, SPINE, {}, ["group"])
    spec = _spec([
        {"geom": "dot", "params": {}, "level": hierarchy.RAW},      # raw reps
        {"geom": "dot", "params": {}, "level": "subject"},          # one per subject
        {"geom": "summary", "params": {}, "level": "subject"},
    ])
    spec["style"]["overrides"]["geoms"] = {"summary": {"error_type": "sem"}}
    fig = compiler.build_comparison_figure(df, schema, spec, {}, levels)
    # both grains draw marks: total scatter points = raw observations + one mark
    # per subject (the coarse layer aggregates raw rows into fewer marks).
    n_subjects = df[["group", "subject"]].drop_duplicates().shape[0]
    total = sum(len(c.get_offsets()) for ax in fig.axes for c in ax.collections
                if isinstance(c, PathCollection))
    assert total == len(df) + n_subjects
    compiler.close(fig)


def test_identifier_color_colours_dots_per_grain_without_dodge():
    """Mapping an identifier (a replicate id) to colour draws each per-grain dot
    in its own swatch — the superplot replicate colouring — without dodging the
    group into sub-columns. Colour is vectorized (item I), so each x-level group
    is one scatter call carrying a per-point colour array, and a box layer at a
    different grain keeps a single uniform mark per x-level."""
    from matplotlib.collections import PathCollection
    df = _unpaired_df()
    schema = _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, SPINE, {}, ["group", "subject"])
    spec = _spec([
        {"geom": "box", "params": {}, "level": "subject"},
        {"geom": "dot", "params": {}, "level": "subject"},   # one bold dot per subject
    ])
    spec["encodings"]["color"] = {"column": "subject"}        # identifier on colour
    fig = compiler.build_comparison_figure(df, schema, spec, {}, levels)
    # two groups (A, B), one vectorized dot scatter per group (no dodge), each
    # carrying its two subjects' marks; four distinct subject colours in total.
    scatters = [c for ax in fig.axes for c in ax.collections
                if isinstance(c, PathCollection)]
    assert len(scatters) == 2                                 # one per x-level, no dodge
    assert sum(len(c.get_offsets()) for c in scatters) == 4   # four subject dots
    dot_colors = {tuple(round(x, 3) for x in fc)
                  for c in scatters for fc in c.get_facecolors()}
    assert len(dot_colors) == 4                               # no two subjects share
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
    # the summary geom computes stats._summary over these subject means (n=2), so
    # the SD is that of [1,4], not of the six raw values.
    s = compiler.stats_mod._summary("A", np.array(a_means))
    assert s["n"] == 2
    assert abs(s["sd"] - np.std([1.0, 4.0], ddof=1)) < 1e-9


# --------------------------------------------------------------------------- #
# materialize_plan (un-forcing the nesting)
# --------------------------------------------------------------------------- #

def test_default_plan_shape():
    assert hierarchy.default_plan(["subject", "rep"], {"rep": "median"}) == [
        {"keep": ["subject", "rep"], "fn": "median"},
        {"keep": ["subject"], "fn": "mean"},
    ]

def test_default_plan_matches_materialize_levels():
    """The default plan reproduces materialize_levels exactly (the regression
    pin): same grains, same row counts."""
    df = _unpaired_df()
    grains = hierarchy.materialize_plan(
        df, _schema(), hierarchy.default_plan(SPINE, {}), ["group"])
    levels, _ = hierarchy.materialize_levels(df, _schema(), SPINE, {}, ["group"])
    assert set(grains) == {"", "subject/rep", "subject"}
    assert len(grains["subject"][0]) == len(levels["subject"][0])
    assert len(grains["subject/rep"][0]) == len(levels["rep"][0])

def test_plan_skip_pools_two_dims_in_one_step():
    """A step that keeps only [subject] from raw pools every raw row by subject."""
    df = _unpaired_df()
    grains = hierarchy.materialize_plan(
        df, _schema(), [{"keep": ["subject"], "fn": "mean"}], ["group"])
    assert set(grains) == {"", "subject"}
    assert len(grains["subject"][0]) == df["subject"].nunique()

def test_plan_non_prefix_grain():
    """Keep the finer dim, drop the coarser: a non-prefix grain."""
    df = _unpaired_df()
    grains = hierarchy.materialize_plan(
        df, _schema(), [{"keep": ["rep"], "fn": "mean"}], [])
    assert set(grains) == {"", "rep"}
    assert len(grains["rep"][0]) == df["rep"].nunique()

def test_all_nan_qualifier_in_grain_does_not_crash_or_drop_rows():
    """An all-NaN qualifier driven into the grain (e.g. an empty `date` column
    used to split) must not silently drop every row. pandas' default
    groupby(dropna=True) would empty the table and then `.max()` over zero groups
    returns NaN, which `int(...)` choked on (NaN is truthy, so `or 0` missed it).
    With dropna=False the NaN is its own group: no rows vanish, no crash."""
    df = _unpaired_df()
    df["date"] = np.nan          # qualifier present but entirely missing
    schema = {**_schema(), "columns": _schema()["columns"]
              + [{"name": "date", "type": "categorical", "label": "Date"}]}
    # split by the all-NaN column at every level
    grains = hierarchy.materialize_plan(
        df, schema, hierarchy.default_plan(SPINE, {}), ["date"])
    # raw is untouched; every collapsed grain keeps all the underlying rows
    raw = grains[""][0]
    assert len(raw) == len(df)
    total_ids = sum(len(ids) for ids in grains["subject"][0]["row_ids"])
    assert total_ids == len(df)
