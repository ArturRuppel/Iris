# Beeswarm layout for the `dot` geom

**Date:** 2026-06-17
**Status:** Design approved, pending implementation

## Problem

The `dot` geom spreads overlapping observations with random **jitter** — a
stable hash-based offset along the categorical axis (`_stable_jitter`,
`_geom_dot` in `compiler.py`). With many points this turns into an unreadable
smear: density is conveyed only by opacity, and the shape of the distribution is
lost. A **beeswarm** packs points so they do not overlap, offsetting each along
the categorical axis by its neighbours' positions. The result builds the same
silhouette as a violin plot while keeping every raw observation visible and
clickable.

## Decision summary

- Keep jitter; add beeswarm as a **selectable layout**, not a replacement.
- Reuse seaborn's packing solver (`seaborn.categorical.Beeswarm`) rather than
  hand-rolling the algorithm or calling `sns.swarmplot()`.
- Integrate the solver at **final draw** (static-SVG render), mirroring the
  existing `_apply_legend_offset` deferred-draw pattern.

### Why the solver, not `sns.swarmplot()`

`sns.swarmplot()` is a top-level plotting call that would take over axis
creation, categorical positioning, colour mapping, and the legend. Iris's
`_geom_dot` does work seaborn knows nothing about and must preserve:

- the **gid → row_id contract** — every dot `PathCollection` carries the raw
  row-ids behind its points, which powers click-to-exclude;
- horizontal orientation, facet positioning, dodge `slot`/`wscale` math;
- coarse-grain "big marks" (one prominent mark per grain);
- composing on the same axes as box/violin/summary layers.

seaborn ships the packing algorithm as a standalone class,
`seaborn.categorical.Beeswarm`. We instantiate it and drive its methods on *our*
collections, keeping all of the above. We never call `sns.swarmplot()`.

### Why final-draw integration is clean

The `Beeswarm` solver works in **pixel space** and needs the final axis
transform (`ax.transData`, `figure.dpi`). In a resizable GUI that forces a
redraw callback. Iris renders a **static SVG at a fixed figure size**, and there
is already a precedent — `_apply_legend_offset` stashes work, runs it once at
final draw, then freezes the layout engine. The beeswarm solve uses the same
hook, so the only real downside of pixel-space packing disappears.

## Param surface

`engine/iris_engine/geoms.py` — add a `layout` select param to the `dot` geom:

```python
params={"layout": "swarm", "jitter": 0.18},
param_specs=[_sel("layout", "Layout", ["swarm", "jitter"]),
             _num("jitter", "Jitter", lo=0.0, hi=0.5, step=0.02),
             _num("marker_size", "Point size", lo=4, hi=140, step=2),
             _num("alpha", "Opacity", lo=0.05, hi=1.0, step=0.05)],
```

- Default is `"swarm"`.
- The `jitter` number param stays but is inert when `layout == "swarm"`. The
  rail may keep showing it; it only takes effect in jitter mode.
- `marker_size` and `alpha` are unchanged.
- No new width param. Swarm lane width is fixed at `0.8 * wscale` (seaborn's
  default), which dovetails with the dodge `slot` logic in `_layout_ctx`.

`src/types.ts` — add `layout?: "swarm" | "jitter";` to the layer params type
alongside the existing `jitter?: number;`.

## Rendering: `_geom_dot` (`compiler.py:721`)

Branch on `layout`:

- **`layout == "jitter"`** → the current `_stable_jitter` path, untouched.
- **`layout == "swarm"`** → draw each sub-series `PathCollection` **at the lane
  center** (`grp["pos"]`, no categorical offset), then register the lane for the
  deferred solve.

Per lane (group), stash a record on a figure attribute `fig._iris_beeswarm`
(a list), mirroring `fig._iris_legend_nudge`:

```python
{"ax": ax, "collections": [coll, ...], "center": grp["pos"],
 "orient": "y" if ctx["h_orient"] else "x", "width": 0.8 * ctx["wscale"]}
```

All sub-series collections of one group (the split by shape marker × discrete
colour level) go into the **same** record so they are packed *jointly* against
each other, not just within themselves.

