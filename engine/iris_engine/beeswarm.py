"""The beeswarm (swarm) dot-layout solver, vendored from seaborn 0.13.2
(`seaborn/categorical.py`, class `Beeswarm`, and `_get_transform_functions` from
`seaborn/utils.py`) so the engine does not depend on seaborn for one algorithm.
The solver is unchanged; only `__call__` (seaborn's one-collection wrapper, which
compiler._apply_beeswarm replaces) and the overflow warning's wording are not
carried over. Layout design: docs/superpowers/specs/2026-06-17-beeswarm-dot-layout-design.md

Copyright (c) 2012-2023, Michael L. Waskom
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the project nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
"""
from __future__ import annotations

import numpy as np


def get_transform_functions(ax, axis):
    """Return the forward and inverse transforms for a given axis."""
    axis_obj = getattr(ax, f"{axis}axis")
    transform = axis_obj.get_transform()
    return transform.transform, transform.inverted().transform


class Beeswarm:
    """Adjusts point positions along the categorical axis to avoid overlaps."""

    def __init__(self, orient="x", width=0.8):
        self.orient = orient
        self.width = width

    def beeswarm(self, orig_xyr):
        """Adjust x position of points to avoid overlaps."""
        # In this method, `x` is always the categorical axis
        # Center of the swarm, in point coordinates
        midline = orig_xyr[0, 0]

        # Start the swarm with the first point
        swarm = np.atleast_2d(orig_xyr[0])

        # Loop over the remaining points
        for xyr_i in orig_xyr[1:]:

            # Find the points in the swarm that could possibly
            # overlap with the point we are currently placing
            neighbors = self.could_overlap(xyr_i, swarm)

            # Find positions that would be valid individually
            # with respect to each of the swarm neighbors
            candidates = self.position_candidates(xyr_i, neighbors)

            # Sort candidates by their centrality
            offsets = np.abs(candidates[:, 0] - midline)
            candidates = candidates[np.argsort(offsets)]

            # Find the first candidate that does not overlap any neighbors
            new_xyr_i = self.first_non_overlapping_candidate(candidates, neighbors)

            # Place it into the swarm
            swarm = np.vstack([swarm, new_xyr_i])

        return swarm

    def could_overlap(self, xyr_i, swarm):
        """Return a list of all swarm points that could overlap with target."""
        # Because we work backwards through the swarm and can short-circuit,
        # the for-loop is faster than vectorization
        _, y_i, r_i = xyr_i
        neighbors = []
        for xyr_j in reversed(swarm):
            _, y_j, r_j = xyr_j
            if (y_i - y_j) < (r_i + r_j):
                neighbors.append(xyr_j)
            else:
                break
        return np.array(neighbors)[::-1]

    def position_candidates(self, xyr_i, neighbors):
        """Return a list of coordinates that might be valid by adjusting x."""
        candidates = [xyr_i]
        x_i, y_i, r_i = xyr_i
        left_first = True
        for x_j, y_j, r_j in neighbors:
            dy = y_i - y_j
            dx = np.sqrt(max((r_i + r_j) ** 2 - dy ** 2, 0)) * 1.05
            cl, cr = (x_j - dx, y_i, r_i), (x_j + dx, y_i, r_i)
            if left_first:
                new_candidates = [cl, cr]
            else:
                new_candidates = [cr, cl]
            candidates.extend(new_candidates)
            left_first = not left_first
        return np.array(candidates)

    def first_non_overlapping_candidate(self, candidates, neighbors):
        """Find the first candidate that does not overlap with the swarm."""

        # If we have no neighbors, all candidates are good.
        if len(neighbors) == 0:
            return candidates[0]

        neighbors_x = neighbors[:, 0]
        neighbors_y = neighbors[:, 1]
        neighbors_r = neighbors[:, 2]

        for xyr_i in candidates:

            x_i, y_i, r_i = xyr_i

            dx = neighbors_x - x_i
            dy = neighbors_y - y_i
            sq_distances = np.square(dx) + np.square(dy)

            sep_needed = np.square(neighbors_r + r_i)

            # Good candidate does not overlap any of neighbors which means that
            # squared distance between candidate and any of the neighbors has
            # to be at least square of the summed radii
            good_candidate = np.all(sq_distances >= sep_needed)

            if good_candidate:
                return xyr_i

        raise RuntimeError(
            "No non-overlapping candidates found. This should not happen."
        )

    def add_gutters(self, points, center, trans_fwd, trans_inv):
        """Stop points from extending beyond their territory (clamped silently:
        Iris has no notices channel, so a dense lane just gets a flat edge)."""
        half_width = self.width / 2
        low_gutter = trans_inv(trans_fwd(center) - half_width)
        off_low = points < low_gutter
        if off_low.any():
            points[off_low] = low_gutter
        high_gutter = trans_inv(trans_fwd(center) + half_width)
        off_high = points > high_gutter
        if off_high.any():
            points[off_high] = high_gutter
        return points
