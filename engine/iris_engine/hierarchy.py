"""Data hierarchy: a spine of nested grouping columns (coarsest → finest) plus
per-layer level selection. Replaces the destructive `reduce.collapse` step and
the Phase-5 `repetition_key` / `stat.per_unit` machinery (see
docs/superpowers/specs/2026-06-16-data-hierarchy-redesign.md).

The spine, e.g. ``["date", "position_id", "cell_id", "frame"]`` (coarse → fine),
defines *grain*. Picking a **level** L keeps every spine column from the root
down to and including L and aggregates everything finer (numeric measures by the
level's ``fn``, default mean). "Average away frames" is just *pick level
``cell_id``* — no complement to declare.

Collapsing is **sequential (nested)**, not a single pool of raw leaves: each
level is built by aggregating the table of the *immediately finer* level, which
was itself built from the level below. So a coarse value is a summary *of
summaries* — ``median`` at every level means median-of-medians, with each child
weighted equally regardless of how many leaves it holds. This is the
pseudoreplication-correct reduction (the nested-means a mixed model with random
intercepts for each spine level computes implicitly); pooling raw leaves at the
coarsest grain would instead weight a unit by its descendant count, which an
unbalanced design (uneven cells/field, fields/experiment) silently distorts.

`materialize_levels` produces one table per level **once**, finest → coarsest,
each carrying a ``row_ids`` column — the provenance list of raw row ids each
coarse unit aggregates (unioned up the chain, so it still resolves to raw).

Pure pandas — no matplotlib, no FastAPI.
"""
from __future__ import annotations

import pandas as pd

_AGG = {"mean": "mean", "median": "median", "sum": "sum", "min": "min", "max": "max"}

# the finest, fully-resolved grain (every reduced row stands alone). Offered
# alongside the spine columns so a layer can draw truly raw points even when the
# finest spine level still aggregates (it usually doesn't, but the option is free).
RAW = ""


def spine_present(df: pd.DataFrame, spine: list[str]) -> list[str]:
    """The spine restricted to columns that survived the reduction, order kept."""
    return [s for s in (spine or []) if s in df.columns]


def _concat_ids(lists) -> list:
    """Flatten a group's ``row_ids`` (a column of lists) into one list — the raw
    ids the coarse unit aggregates, chained up from the finer level."""
    return [i for sub in lists for i in sub]


def _level_table(src: pd.DataFrame, schema: dict, grain: list[str],
                 agg_fn: str) -> tuple[pd.DataFrame, dict]:
    """One grain's table, built from the *immediately finer* source table `src`
    (which already carries one row per finer unit plus a ``row_ids`` provenance
    column). Group `src` by `grain`, aggregate its numeric measures by `agg_fn`
    (so coarsening a level that was itself aggregated gives a nested summary —
    e.g. median-of-medians), carry categorical/identifier columns that stay
    single-valued within the grain (drop the rest — you can't average a
    category), and union each group's `row_ids` so provenance still resolves to
    raw."""
    cols = {c["name"]: c for c in schema["columns"]}
    measures = [c["name"] for c in schema["columns"]
                if c["type"] == "numeric" and c["name"] in src and c["name"] not in grain]
    others = [c["name"] for c in schema["columns"]
              if c["type"] in ("categorical", "identifier")
              and c["name"] in src and c["name"] not in grain]

    g = src.groupby(grain, observed=True, sort=False)
    # a qualifier "carries" iff it is single-valued within every grain group;
    # otherwise it is multi-valued at this grain and is dropped.
    carried = [c for c in others if int(g[c].nunique(dropna=False).max() or 0) <= 1]

    agg: dict[str, object] = {m: _AGG.get(agg_fn, "mean") for m in measures}
    agg["row_ids"] = _concat_ids
    for c in carried:
        agg[c] = "first"
    out = g.agg(agg).reset_index()
    out.insert(0, "id", [f"{'_'.join(grain)}#{i + 1}" for i in range(len(out))])

    new_cols = ([cols[c] for c in grain] + [cols[c] for c in carried]
                + [cols[m] for m in measures])
    return out.reset_index(drop=True), {**schema, "columns": new_cols}


