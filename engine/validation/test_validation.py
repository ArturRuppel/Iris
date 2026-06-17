"""pytest entry point for the validation corpus.

Parametrized over every folder in ``cases/``; each runs the full
``harness.validate`` — build the real ``.iris``, run every saved analysis through
the engine, and assert its stats, chosen model, and figure structure. One
``python -m pytest validation`` run delivers all four jobs (statistical
correctness, end-to-end regression, shippable demo, visual structure), and each
case is its own named test so a failure names the case.
"""
from __future__ import annotations

import pytest

from . import harness

CASE_DIRS = harness.case_dirs()


@pytest.mark.parametrize("case_dir", CASE_DIRS,
                         ids=[d.name for d in CASE_DIRS])
def test_case(case_dir):
    harness.validate(case_dir)
