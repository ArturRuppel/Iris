"""Translate any legacy (<2.0) analysis spec into the 2.0 grammar shape.

The engine accepts both shapes and normalizes on every request, so the old
frontend and old .viz documents keep working while the client is migrated.
Normalization is the ONLY place the translation happens — there is no
dual-write. A 2.0 spec passes through unchanged (idempotent).

Legacy:  mappings{x,y,color}            layers[{mark, options?, stat?}]
2.0:     encodings{x,y,color,size,shape} layers[{geom, params}]

`_override` carries the user's chosen test (when chosen_by == user_override)
so statmodel.infer can honor it; it is read by main._run, not persisted.
"""
from __future__ import annotations


def normalize(spec: dict) -> dict:
    if spec.get("spec_version") == "2.0":
        out = dict(spec)
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

    out["layers"] = [
        {"geom": layer["mark"], "params": dict(layer.get("options") or {}),
         "level": ""}
        for layer in spec.get("layers", [])
    ]
    # Data hierarchy (redesign): legacy specs carry no spine, so every layer draws
    # the raw reduced rows — today's behaviour. A legacy reduce.collapse still
    # works destructively for old documents; the new flow uses the hierarchy.
    out["hierarchy"] = {"spine": [], "fn": {}}
    out["_override"] = _override_of(spec)
    out["_describe_only"] = _describe_only_of(spec)
    return out


def _override_of(spec: dict) -> str | None:
    st = spec.get("stats", {})
    if st.get("chosen_by") == "user_override":
        return st.get("test")
    return None


def _describe_only_of(spec: dict) -> bool:
    return spec.get("stats", {}).get("chosen_by") == "describe_only"