The gid → row_id contract is unaffected: we never change a collection's point
count or ordering, only the categorical coordinate, and the solver writes back
per collection in place.

## Deferred solve: `_apply_beeswarm(fig)` (`compiler.py`)

Called from `figure_to_svg` / `figure_to_bytes`, right after the single
`fig.canvas.draw()` that makes the transforms final and before
`_apply_legend_offset`. Factor the shared "draw once" so the figure is not drawn
twice. After the solve: `_apply_legend_offset` → `set_layout_engine("none")` →
save. The function pops `fig._iris_beeswarm` so it is idempotent on a second
save.

For each lane record:

1. **Gather jointly.** Concatenate `get_offsets()` across the lane's collections
   into one array, recording each collection's slice `(start, stop)`. Compute
   per-point radii the seaborn way, per collection (so the per-point **size
   channel** is honoured):

   ```python
   sizes = coll.get_sizes()              # may be scalar → np.repeat
   edge  = coll.get_linewidth().item()
   radii = (np.sqrt(sizes) + edge) / 2 * (fig.dpi / 72)
   ```

2. **Solve once.** Transform the combined offsets to pixel space via
   `ax.transData`. Build the `xyr` array with the **categorical axis first**
   (swap columns when `orient == "y"`). Sort by the value axis, run
   `Beeswarm.beeswarm(orig_xyr)` (the maintained core), then invert the solved
   pixel positions back to data coordinates.

3. **Clamp.** Call `Beeswarm.add_gutters(...)` with `width = record["width"]` so
   a dense lane spreads to the gutter and stops rather than bleeding into the
   neighbouring category.

4. **Write back.** Slice the solved categorical coordinates back into each
   collection by its recorded slice via `set_offsets()`. Point counts and
   ordering are preserved exactly, so every gid still maps to the same row_ids.

We instantiate `Beeswarm(orient=..., width=...)` ourselves and reuse its
`beeswarm`, `could_overlap`, `position_candidates`,
`first_non_overlapping_candidate`, and `add_gutters` methods. We replicate the
transform + gather + writeback wrapper that `Beeswarm.__call__` normally does
for a single collection, extended to pack a lane's multiple collections jointly.

### Overflow

`add_gutters` emits a `UserWarning` once more than `warn_thresh` (5%) of points
hit the gutter. Iris has no notices channel wired into the figure, so we let it
**clamp silently** (suppress the warning). The visual result is a flat-edged
dense lane, which reads fine at high n. (If a notices channel is added later,
surfacing the gutter proportion is a natural follow-up.)

## Edge cases

- **Empty lane / single point** — solver is a no-op; one point stays at center.
- **Coarse-grain "big marks"** (few large dots per grain) — solved identically;
  works fine.
- **Faceting** — each facet's axes has its own lanes; the record carries its
  `ax`, so transforms resolve per-axes.
- **Point cap** — unchanged; `POINT_CAP = 3000` still blocks per-row dot
  rendering above the cap, so the solver never runs on pathological counts.

## Testing

- **Unit** — a dense group in swarm mode renders with **distinct categorical
  coordinates** (no two dots share offset+y beyond marker overlap) and all stay
  within `±0.4 * wscale` of center; the gid → row_ids count is unchanged versus
  pre-solve; jitter mode still produces the hash-based offsets from
  `_stable_jitter`.
- **Horizontal** — `h_orient` packs along the y axis (orient `"y"`), value runs
  along x.
- **Snapshot / SVG** — `layout="swarm"` produces a violin-like silhouette.
- **Regression** — existing dot tests pass with the new default. Where a test
  asserts exact jitter offsets, pin `layout="jitter"`; where it only checks dot
  presence/count, the new default is fine.

## Files touched

- `engine/iris_engine/geoms.py` — `layout` param on the `dot` geom.
- `engine/iris_engine/compiler.py` — `_geom_dot` swarm branch + stash;
  `_apply_beeswarm(fig)`; wiring in `figure_to_svg` / `figure_to_bytes`.
- `src/types.ts` — `layout?: "swarm" | "jitter"` in the layer params type.
- `engine/tests/` — unit + regression coverage as above.
