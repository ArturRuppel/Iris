"""The `rule` geom: an annotation layer — one thin line per row of its level (per
distinct value, per colour group, per facet cell) at a numeric column's value
along the primary geom's VALUE axis. Not a statistic: it never becomes an
encoding, never moves bins, and only widens the axis enough to show itself."""
import copy

import numpy as np
import pandas as pd

from iris_engine import compiler, render as render_mod, specnorm
from iris_engine.scales import PALETTE

RULE_Z = 1.5   # the zorder _draw_rules draws at


def _table(rows):
    df = pd.DataFrame(rows)
    cols = []
    for c in df.columns:
        if c == "id":
            continue
        num = pd.api.types.is_numeric_dtype(df[c])
        col = {"name": c, "type": "numeric" if num else "categorical", "label": c}
        if not num:
            col["levels"] = sorted(df[c].astype(str).unique().tolist())
        cols.append(col)
    return {"schema": {"schema_version": "1.0", "columns": cols},
            "rows": df.to_dict("records")}


def _zprofile_rows():
    """Two conditions × two fields; z per dot, a per-field constant membrane."""
    rng = np.random.default_rng(0)
    rows = []
    membrane = {("Control", "Field 1"): 10.0, ("Control", "Field 2"): 12.0,
                ("Top", "Field 1"): 8.0, ("Top", "Field 2"): 9.5}
    for (cond, fn), top in membrane.items():
        for z in rng.normal(0, 3, 40):
            rows.append({"condition": cond, "field": f"{cond} {fn[-1]}",
                         "field_number": fn, "z": float(z), "top": top})
    return rows


def _dist_spec(rule_params, *, level="", facet=True, color=True, extra_layers=(),
               off=True, style=None):
    return {
        "spec_version": "2.2", "id": "z", "title": "z",
        "encodings": {"x": None, "y": {"column": "z"},
                      "color": {"column": "field_number"} if color else None,
                      "size": None, "shape": None},
        "facet": {"row": None, "col": {"column": "condition"} if facet else None,
                  "share_x": True, "share_y": True},
        "hierarchy": {"spine": ["field"], "fn": {"field": "sum"}},
        "layers": [{"geom": "distribution", "level": ""},
                   {"geom": "rule", "level": level, "params": dict(rule_params)},
                   *extra_layers],
        "stats": {"family": "descriptive", "describe_only": True, "alpha": 0.05,
                  "off": off},
        "style": {"overrides": dict(style or {})},
    }


def _render(rows, spec):
    fig, *_ = render_mod.render(_table(rows), spec)
    return fig


def _rules(ax):
    return [l for l in ax.get_lines() if l.get_zorder() == RULE_Z]


def _vertical_values(ax):
    out = []
    for l in _rules(ax):
        xs = l.get_xdata()
        assert xs[0] == xs[1]           # axvline: constant x, spans the axes
        out.append(float(xs[0]))
    return sorted(out)


def _labels(fig):
    return [t for ax in fig.axes for t in ax.texts if "rule-label" in (t.get_gid() or "")]


def _data_axes(fig):
    return [ax for ax in fig.axes if ax.get_title()]


def test_rule_params_survive_normalisation_on_the_layer():
    spec = _dist_spec({"column": "top", "label": "top"})
    out = specnorm.normalize(copy.deepcopy(spec))
    rule = [l for l in out["layers"] if l["geom"] == "rule"][0]
    assert rule["params"]["column"] == "top"
    assert "rule" not in out["style"]["overrides"].get("geoms", {})


def test_raw_level_draws_one_vertical_line_per_distinct_value_per_group_per_facet():
    fig = _render(_zprofile_rows(), _dist_spec({"column": "top"}))
    by_title = {ax.get_title(): ax for ax in _data_axes(fig)}
    assert _vertical_values(by_title["condition = Control"]) == [10.0, 12.0]
    assert _vertical_values(by_title["condition = Top"]) == [8.0, 9.5]
    compiler.close(fig)


def test_raw_level_dedupes_after_rounding():
    rows = _zprofile_rows()
    for i, r in enumerate(rows):   # float noise well below 1e-9
        r["top"] = r["top"] + (1e-12 if i % 2 else -1e-12)
    fig = _render(rows, _dist_spec({"column": "top"}))
    for ax in _data_axes(fig):
        assert len(_rules(ax)) == 2   # two fields per condition, not ~40 lines
    compiler.close(fig)


