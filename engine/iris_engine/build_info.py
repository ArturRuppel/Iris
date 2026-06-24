"""Identity of the engine build that produced a file.

A `.iris` records inputs and decisions; every computed value is a function of
those plus *which engine ran them*. The library snapshot (`main.engine_snapshot`)
pins the numeric backends; this pins Iris's own decision logic — the test picker,
the thresholds, the pipeline compiler — by commit. Together with the data and the
decisions they make a file's results reproducible.

Resolution order:
  1. a build-time stamp module (`_build_stamp.py`, written by the PyInstaller spec)
     — authoritative for packaged binaries, which are not git checkouts;
  2. `git describe --always --dirty` from the package tree — for source/dev runs;
  3. a last-resort dict flagged `dirty` with an `unknown` commit.

The `dirty` flag is load-bearing: a bare hash from a modified tree claims a
reproducibility it does not have (a reader checking out that commit runs different
code), so a dirty build says so honestly.
"""
from __future__ import annotations

import subprocess
from importlib import metadata
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parent


def _package_version() -> str:
    try:
        return metadata.version("iris-engine")
    except metadata.PackageNotFoundError:
        return "0.0.0+unknown"


def _from_git() -> dict | None:
    """`git describe --always --dirty` from the package tree, or None if git is
    unavailable / this is not a checkout."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(_PKG_DIR), "describe", "--always",
             "--dirty", "--abbrev=7"],
            capture_output=True, text=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    desc = proc.stdout.strip()
    if not desc:
        return None
    dirty = desc.endswith("-dirty")
    commit = desc[:-len("-dirty")] if dirty else desc
    return {"version": _package_version(), "commit": commit, "dirty": dirty}


def build_identity() -> dict:
    """`{version, commit, dirty}` for the engine that is running."""
    try:
        from . import _build_stamp  # type: ignore
    except ImportError:
        _build_stamp = None
    if _build_stamp is not None:
        return {"version": _build_stamp.VERSION,
                "commit": _build_stamp.COMMIT,
                "dirty": bool(_build_stamp.DIRTY)}

    from_git = _from_git()
    if from_git is not None:
        return from_git

    # Neither a stamped build nor a checkout: cannot prove reproducibility.
    return {"version": _package_version(), "commit": "unknown", "dirty": True}
