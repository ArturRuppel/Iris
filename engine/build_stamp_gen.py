"""Write `iris_engine/_build_stamp.py` at PyInstaller build time.

The packaged sidecar is not a git checkout, so it cannot read its own commit at
runtime — we stamp it in here, while the build *is* a checkout. `build_info`
prefers this stamp; source/dev runs fall back to `git describe` directly. The
stamp is gitignored: it is a build artifact, never committed.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path


def _git_describe(repo: Path) -> tuple[str, bool]:
    out = subprocess.run(
        ["git", "-C", str(repo), "describe", "--always", "--dirty", "--abbrev=7"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    dirty = out.endswith("-dirty")
    return (out[:-len("-dirty")] if dirty else out), dirty


def _pyproject_version(pyproject: Path) -> str:
    m = re.search(r'(?m)^version\s*=\s*"([^"]+)"', pyproject.read_text())
    return m.group(1) if m else "0.0.0+unknown"


def stamp_source(version: str, commit: str, dirty: bool) -> str:
    return ("# Generated at build time by build_stamp_gen.py — do not edit or "
            "commit.\n"
            f"VERSION = {version!r}\n"
            f"COMMIT = {commit!r}\n"
            f"DIRTY = {dirty!r}\n")


def write_stamp(engine_dir: Path) -> Path:
    """Resolve the build identity from `engine_dir` and write the stamp module."""
    engine_dir = Path(engine_dir)
    commit, dirty = _git_describe(engine_dir)
    version = _pyproject_version(engine_dir / "pyproject.toml")
    path = engine_dir / "iris_engine" / "_build_stamp.py"
    path.write_text(stamp_source(version, commit, dirty))
    return path