def _grain_key(kept: list[str]) -> str:
    """Kept dims (already in spine order) joined by '/'; '' = raw."""
    return "/".join(kept)


def default_plan(spine: list[str], fn: dict | None = None) -> list[dict]:
    """The forced chain as a plan: full-spine prefix chain, finest -> coarsest.
    Step i keeps the prefix spine[:i] for i = len..1; fn from the finest kept dim."""
    fn = fn or {}
    return [{"keep": list(spine[:i]), "fn": fn.get(spine[i - 1], "mean")}
            for i in range(len(spine), 0, -1)]


def materialize_plan(
    df: pd.DataFrame, schema: dict, plan: list[dict],
    split_cols: list[str] | None = None,
) -> dict[str, tuple[pd.DataFrame, dict]]:
    """General collapse: walk `plan` (ordered steps `{keep, fn}`) from raw. Each
    step groups the *previous* table by its `keep` dims (+ split) and aggregates
    with the step's `fn` via `_level_table` — so collapsing stays nested
    (median-of-medians), the step list is the routing, and a step may drop several
    dims (a pooled skip) or keep a finer dim while dropping a coarser one (a
    non-prefix grain). Returns one (df, schema) per step, keyed by grain key
    (kept dims joined by '/', '' = raw)."""
    split = [c for c in (split_cols or []) if c in df.columns]
    raw = df.copy()
    raw["row_ids"] = [[i] for i in raw["id"].tolist()]
    grains: dict[str, tuple[pd.DataFrame, dict]] = {RAW: (raw, schema)}

    src, src_schema = raw, schema
    for step in plan:
        keep = [c for c in step["keep"] if c in df.columns]
        if not keep:
            continue
        grain = list(dict.fromkeys(keep + split))
        agg = step.get("fn") if step.get("fn") in _AGG else "mean"
        tbl = _level_table(src, src_schema, grain, agg)
        grains[_grain_key(keep)] = tbl
        src, src_schema = tbl
    return grains


def materialize_levels(
    df: pd.DataFrame, schema: dict, spine: list[str],
    fn: dict[str, str] | None = None, split_cols: list[str] | None = None,
) -> tuple[dict[str, tuple[pd.DataFrame, dict]], list[str]]:
    """The forced finest -> coarsest chain, kept for callers that key levels by a
    single spine-column name. Thin adapter over `materialize_plan` + the default
    plan."""
    present = spine_present(df, spine)
    grains = materialize_plan(df, schema, default_plan(present, fn or {}), split_cols)
    levels: dict[str, tuple[pd.DataFrame, dict]] = {}
    for key, tbl in grains.items():
        kept = key.split("/") if key else []
        levels[kept[-1] if kept else RAW] = tbl
    return levels, present


def resolve_level(levels: dict, level: str | None) -> tuple[pd.DataFrame, dict]:
    """The table for a requested level, falling back to RAW when the level is
    unknown (e.g. a spine column dropped by the reduction) so a stale level never
    blanks the figure."""
    return levels.get(level or RAW) or levels[RAW]


def trajectory_units(df: pd.DataFrame, spine: list[str], x_col: str,
                     split_cols: list[str] | None = None) -> list[str]:
    """Grouping keys that identify one trajectory (curve) for the `line` geom —
    "which rows form one line". A unit is the spine columns *coarser than* the x
    axis (the sub-identities that persist as x advances), plus any `split_cols`
    (the colour qualifier). With the default spine
    ``date → position_id → cell_id → frame`` and ``x=frame``, the unit is
    ``(date, position_id, cell_id)`` — one curve per cell, drawn in frame order.

    When `x_col` is off the spine (or there is no spine) there is no coarser
    unit, so the whole (reduced, split) frame is a single curve — the "one series
    over time" case, for free. Columns absent from `df` are dropped. The result
    is de-duplicated, order-preserving, so a column used both as x-context and as
    colour can't land in the grouping twice."""
    present = spine_present(df, spine)
    split = [c for c in (split_cols or []) if c in df.columns]
    unit = present[: present.index(x_col)] if x_col in present else []
    return list(dict.fromkeys(unit + split))


