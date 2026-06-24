"""Translate any legacy (<2.0) analysis spec into the modern grammar shape.

The engine accepts both shapes and normalizes on every request, so an older
mappings-shaped spec keeps working. Normalization is the ONLY place the
translation happens — there is no dual-write. A modern spec (2.0/2.1) passes
through unchanged (idempotent).

Legacy:  mappings{x,y,color}            layers[{mark, options?, stat?}]
Modern:  encodings{x,y,color,size,shape} layers[{geom, params}]

`_override` carries the user's pinned test (from `stats.override`) so
statmodel.infer can honor it; `_describe_only` carries the describe-only decision
(from `stats.describe_only`). Both are read by main._run, not persisted.
"""
from __future__ import annotations

# Spec versions that already use the modern encodings/layers shape — passed
# through normalization idempotently rather than rebuilt from `mappings`.
MODERN_VERSIONS = ("2.0", "2.1")


def normalize(spec: dict) -> dict:
    if spec.get("spec_version") in MODERN_VERSIONS:
        out = dict(spec)
        out["layers"] = _migrate_dist_layers(out.get("layers", []))
        _migrate_layer_params(out)
        out.setdefault("_override", _override_of(spec))
        out.setdefault("_describe_only", _describe_only_of(spec))
        _norm_stats(out)
        return out

    out = dict(spec)
    out["spec_version"] = "2.0"

    m = spec.get("mappings", {})
    # A legacy "descriptive" spec keeps x mapped (the old frontend always set
    # it, even for histograms that ignore it). The grammar reads the family from
    # the encodings, where descriptive means "distribution of y, no grouping x",
    # so drop x — matching how the 2.0 frontend builds a descriptive spec.
    descriptive = spec.get("stats", {}).get("family") == "descriptive"
    out["encodings"] = {
        "x": None if descriptive else m.get("x"),
        "y": m.get("y"), "color": m.get("color"),
        "size": None, "shape": None,
    }
    out.pop("mappings", None)
    out["facet"] = {"row": None, "col": None, "share_x": True, "share_y": True}

    out["layers"] = _migrate_dist_layers([
        {"geom": layer["mark"], "params": dict(layer.get("options") or {}),
         "level": ""}
        for layer in spec.get("layers", [])
    ])
    _migrate_layer_params(out)
    # Data hierarchy (redesign): legacy specs carry no spine, so every layer draws
    # the raw reduced rows — today's behaviour. Aggregating to a grain is the
    # hierarchy's job (pick a level), not a reduce step.
    out["hierarchy"] = {"spine": [], "fn": {}}
    out["_override"] = _override_of(spec)
    out["_describe_only"] = _describe_only_of(spec)
    _norm_stats(out)
    return out


def _norm_stats(out: dict) -> None:
    """Preserve an explicitly declared `stats.family` (e.g. ``location``) and give
    its companions a default. The block already survives normalization (it's
    copied verbatim); this only guarantees `stats.reference` exists for a declared
    `location` family, so render/statmodel can read it without a per-call default."""
    st = out.get("stats")
    if not isinstance(st, dict) or not st.get("family"):
        return
    out["stats"] = {**st}
    if out["stats"]["family"] == "location":
        out["stats"].setdefault("reference", 0.0)
    if out["stats"]["family"] == "rate":
        # exposure (offset column) survives verbatim; default the model to NB
        # (robust to overdispersion) so render/statmodel can read it directly.
        out["stats"].setdefault("model", "nb")
        out["stats"].setdefault("exposure", None)


def _migrate_layer_params(spec: dict) -> None:
    """Move any layer-level ``params`` into ``style.overrides.geoms.<geom>``.

    Old specs (and the dist-layer migration above) place geom knobs like
    ``dist_render`` on the layer's ``params`` dict.  The compiler now reads
    these from ``resolve_geom_style`` (i.e. ``style.overrides.geoms``), so we
    hoist them here — once, idempotently — during normalization.  After
    migration the layers keep only ``geom`` + ``level``; ``params`` is dropped.
    """
    style = spec.setdefault("style", {})
    overrides = style.setdefault("overrides", {})
    geoms_ov = overrides.setdefault("geoms", {})

    for layer in spec.get("layers", []):
        params = layer.get("params")
        if not params:
            continue
        geom = layer.get("geom") or layer.get("mark", "")
        if not geom:
            continue
        dest = geoms_ov.setdefault(geom, {})
        for k, v in params.items():
            # don't overwrite an explicit override already present
            dest.setdefault(k, v)
        layer.pop("params", None)


def _migrate_dist_layers(layers: list[dict]) -> list[dict]:
    """Fold the retired `histogram`/`density` geoms into the unified
    `distribution` geom. A lone histogram → bars; a lone density → smooth (KDE,
    no bars); both together → one bars layer with a KDE overlay. Other geoms
    pass through untouched and in place. Idempotent: a spec already on
    `distribution` is returned unchanged.

    Accepts both shapes — `geom` (2.0) and `mark` (legacy) — so it can run in
    either normalize branch."""
    def kind(layer):
        return layer.get("geom") or layer.get("mark")

    if not any(kind(l) in ("histogram", "density") for l in layers):
        return layers

    hist = next((l for l in layers if kind(l) == "histogram"), None)
    dens = next((l for l in layers if kind(l) == "density"), None)
    base = hist or dens
    params = dict(base.get("params") or base.get("options") or {})
    if hist is not None and dens is not None:
        params.setdefault("dist_render", "bars")
        params["overlay_smooth"] = True
    else:
        params.setdefault("dist_render", "bars" if hist is not None else "smooth")
    merged = {"geom": "distribution", "params": params,
              "level": base.get("level", "")}

    out, placed = [], False
    for l in layers:
        if kind(l) in ("histogram", "density"):
            if not placed:  # keep the distribution where the first one sat
                out.append(merged)
                placed = True
        else:
            out.append(l)
    return out


def _override_of(spec: dict) -> str | None:
    # The pinned test rides in `stats.override`; null/absent means run the
    # recommendation.
    return spec.get("stats", {}).get("override") or None


def _describe_only_of(spec: dict) -> bool:
    # Describe-only is a stored decision (`stats.describe_only`).
    return bool(spec.get("stats", {}).get("describe_only"))