def test_field_level_collapses_with_the_hierarchy():
    # level "field" collapses with the analysis hierarchy's fn (here mean)
    rows = _zprofile_rows()
    spec = _dist_spec({"column": "top"}, level="field")
    spec["hierarchy"]["fn"] = {"field": "mean"}
    fig = _render(rows, spec)
    by_title = {ax.get_title(): ax for ax in _data_axes(fig)}
    assert _vertical_values(by_title["condition = Control"]) == [10.0, 12.0]
    compiler.close(fig)


def test_each_line_takes_its_colour_group_swatch():
    fig = _render(_zprofile_rows(), _dist_spec({"column": "top"}))
    ax = {a.get_title(): a for a in _data_axes(fig)}["condition = Control"]
    by_value = {float(l.get_xdata()[0]): l.get_color() for l in _rules(ax)}
    # field_number levels ["Field 1", "Field 2"] → palette 0, 1
    assert by_value[10.0].lower() == PALETTE[0].lower()
    assert by_value[12.0].lower() == PALETTE[1].lower()
    # behind the bars, thin, dashed by default
    line = _rules(ax)[0]
    assert line.get_linewidth() == 0.8
    assert line.get_linestyle() == "--"
    bars = [p for p in ax.patches if p.get_zorder() == 2]
    assert bars and all(p.get_zorder() > RULE_Z for p in bars)
    compiler.close(fig)


def test_linestyle_and_linewidth_params():
    fig = _render(_zprofile_rows(), _dist_spec(
        {"column": "top", "linestyle": "solid", "linewidth": 1.6}))
    line = _rules(_data_axes(fig)[0])[0]
    assert line.get_linestyle() == "-"
    assert line.get_linewidth() == 1.6
    compiler.close(fig)


def test_label_where_first_all_none():
    first = _render(_zprofile_rows(), _dist_spec({"column": "top", "label": "top membrane"}))
    labs = _labels(first)
    assert len(labs) == 1 and labs[0].get_text() == "top membrane"
    assert labs[0].axes is _data_axes(first)[0]
    assert labs[0].get_rotation() == 90
    compiler.close(first)

    every = _render(_zprofile_rows(), _dist_spec(
        {"column": "top", "label": "top", "label_where": "all"}))
    # once per facet cell (2 cells), not once per line (4 lines)
    assert len(_labels(every)) == 2
    assert {t.axes for t in _labels(every)} == set(_data_axes(every))
    compiler.close(every)

    none = _render(_zprofile_rows(), _dist_spec(
        {"column": "top", "label": "top", "label_where": "none"}))
    assert _labels(none) == []
    compiler.close(none)


def test_label_once_per_cell_per_layer_with_two_rule_layers():
    rows = _zprofile_rows()
    for r in rows:
        r["bottom"] = r["top"] - 20
    spec = _dist_spec({"column": "top", "label": "top", "label_where": "all"},
                      extra_layers=[{"geom": "rule", "level": "",
                                     "params": {"column": "bottom", "label": "bottom",
                                                "label_where": "all"}}])
    fig = _render(rows, spec)
    assert sorted(t.get_text() for t in _labels(fig)) == ["bottom", "bottom", "top", "top"]
    compiler.close(fig)


def test_rule_column_does_not_touch_bins_or_encodings():
    rows = _zprofile_rows()
    base = _dist_spec({"column": "top"})
    base["layers"] = base["layers"][:1]
    plain = _render(rows, base)
    ruled = _render(rows, _dist_spec({"column": "top"}))
    def heights(fig):
        return [[round(p.get_height(), 9) for p in ax.patches] for ax in _data_axes(fig)]
    assert heights(plain) == heights(ruled)
    # the y (count) axis is not moved by a vertical rule
    assert _data_axes(plain)[0].get_ylim() == _data_axes(ruled)[0].get_ylim()
    compiler.close(plain)
    compiler.close(ruled)