def coarsest_level(present_spine: list[str], layer_levels: list[str]) -> str:
    """The coarsest level among the levels the figure's layers are bound to — the
    grain the inferential test reads, so plot and stats share one materialization
    (no parallel raw-vs-level route). `present_spine` is coarse → fine; RAW ("") is
    finer than every spine level. Layers at RAW (or none on the spine) → RAW, i.e.
    the test runs on the raw reduced rows, matching the spineless default."""
    idxs = [present_spine.index(lv) for lv in layer_levels if lv in present_spine]
    return present_spine[min(idxs)] if idxs else RAW


# --------------------------------------------------------------------------- #
# Pairing: paired vs. unpaired follows from the spine, not a user declaration.
# --------------------------------------------------------------------------- #

def home_level(df: pd.DataFrame, spine: list[str], qualifier: str) -> str | None:
    """The coarsest spine grain at which `qualifier` is single-valued (its
    *home*). Returns None if the qualifier is absent. Below/at home a comparison
    by it is unpaired (each unit sees one level); coarser than home it can pair."""
    if qualifier not in df.columns:
        return None
    for i in range(len(spine)):
        grain = spine[: i + 1]
        if int(df.groupby(grain, observed=True)[qualifier].nunique().max() or 0) <= 1:
            return spine[i]
    return spine[-1] if spine else None


def describe_hierarchy(df: pd.DataFrame, spine: list[str],
                       classifiers: list[str]) -> dict:
    """Summarize the hierarchy for the Data-tab editor/visualization: each spine
    level's grain cardinality, and where each classifier *attaches* — its home
    level (the coarsest grain at which it is single-valued). class_label lives at
    the cell level, condition at the date level, etc. Tolerant of columns dropped
    by reduction."""
    present = spine_present(df, spine)
    levels = [{"name": lv, "n_groups": int(
                  df.groupby(present[: i + 1], observed=True).ngroups)}
              for i, lv in enumerate(present)]
    cls = []
    for c in classifiers:
        if c not in df.columns:
            continue
        cls.append({"name": c, "home": home_level(df, present, c),
                    "n_levels": int(df[c].dropna().nunique())})
    return {"spine": present, "levels": levels, "classifiers": cls,
            "n_raw": int(len(df))}


def pairing(df: pd.DataFrame, spine: list[str], qualifier: str | None,
            inferential_level: str | None = None) -> dict | None:
    """Verdict for comparing `qualifier`'s levels, derived from the spine.

    Pairing depends on the **grain the test runs at** (`inferential_level`):

    * **Block grain** — when the test compares per-block aggregates at a level
      *coarser than* the qualifier's home (a SuperPlot summarizes to this level
      before testing), the block is a shared unit between the qualifier's levels,
      so *containment* — each block carrying all levels, even via different
      sub-units — is a legitimate pairing of the block-level means. E.g. a
      classifier that splits the cells of each experiment into `+` / `-`: the two
      class means within an experiment are paired *by experiment*.

    * **Raw grain** — with no inferential level (or one at/finer than the home),
      the comparison is between raw home-level entities, so pairing requires the
      *same* sub-identity observed under every level (true repeated measures), not
      mere containment. A field of view holding both `+` and `-` cells is then
      unpaired (different cells), whereas the same cell seen as both is paired.

    The verdict is three-valued because real data has holes:
      - "paired"            every unit carries all levels
      - "partially_paired"  some but not all units do (drop-outs)
      - "unpaired"          none do, or there is no coarser unit
    `across` names the unit level the pairing runs over. Stats consume this later
    (paired vs. unpaired test); here we only detect and surface it.
    Returns None when the qualifier is not a spine-orthogonal categorical."""
    if not qualifier or qualifier in spine or qualifier not in df.columns:
        return None
    home = home_level(df, spine, qualifier)
    if home is None:
        return None
    home_idx = spine.index(home) if home in spine else len(spine)
    if home_idx == 0:  # nothing coarser than the qualifier's home → cannot pair
        return {"qualifier": qualifier, "verdict": "unpaired", "across": None,
                "unit_cols": [], "n_units": 0, "n_complete": 0,
                "reason": "no unit coarser than the comparison's natural level"}

    qlevels = set(df[qualifier].dropna().unique())
    inf_idx = spine.index(inferential_level) if inferential_level in spine else None

    if inf_idx is not None and inf_idx < home_idx:
        # Block grain: the test reads per-block means, so containment at the block
        # (the inferential unit) pairs those means — by-experiment / by-replicate.
        unit_cols = spine[: inf_idx + 1]
        across = spine[inf_idx]
        sub = df[[*unit_cols, qualifier]].dropna(subset=[qualifier])
        per_unit = sub.groupby(unit_cols, observed=True)[qualifier].nunique()
        n_units = int(len(per_unit))
        n_complete = int((per_unit == len(qlevels)).sum())
    else:
        # Raw grain: pairing requires the same sub-identity under every level.
        unit_cols = spine[:home_idx]
        across = spine[home_idx - 1]
        home_col = spine[home_idx]        # sub-identity the qualifier sits on
        sub = df[[*unit_cols, home_col, qualifier]].dropna(subset=[qualifier])
        # A (unit, sub-identity) "crosses" when that one home entity is seen under
        # every level; a unit is paired-complete when it has ≥1 such entity.
        crosses = (sub.groupby([*unit_cols, home_col], observed=True)[qualifier]
                      .agg(lambda s: qlevels.issubset(set(s))))
        n_units = int(sub.groupby(unit_cols, observed=True).ngroups)
        n_complete = int(crosses[crosses].reset_index()
                         .groupby(unit_cols, observed=True).ngroups) if crosses.any() else 0

    verdict = ("paired" if n_units and n_complete == n_units
               else "partially_paired" if n_complete else "unpaired")
    return {"qualifier": qualifier, "verdict": verdict, "across": across,
            "unit_cols": list(unit_cols), "n_units": n_units,
            "n_complete": n_complete, "levels": sorted(map(str, qlevels))}


