"""Side-by-side figure panels (spec 2.3 Stage 2): layers tagged with a `panel`
draw into their own axes, so one analysis's figure can show the same comparison
at different pipeline stages side by side. A single (or absent) panel tag is the
unchanged single-axes path; faceting takes precedence (the combo is deferred)."""
import matplotlib
matplotlib.use("Agg")
import pandas as pd

from iris_engine import compiler, hierarchy


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


def _spec(layers, facet=None):
    return {"spec_version": "2.0", "encodings": {
                "x": {"column": "group"}, "y": {"column": "y"},
                "color": None, "size": None, "shape": None},
            "facet": facet or {"row": None, "col": None,
                               "share_x": True, "share_y": True},
            "layers": layers, "style": {"overrides": {}}}


def _levels(df, schema):
    lv, _ = hierarchy.materialize_levels(df, schema, ["subject", "rep"], {}, ["group"])
    return lv


def test_single_panel_is_one_axes():
    """No panel tag → today's single-axes figure, unchanged."""
    df, schema = _df(), _schema()
    fig = compiler.build_comparison_figure(
        df, schema, _spec([{"geom": "box", "params": {}, "level": hierarchy.RAW}]),
        {}, _levels(df, schema))
    assert len(fig.axes) == 1
    compiler.close(fig)


def test_two_panels_render_side_by_side():
    """Two panel tags → two side-by-side axes, each drawing its own layer."""
    df, schema = _df(), _schema()
    spec = _spec([
        {"geom": "box", "params": {}, "level": hierarchy.RAW, "panel": 0},
        {"geom": "dot", "params": {}, "level": "subject", "panel": 1},
    ])
    fig = compiler.build_comparison_figure(df, schema, spec, {}, _levels(df, schema))
    assert len(fig.axes) == 2      # raw box in panel 0, subject dots in panel 1
    compiler.close(fig)


def test_three_panels_render_three_axes():
    df, schema = _df(), _schema()
    spec = _spec([
        {"geom": "box", "params": {}, "level": hierarchy.RAW, "panel": 0},
        {"geom": "dot", "params": {}, "level": "subject", "panel": 1},
        {"geom": "violin", "params": {}, "level": hierarchy.RAW, "panel": 2},
    ])
    fig = compiler.build_comparison_figure(df, schema, spec, {}, _levels(df, schema))
    assert len(fig.axes) == 3
    compiler.close(fig)


def test_faceting_takes_precedence_over_panels():
    """The panels×faceting combo is deferred: a faceted spec ignores panel tags
    (draws every layer in each facet cell), so a 2-level col facet is 2 axes, not
    2×n_panels — the frontend prevents authoring the mix."""
    df, schema = _df(), _schema()
    spec = _spec([
        {"geom": "box", "params": {}, "level": hierarchy.RAW, "panel": 0},
        {"geom": "dot", "params": {}, "level": "subject", "panel": 1},
    ], facet={"row": None, "col": {"column": "group"},
              "share_x": True, "share_y": True})
    fig = compiler.build_comparison_figure(df, schema, spec, {}, _levels(df, schema))
    assert len(fig.axes) == 2      # two facet columns, panels ignored
    compiler.close(fig)
