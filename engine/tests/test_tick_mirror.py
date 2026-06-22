"""Item O — tick mirroring as a first-class, frame-independent style knob.

Mirroring used to be an implicit side-effect of ``frame == "closed"``. Now the
per-axis side enums carry a ``"both"`` option, and a closed frame still defaults
to mirrored ticks only until the user explicitly picks a single side.
"""
from iris_engine import style as style_mod
from iris_engine.compiler import _rc


def _rc_for(overrides):
    return _rc(style_mod.resolve_style({"style": {"overrides": overrides}}))


# ---- registry exposes the new option (drives the generic StylePane) ----

def test_registry_offers_both_on_each_axis():
    payload = {e["key"]: e for e in style_mod.style_registry_payload()}
    assert payload["x_tick_side"]["widget"]["options"] == ["bottom", "top", "both"]
    assert payload["y_tick_side"]["widget"]["options"] == ["left", "right", "both"]


# ---- open frame: ticks follow the side knob exactly ----

def test_open_frame_default_is_one_sided():
    rc = _rc_for({"frame": "open"})
    assert rc["xtick.bottom"] and not rc["xtick.top"]
    assert rc["ytick.left"] and not rc["ytick.right"]


def test_open_frame_both_mirrors_ticks_without_extra_spines():
    rc = _rc_for({"frame": "open", "x_tick_side": "both", "y_tick_side": "both"})
    # ticks on both edges...
    assert rc["xtick.bottom"] and rc["xtick.top"]
    assert rc["ytick.left"] and rc["ytick.right"]
    # ...but no far-side spine (an open frame stays open; ticks float at the edge)
    assert not rc["axes.spines.top"] and not rc["axes.spines.right"]
    # labels stay on the primary side only — no duplicate tick labels
    assert rc["xtick.labelbottom"] and not rc["xtick.labeltop"]
    assert rc["ytick.labelleft"] and not rc["ytick.labelright"]


def test_open_frame_top_side_unchanged():
    rc = _rc_for({"frame": "open", "x_tick_side": "top"})
    assert rc["xtick.top"] and not rc["xtick.bottom"]
    assert rc["xtick.labeltop"] and not rc["xtick.labelbottom"]


# ---- closed frame: defaults to mirrored, but an explicit side wins ----

def test_closed_frame_default_still_mirrors():
    rc = _rc_for({"frame": "closed"})
    assert rc["xtick.bottom"] and rc["xtick.top"]
    assert rc["ytick.left"] and rc["ytick.right"]
    # all four spines (the box) regardless of ticks
    assert all(rc[f"axes.spines.{s}"] for s in ("top", "right", "bottom", "left"))
    # labels still primary-side only
    assert rc["xtick.labelbottom"] and not rc["xtick.labeltop"]


def test_closed_frame_explicit_side_overrides_mirror():
    # a closed (boxed) frame but ticks on the bottom/left only — the new control
    rc = _rc_for({"frame": "closed", "x_tick_side": "bottom", "y_tick_side": "left"})
    assert rc["xtick.bottom"] and not rc["xtick.top"]
    assert rc["ytick.left"] and not rc["ytick.right"]
    # box spines are untouched by the tick choice
    assert all(rc[f"axes.spines.{s}"] for s in ("top", "right", "bottom", "left"))


def test_closed_frame_explicit_both_still_mirrors():
    rc = _rc_for({"frame": "closed", "x_tick_side": "both"})
    assert rc["xtick.bottom"] and rc["xtick.top"]
