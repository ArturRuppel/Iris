"""Translate any legacy (<2.0) analysis spec into the 2.0 grammar shape.

The engine accepts both shapes and normalizes on every request, so the old
frontend and old .viz documents keep working while the client is migrated.
Normalization is the ONLY place the translation happens — there is no
dual-write. A 2.0 spec passes through unchanged (idempotent).

Legacy:  mappings{x,y,color}            layers[{mark, options?, stat?}]
2.0:     encodings{x,y,color,size,shape} layers[{geom, params}]

`_override` carries the user's pinned test (from `stats.override`, or the legacy
chosen_by == user_override signal) so statmodel.infer can honor it; it is read by
main._run, not persisted.
"""
from __future__ import annotations


def normalize(spec: dict) -> dict:
    if spec.get("spec_version") == "2.0":
        out = dict(spec)
        out["layers"] = _migrate_dist_layers(out.get("layers", []))
        out.setdefault("_override", _override_of(spec))
        out.setdefault("_describe_only", _describe_only_of(spec))
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
    # Data hierarchy (redesign): legacy specs carry no spine, so every layer draws
    # the raw reduced rows — today's behaviour. Aggregating to a grain is the
    # hierarchy's job (pick a level), not a reduce step.
    out["hierarchy"] = {"spine": [], "fn": {}}
    out["_override"] = _override_of(spec)
    out["_describe_only"] = _describe_only_of(spec)
    return out


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
    # The pinned test rides in `stats.override` (decoupled from the chosen_by
    # provenance label). Fall back to the legacy chosen_by == user_override
    # signal so pre-decoupling specs still carry the user's pin.
    st = spec.get("stats", {})
    if st.get("override"):
        return st.get("override")
    if st.get("chosen_by") == "user_override":
        return st.get("test")
    return None


def _describe_only_of(spec: dict) -> bool:
    return spec.get("stats", {}).get("chosen_by") == "describe_only"
