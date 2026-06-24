"""Engine build identity: prefer a build-time stamp, else a git fallback, else a
last-resort dict. The identity is stamped into a saved .iris manifest so a file's
computed results are reproducible against the exact engine that produced them."""
import subprocess
import sys
import types

import pytest

from iris_engine import build_info


def test_keys_and_types():
    ident = build_info.build_identity()
    assert set(ident) == {"version", "commit", "dirty"}
    assert isinstance(ident["version"], str)
    assert isinstance(ident["commit"], str)
    assert isinstance(ident["dirty"], bool)


def test_prefers_stamp_without_touching_git(monkeypatch):
    """When the build-time stamp module is importable, its constants are returned
    verbatim and no `git` subprocess is spawned."""
    stamp = types.ModuleType("iris_engine._build_stamp")
    stamp.VERSION = "1.4.2"
    stamp.COMMIT = "a1b2c3d"
    stamp.DIRTY = False
    monkeypatch.setitem(sys.modules, "iris_engine._build_stamp", stamp)

    def _boom(*a, **k):
        raise AssertionError("git must not be called when a stamp is present")
    monkeypatch.setattr(subprocess, "run", _boom)

    assert build_info.build_identity() == {
        "version": "1.4.2", "commit": "a1b2c3d", "dirty": False}


def test_git_fallback_parses_dirty(monkeypatch):
    monkeypatch.setitem(sys.modules, "iris_engine._build_stamp", None)

    def fake_run(*a, **k):
        return types.SimpleNamespace(returncode=0, stdout="a1b2c3d-dirty\n")
    monkeypatch.setattr(subprocess, "run", fake_run)

    ident = build_info.build_identity()
    assert ident["commit"] == "a1b2c3d"
    assert ident["dirty"] is True


def test_git_fallback_clean(monkeypatch):
    monkeypatch.setitem(sys.modules, "iris_engine._build_stamp", None)

    def fake_run(*a, **k):
        return types.SimpleNamespace(returncode=0, stdout="a1b2c3d\n")
    monkeypatch.setattr(subprocess, "run", fake_run)

    ident = build_info.build_identity()
    assert ident["commit"] == "a1b2c3d"
    assert ident["dirty"] is False


def test_last_resort_when_git_missing(monkeypatch):
    monkeypatch.setitem(sys.modules, "iris_engine._build_stamp", None)

    def fake_run(*a, **k):
        raise FileNotFoundError("git not on PATH")
    monkeypatch.setattr(subprocess, "run", fake_run)

    ident = build_info.build_identity()
    assert ident["commit"] == "unknown"
    assert ident["dirty"] is True
