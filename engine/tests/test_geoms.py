"""The geom registry: single source of truth for composable layers."""
from triad_engine import geoms


def test_every_known_geom_is_registered():
    expected = {"dot", "summary", "box", "violin", "bar",
                "scatter", "regression", "histogram", "density"}
    assert set(geoms.GEOMS) == expected


def test_per_row_geoms_carry_the_point_cap():
    # dot and scatter draw one mark per row, so they declare a cap
    assert geoms.GEOMS["dot"].point_cap == geoms.POINT_CAP
    assert geoms.GEOMS["scatter"].point_cap == geoms.POINT_CAP
    # aggregating geoms draw a bounded number of marks → no cap
    assert geoms.GEOMS["bar"].point_cap is None
    assert geoms.GEOMS["bar"].aggregates is True
    assert geoms.GEOMS["dot"].aggregates is False


def test_geoms_declare_their_family_and_needs():
    assert geoms.GEOMS["dot"].family == "group_comparison"
    assert geoms.GEOMS["scatter"].family == "correlation"
    assert geoms.GEOMS["histogram"].family == "descriptive"
    assert geoms.GEOMS["dot"].needs == ["x", "y"]
    assert geoms.GEOMS["histogram"].needs == ["y"]


def test_geoms_declare_accepted_aesthetic_channels():
    # per-point geoms accept the full set; the channel order is the canonical
    # color, size, shape so the frontend can render pickers consistently
    assert geoms.GEOMS["scatter"].aes == ["color", "size", "shape"]
    assert geoms.GEOMS["dot"].aes == ["color", "size", "shape"]
    # group/aggregate geoms take a categorical color (one series per level) but
    # size/shape are meaningless on a box/bar/fit → color only
    assert geoms.GEOMS["box"].aes == ["color"]
    assert geoms.GEOMS["violin"].aes == ["color"]
    assert geoms.GEOMS["bar"].aes == ["color"]
    assert geoms.GEOMS["regression"].aes == ["color"]
    assert geoms.GEOMS["summary"].aes == ["color"]
    assert geoms.GEOMS["histogram"].aes == ["color"]
    assert geoms.GEOMS["density"].aes == ["color"]


def test_registry_payload_carries_aes():
    payload = geoms.registry_payload()
    assert payload["geoms"]["scatter"]["aes"] == ["color", "size", "shape"]
    assert payload["geoms"]["box"]["aes"] == ["color"]


def test_registry_payload_is_json_safe_and_complete():
    payload = geoms.registry_payload()
    assert payload["point_cap"] == geoms.POINT_CAP
    dot = payload["geoms"]["dot"]
    assert dot["label"] and dot["family"] == "group_comparison"
    assert dot["aggregates"] is False
    assert isinstance(dot["param_specs"], list)
    # bar exposes an error_type select so the rail can render an editor
    bar_specs = {p["key"]: p for p in payload["geoms"]["bar"]["param_specs"]}
    assert bar_specs["error_type"]["type"] == "select"
    assert "ci95" in bar_specs["error_type"]["options"]
