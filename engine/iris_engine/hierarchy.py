"""Data hierarchy: a spine of nested grouping columns (coarsest → finest) plus
per-layer level selection. Replaces the destructive `reduce.collapse` step and
the Phase-5 `repetition_key` / `stat.per_unit` machinery (see
docs/superpowers/specs/2026-06-16-data-hierarchy-redesign.md).

The spine, e.g. ``["date", "position_id", "cell_id", "frame"]`` (coarse → fine),
defines *grain*. Picking a **level** L keeps every spine column from the root
down to and including L and aggregates everything finer (numeric measures by the
level's ``fn``, default mean). "Average away frames" is just *pick level
``cell_id``* — no complement to declare.

`materialize_levels` produces one table per level **once**, each carrying a
``row_ids`` column (the list of raw row ids it aggregates) so click-to-exclude on
a coarse mark still drops every underlying raw row. Because every grain is a
*prefix* of the spine, each level can be computed directly from the (reduced)
raw frame — the prefixes nest, so the id lists chain implicitly.

Pure pandas — no matplotlib, no FastAPI. The caller removes excluded rows first.
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


def _level_table(df: pd.DataFrame, schema: dict, grain: list[str],
                 agg_fn: str) -> tuple[pd.DataFrame, dict]:
    """One grain's table: group `df` by `grain`, aggregate finer numeric measures
    by `agg_fn`, carry categorical/identifier columns that stay single-valued
    within the grain (drop the rest — you can't average a category), and collect
    each group's raw ids into `row_ids`."""
    cols = {c["name"]: c for c in schema["columns"]}
    measures = [c["name"] for c in schema["columns"]
                if c["type"] == "numeric" and c["name"] in df and c["name"] not in grain]
    others = [c["name"] for c in schema["columns"]
              if c["type"] in ("categorical", "identifier")
              and c["name"] in df and c["name"] not in grain]

    g = df.groupby(grain, observed=True, sort=False)
    # a qualifier "carries" iff it is single-valued within every grain group;
    # otherwise it is multi-valued at this grain and is dropped.
    carried = [c for c in others if int(g[c].nunique(dropna=False).max() or 0) <= 1]

    agg: dict[str, object] = {m: _AGG.get(agg_fn, "mean") for m in measures}
    agg["id"] = list
    for c in carried:
        agg[c] = "first"
    out = g.agg(agg).reset_index()
    out = out.rename(columns={"id": "row_ids"})
    out.insert(0, "id", [f"{'_'.join(grain)}#{i + 1}" for i in range(len(out))])
    out["excluded"] = False

    new_cols = ([cols[c] for c in grain] + [cols[c] for c in carried]
                + [cols[m] for m in measures])
    return out.reset_index(drop=True), {**schema, "columns": new_cols}


def materialize_levels(
    df: pd.DataFrame, schema: dict, spine: list[str],
    fn: dict[str, str] | None = None, split_cols: list[str] | None = None,
) -> tuple[dict[str, tuple[pd.DataFrame, dict]], list[str]]:
    """All level tables, keyed by level name. `RAW` ("") is the unaggregated
    reduced frame; each spine column maps to its prefix grain. `split_cols`
    (the qualifiers a figure compares/colours/facets by) are always retained in
    the grain so a coarse level can still be split horizontally — without them a
    coarse table would have averaged the comparison away.

    Returns (levels, present_spine)."""
    fn = fn or {}
    split = [c for c in (split_cols or []) if c in df.columns]
    present = spine_present(df, spine)

    raw = df.copy()
    raw["row_ids"] = [[i] for i in raw["id"].tolist()]
    levels: dict[str, tuple[pd.DataFrame, dict]] = {RAW: (raw, schema)}

    for i, lv in enumerate(present):
        prefix = present[: i + 1]
        # dict.fromkeys dedupes split against the prefix *and* against itself, so a
        # column used for several encodings can't land in the grain twice (which
        # would make reset_index fail to re-insert a duplicated index level).
        grain = list(dict.fromkeys(prefix + split))
        levels[lv] = _level_table(df, schema, grain, fn.get(lv, "mean"))
    return levels, present


def resolve_level(levels: dict, level: str | None) -> tuple[pd.DataFrame, dict]:
    """The table for a requested level, falling back to RAW when the level is
    unknown (e.g. a spine column dropped by the reduction) so a stale level never
    blanks the figure."""
    return levels.get(level or RAW) or levels[RAW]


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


def pairing(df: pd.DataFrame, spine: list[str], qualifier: str | None) -> dict | None:
    """Verdict for comparing `qualifier`'s levels, derived from the spine.

    Paired over the spine levels *coarser than* the qualifier's home (the units
    that can contain more than one of its values); the verdict is three-valued
    because real data has holes:
      - "paired"            every such unit carries every level of the qualifier
      - "partially_paired"  some but not all do (drop-outs)
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
                "n_units": 0, "n_complete": 0,
                "reason": "no unit coarser than the comparison's natural level"}

    unit_cols = spine[:home_idx]
    across = spine[home_idx - 1]
    qlevels = set(df[qualifier].dropna().unique())
    g = df.groupby(unit_cols, observed=True)
    complete = g[qualifier].apply(lambda s: qlevels.issubset(set(s.dropna().unique())))
    n_units, n_complete = int(len(complete)), int(complete.sum())
    verdict = ("paired" if n_units and n_complete == n_units
               else "partially_paired" if n_complete else "unpaired")
    return {"qualifier": qualifier, "verdict": verdict, "across": across,
            "n_units": n_units, "n_complete": n_complete,
            "levels": sorted(map(str, qlevels))}