def test_out_of_range_line_extends_the_value_axis():
    rows = _zprofile_rows()
    for r in rows:
        r["far"] = 60.0          # data |z| stays under ~12
    fig = _render(rows, _dist_spec({"column": "far"}))
    for ax in _data_axes(fig):
        lo, hi = ax.get_xlim()
        assert hi > 60.0 and lo < 0
    compiler.close(fig)


def test_pinned_axis_end_is_not_overridden():
    rows = _zprofile_rows()
    for r in rows:
        r["far"] = 60.0
    fig = _render(rows, _dist_spec({"column": "far"}, style={"x_max": 20}))
    for ax in _data_axes(fig):
        assert ax.get_xlim()[1] == 20
    compiler.close(fig)


def test_unfaceted_uncoloured_distribution():
    fig = _render(_zprofile_rows(), _dist_spec({"column": "top"}, facet=False,
                                                color=False))
    ax = fig.axes[0]
    assert _vertical_values(ax) == [8.0, 9.5, 10.0, 12.0]
    assert {l.get_color().lower() for l in _rules(ax)} == {PALETTE[0].lower()}
    compiler.close(fig)


def test_stats_on_distribution_also_draws_the_rule():
    fig = _render(_zprofile_rows(), _dist_spec({"column": "top"}, off=False))
    assert sum(len(_rules(ax)) for ax in _data_axes(fig)) == 4
    compiler.close(fig)


def test_categorical_plot_draws_horizontal_rules_at_the_value():
    rows = []
    for g, ref in (("a", 5.0), ("b", 7.0)):
        for i in range(6):
            rows.append({"group": g, "rep": f"{g}{i % 2}", "v": float(i), "ref": ref})
    spec = {
        "spec_version": "2.2", "id": "c", "title": "c",
        "encodings": {"x": {"column": "group"}, "y": {"column": "v"},
                      "color": {"column": "group"}, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": [], "fn": {}},
        "layers": [{"geom": "box", "level": ""},
                   {"geom": "rule", "level": "",
                    "params": {"column": "ref", "label": "ref"}}],
        "stats": {"alpha": 0.05, "off": True},
        "style": {"overrides": {}},
    }
    fig, res, *_ = render_mod.render(_table(rows), spec)
    ax = fig.axes[0]
    rules = _rules(ax)
    assert len(rules) == 2
    ys = sorted(float(l.get_ydata()[0]) for l in rules)
    assert ys == [5.0, 7.0]
    for l in rules:
        assert l.get_ydata()[0] == l.get_ydata()[1]   # axhline
    labs = _labels(fig)
    assert len(labs) == 1 and labs[0].get_rotation() == 0
    compiler.close(fig)


def test_rule_level_does_not_move_the_inferential_grain():
    rows = []
    for g in ("a", "b"):
        for rep in range(3):
            for i in range(4):
                rows.append({"group": g, "rep": f"{g}{rep}", "v": float(i + rep),
                             "ref": 3.0})
    spec = {
        "spec_version": "2.2", "id": "c", "title": "c",
        "encodings": {"x": {"column": "group"}, "y": {"column": "v"},
                      "color": None, "size": None, "shape": None},
        "facet": {"row": None, "col": None, "share_x": True, "share_y": True},
        "hierarchy": {"spine": ["rep"], "fn": {"rep": "mean"}},
        "layers": [{"geom": "dot", "level": ""},
                   {"geom": "rule", "level": "rep", "params": {"column": "ref"}}],
        "stats": {"alpha": 0.05},
        "style": {"overrides": {}},
    }
    fig, res, df, schema, model, *_ = render_mod.render(_table(rows), spec)
    assert model["inferential_level"] == ""
    assert len(_rules(fig.axes[0])) == 1
    compiler.close(fig)


def test_assembly_renders_a_ruled_panel():
    from iris_engine import assembly
    rows = _zprofile_rows()
    table = _table(rows)
    spec = _dist_spec({"column": "top", "label": "top"})
    spec["table_id"] = "t"
    spec["tag"] = "A"
    fig = assembly.render_figure({"t": table}, [spec], {"panels": ["z"]})
    lines = [l for ax in fig.get_axes() for l in _rules(ax)]
    assert len(lines) == 4
    assert len(_labels(fig)) == 1
    compiler.close(fig)
