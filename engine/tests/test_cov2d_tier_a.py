# engine/tests/test_cov2d_tier_a.py
"""Tier A end-to-end: the absorbed graph reproduces the notebook's numbers."""
import cov2d_fixture as fx


def test_fixture_reference_is_paired_and_well_separated():
    ref = fx.paired_by_replicate_reference()
    assert ref["n"] == 3                      # N=3 replicates (experiments)
    # VimentinKO above NLS-mCherry in every replicate
    assert all(v > n for v, n in zip(ref["vk"], ref["nl"]))
    assert ref["p"] < 0.05
