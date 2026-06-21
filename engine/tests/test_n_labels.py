"""Sample-size annotation (TODO item G): the n= label reports every grain the
layers actually draw at — replicates AND units — not just the innermost count.
One drawn grain → `n = R`; two → `n = R  N = U`; more → indexed `n₀ … n₁ …`,
finest-first. Grains are ordered by table size (a finer grain has more rows)."""
import matplotlib
matplotlib.use("Agg")
import pandas as pd

from iris_engine import compiler, hierarchy


def test_n_label_one_grain_is_plain_n():
    assert compiler._n_label([120]) == "n = 120"


def test_n_label_two_grains_is_replicates_and_units():
    assert compiler._n_label([120, 6]) == "n = 120  N = 6"


def test_n_label_three_grains_indexed_finest_first():
    assert compiler._n_label([120, 6, 2]) == "n₀ = 120  n₁ = 6  n₂ = 2"


# --------------------------------------------------------------------------- #
# end-to-end: spine subject ⊃ rep, comparison by `group`.
# group A = subjects s1,s2 (3 reps each) → 6 raw rows, 2 subjects.
# --------------------------------------------------------------------------- #

def _schema():
    return {"schema_version": "1.0", "columns": [
        {"name": "group", "type": "categorical", "label": "Group"},
        {"name": "subject", "type": "identifier", "label": "Subject"},
        {"name": "rep", "type": "identifier", "label": "Rep"},
        {"name": "y", "type": "numeric", "label": "Y"}]}


def _df():
    rows, rid = [], 0
    for grp, subs in (("A", ["s1", "s2"]), ("B", ["s3", "s4"])):
        for s in subs:
            for r in range(3):
                rows.append({"id": f"r{rid}", "group": grp,
                             "subject": s, "rep": r, "y": float(rid)})
                rid += 1
    return pd.DataFrame(rows)


def _spec(layers):
    return {"spec_version": "2.0", "encodings": {
                "x": {"column": "group"}, "y": {"column": "y"},
                "color": None, "size": None, "shape": None},
            "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
            "layers": layers, "style": {"overrides": {}}}


def _svg(spec, df, schema, levels):
    # svg.fonttype="none" keeps real <text> in the SVG, so the label string
    # appears verbatim and can be substring-matched.
    fig = compiler.build_comparison_figure(df, schema, spec, {}, levels)
    svg = compiler.figure_to_svg(fig)
    compiler.close(fig)
    return svg


def test_plain_plot_shows_only_replicate_n():
    df, schema = _df(), _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, ["subject", "rep"], {}, ["group"])
    svg = _svg(_spec([{"geom": "box", "params": {}, "level": hierarchy.RAW}]),
               df, schema, levels)
    assert "n = 6" in svg           # 6 raw rows per group
    assert "N =" not in svg         # only one drawn grain → no unit count


def test_superplot_shows_replicates_and_units():
    df, schema = _df(), _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, ["subject", "rep"], {}, ["group"])
    # raw box (replicates) + one bold dot per subject (units)
    svg = _svg(_spec([
        {"geom": "box", "params": {}, "level": hierarchy.RAW},
        {"geom": "dot", "params": {}, "level": "subject"},
    ]), df, schema, levels)
    assert "n = 6  N = 2" in svg     # 6 raw reps, 2 subjects per group
