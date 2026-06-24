"""The build-time stamp generator emits a valid, importable `_build_stamp.py`
that `build_info` then reads verbatim."""
import sys
from pathlib import Path

import build_stamp_gen


def test_stamp_source_is_importable_and_exact():
    src = build_stamp_gen.stamp_source("1.4.2", "a1b2c3d", False)
    ns: dict = {}
    exec(compile(src, "_build_stamp.py", "exec"), ns)
    assert ns["VERSION"] == "1.4.2"
    assert ns["COMMIT"] == "a1b2c3d"
    assert ns["DIRTY"] is False


def test_write_stamp_against_this_checkout(tmp_path, monkeypatch):
    """write_stamp resolves a real commit + version from the engine tree and the
    result feeds build_info.build_identity()."""
    engine_dir = Path(__file__).resolve().parents[1]
    # write into a throwaway package dir so we never touch the real tree
    pkg = tmp_path / "iris_engine"
    pkg.mkdir()
    (tmp_path / "pyproject.toml").write_text('name = "iris-engine"\nversion = "9.9.9"\n')
    monkeypatch.setattr(build_stamp_gen, "_git_describe",
                        lambda repo: ("deadbee", False))
    out = build_stamp_gen.write_stamp(tmp_path)
    assert out == pkg / "_build_stamp.py"

    ns: dict = {}
    exec(out.read_text(), ns)
    assert ns["VERSION"] == "9.9.9"
    assert ns["COMMIT"] == "deadbee"
    assert ns["DIRTY"] is False
    # the real engine tree must be describable (sanity on the git path)
    commit, dirty = build_stamp_gen._git_describe(engine_dir)
    assert commit and isinstance(dirty, bool)