def _coarsest_grain(grains) -> str:
    """The grain with the fewest kept dims, excluding raw ('' is the finest, not
    the coarsest, so it only wins when it is the only node). `grains` is any
    iterable of grain keys (a dict or a list)."""
    non_raw = [k for k in grains if k]
    return min(non_raw, key=lambda k: len(k.split("/"))) if non_raw else RAW


def pseudoreplication(df: pd.DataFrame, plan: list[dict], test_grain: str) -> dict:
    """#1: the test reads a grain finer than the coarsest available node, so its
    units are nested in a coarser one (correlated measurements treated as
    independent). n at a grain is its distinct-group count — path-independent, so
    we count directly with groupby (no aggregation, no schema, so string spine
    columns can't trip an aggregate). Returns the risk flag, n at the chosen vs
    coarsest grain, and the coarsest grain key — enough to name the safer option."""
    keys = [RAW] + [_grain_key([c for c in s["keep"] if c in df.columns]) for s in plan]

    def n_for(key: str) -> int:
        dims = [d for d in key.split("/") if d in df.columns] if key else []
        return int(df.groupby(dims, observed=True).ngroups) if dims else int(len(df))

    coarsest = _coarsest_grain(keys)
    return {"risk": test_grain != coarsest,
            "n_test": n_for(test_grain),
            "n_coarsest": n_for(coarsest),
            "coarsest_grain": coarsest}


def _grain_inferential_level(grain: str) -> str:
    return grain.split("/")[-1] if grain else RAW


def pairing_flip(df: pd.DataFrame, spine: list[str], qualifier: str | None,
                 default_grain: str, chosen_grain: str) -> dict:
    """#2: re-routing/retargeting can change the pairing verdict (derived from the
    spine + the inferential grain). Run `pairing` at the default grain and the
    chosen grain; report whether the verdict changed."""
    def verdict(grain: str):
        p = pairing(df, spine, qualifier,
                    inferential_level=_grain_inferential_level(grain))
        return p["verdict"] if p else None
    frm, to = verdict(default_grain), verdict(chosen_grain)
    chosen = pairing(df, spine, qualifier,
                     inferential_level=_grain_inferential_level(chosen_grain))
    return {"flipped": frm is not None and to is not None and frm != to,
            "from": frm, "to": to, "across": (chosen or {}).get("across")}


