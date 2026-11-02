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
    assert "n = 6" in svg and "N = 2" in svg   # 6 raw reps, 2 subjects per group
    assert "n = 6  N = 2" not in svg           # on separate lines, so levels don't collide


def test_show_all_levels_toggle_surfaces_undrawn_grains():
    """Item M: `show_all_levels` reports EVERY hierarchy level, not just the
    grains a layer draws at (item G's default). A plain box drawn at RAW shows
    `n = 6` by default; with the toggle the undrawn `subject` grain appears too
    → `n = 6  N = 2`."""
    df, schema = _df(), _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, ["subject"], {}, ["group"])
    box_raw = [{"geom": "box", "params": {}, "level": hierarchy.RAW}]

    off = _svg(_spec(box_raw), df, schema, levels)
    assert "n = 6" in off and "N =" not in off   # drawn-only: subject grain hidden

    spec = _spec(box_raw)
    spec["style"]["overrides"]["show_all_levels"] = True
    on = _svg(spec, df, schema, levels)
    assert "n = 6" in on and "N = 2" in on        # toggle surfaces the subject grain


def _four_group_figure():
    """Four groups with large counts at the 140 × 100 mm default: the case where one
    `n = … N = …` line per group ran into its neighbour."""
    rows, rid = [], 0
    for grp in "ABCD":
        for s in range(2):
            for r in range(700):
                rows.append({"id": f"r{rid}", "group": grp, "subject": f"{grp}{s}",
                             "rep": r, "y": float(rid % 17)})
                rid += 1
    df, schema = pd.DataFrame(rows), _schema()
    levels, _ = hierarchy.materialize_levels(df, schema, ["subject", "rep"], {}, ["group"])
    return compiler.build_comparison_figure(df, schema, _spec([
        {"geom": "box", "params": {}, "level": hierarchy.RAW},
        {"geom": "dot", "params": {}, "level": "subject"},
    ]), {}, levels)


def test_count_labels_neither_collide_nor_leave_the_figure():
    fig = _four_group_figure()
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    labels = [t for t in fig.axes[0].texts if t.get_text().startswith("n = ")]
    boxes = [t.get_window_extent(renderer) for t in labels]
    assert len(boxes) == 4
    for left, right in zip(boxes, boxes[1:]):
        assert left.x1 < right.x0, "neighbouring count labels overlap"
    assert all(b.y0 >= 0 for b in boxes), "a count label is clipped at the figure's edge"
    compiler.close(fig)