def identity_merge(df: pd.DataFrame, schema: dict, spine: list[str],
                   plan: list[dict]) -> list[dict]:
    """#4: dropping a dim D merges distinct units ONLY when a KEPT dim finer than
    D is an `identifier` (its labels may repeat across D) and loses distinctness.
    Numeric/coordinate kept dims never trigger it; dropping a dim with no finer
    kept identifier (the default chain, or pooling with nothing finer kept) is
    exempt. Detection is exact: distinct count of (kept identifiers) with vs
    without D."""
    types = {c["name"]: c["type"] for c in schema["columns"]}
    present = spine_present(df, spine)
    pos = {d: i for i, d in enumerate(present)}
    merges: list[dict] = []
    prev = list(present)            # raw carries the full spine identity
    for step in plan:
        keep = [c for c in step["keep"] if c in present]
        removed = [d for d in prev if d not in keep]
        kept_ids = [d for d in keep if types.get(d) == "identifier"]
        for dim in removed:
            if dim not in pos:
                continue
            finer_kept_ids = [c for c in kept_ids if pos[c] > pos[dim]]
            if not finer_kept_ids:
                continue            # nothing finer kept -> intentional pooling
            before = df.groupby(kept_ids + [dim], observed=True).ngroups
            after = df.groupby(kept_ids, observed=True).ngroups
            if after < before:
                merges.append({"dim": dim, "kept": kept_ids,
                               "before": int(before), "after": int(after)})
        prev = keep
    return merges


def join_leaf_key(df, schema, spine, steps) -> list[dict]:
    """Warn (never block) when a `join` keys on a leaf identifier without its spine
    ancestors and that leaf isn't unique on its own — the merge may mismatch units.
    Returns [{dim, on, suggested, before, after, severity, text}] per offending join."""
    ids = {c["name"] for c in schema.get("columns", []) if c.get("type") == "identifier"}
    present = [s for s in spine if s in df.columns]
    out: list[dict] = []
    for i, step in enumerate(steps or []):
        if step.get("kind") != "join":
            continue
        on = list(step.get("on") or [])
        # the deepest spine identifier among the join keys
        leaves = [k for k in on if k in ids and k in present]
        if not leaves:
            continue
        leaf = max(leaves, key=lambda k: present.index(k))
        ancestors = present[: present.index(leaf)]
        missing = [a for a in ancestors if a not in on]
        if not missing:
            continue
        # is the leaf actually ambiguous on its own? (same value across ancestors)
        if leaf not in df.columns:
            continue
        per_leaf = df.groupby(leaf, observed=True)[missing].nunique()
        ambiguous = bool((per_leaf.max(axis=1) > 1).any())
        if not ambiguous:
            continue
        full = ", ".join(present[: present.index(leaf) + 1])
        out.append({
            "step": i,
            "dim": leaf, "on": on, "suggested": present[: present.index(leaf) + 1],
            "before": leaf, "after": full, "severity": "caution",
            "text": (f"Joining on {leaf} alone, but {leaf} isn't unique without "
                     f"{', '.join(missing)} — did you mean the full path {full}?"),
        })
    return out


def post_aggregate_derive(post_steps: list[dict] | None, test_grain: str) -> list[dict]:
    """#5 (post-collapse): a `derive` in the post-collapse reduce phase computes its
    value on ALREADY-AGGREGATED rows, where the raw-grain safety of a normal derive
    no longer holds — its inputs are sums/medians over collapsed units, so what the
    result means depends on the grain it runs at. Not a wall: §3's log2(Σobs/Σexp)
    and §4's het are legitimate post-aggregate derives; the guard just names the
    grain and the step so the user confirms the derive is intended there. One
    caution verdict per post-phase derive."""
    grain = test_grain or RAW
    where = grain if grain else RAW
    return [{"step_index": i, "grain": grain,
             "reason": (f"derive {s.get('column')!r} runs on the {where} grain "
                        "(post-aggregate): its inputs are already summarized, so "
                        "the result's meaning depends on this grain")}
            for i, s in enumerate(post_steps or []) if s.get("kind") == "derive"]
