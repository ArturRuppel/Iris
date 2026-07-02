"""Autosave / crash recovery: a single on-disk snapshot slot the frontend
refreshes while there is unsaved work, so a crash or an accidental tab close
never loses the session.

Two tiers, no second document format (design:
docs/superpowers/specs/2026-07-02-autosave-crash-recovery-design.md):

- `snapshot.iris` — a byte-for-byte standard `.iris` (document.save_document),
  rewritten only when the DATA changed (the client's `data_fingerprint` —
  pool ids + session ids + versions — moved). Table data is the heavy, rarely
  changing part; re-serializing it on every spec edit would be wasteful.
- `state.json` — a sidecar of the cheap, frequently changing spec state
  (the already-serializable 2.1 analysis specs + per-table hierarchies),
  rewritten on every snapshot. Hierarchy edits (spine reorder, level fns)
  don't bump the session version, so they ride here, not in the fingerprint.

Restore = load the `.iris`, then overlay the sidecar's analyses and per-table
hierarchies — the sidecar is always the same age or newer. The sidecar can
never reference a table the `.iris` lacks: any pool change that could add a
reference also changes the fingerprint, forcing a data-tier rewrite in the
same snapshot call.

Writes are atomic (tmp + os.replace) and ordered data-tier-first, so a crash
mid-snapshot leaves at worst an old sidecar with a newer `.iris` (harmless:
the next snapshot sees a fingerprint mismatch and rewrites), never a sidecar
pointing at stale data. A lock serializes writers — uvicorn runs sync
endpoints in a threadpool."""
from __future__ import annotations

import json
import os
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import document

SNAPSHOT_IRIS = "snapshot.iris"
STATE_JSON = "state.json"

_LOCK = threading.Lock()


def default_dir() -> Path:
    """The per-user snapshot slot. `IRIS_AUTOSAVE_DIR` overrides (tests,
    unusual setups); otherwise the platform app-data directory. NOT "beside
    the .iris": File System Access handles never expose a path, so neither
    the page nor the engine knows where the bound document lives."""
    env = os.environ.get("IRIS_AUTOSAVE_DIR")
    if env:
        return Path(env)
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home())))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME",
                                   str(Path.home() / ".local" / "share")))
    return base / "iris" / "autosave"


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def _read_state(dirpath: Path) -> dict | None:
    """The sidecar, or None when absent/unreadable. A corrupt sidecar (should
    be impossible given atomic writes, but disks happen) reads as "no
    snapshot" rather than wedging startup."""
    try:
        return json.loads((dirpath / STATE_JSON).read_text("utf-8"))
    except (OSError, ValueError):
        return None


def write_snapshot(dirpath: Path, *, analyses: list[dict],
                   table_meta: list[dict], provenance: dict,
                   fingerprint: str, iris_bytes) -> dict:
    """Refresh the slot. `iris_bytes` is a zero-arg callable producing the
    full `.iris` bytes — called ONLY when the data tier must be (re)written,
    so the common spec-only snapshot never touches the sessions.
    `table_meta` is `[{name, hierarchy}]`, the sidecar's overlay payload."""
    with _LOCK:
        dirpath.mkdir(parents=True, exist_ok=True)
        state = _read_state(dirpath)
        data_stale = (state is None
                      or state.get("data_fingerprint") != fingerprint
                      or not (dirpath / SNAPSHOT_IRIS).exists())
        if data_stale:
            _atomic_write(dirpath / SNAPSHOT_IRIS, iris_bytes())
        _atomic_write(dirpath / STATE_JSON, json.dumps({
            "written": datetime.now(timezone.utc).isoformat(),
            "data_fingerprint": fingerprint,
            "analyses": analyses,
            "tables": table_meta,
            "provenance": provenance,
        }, indent=2).encode("utf-8"))
        return {"data_written": data_stale}


def status(dirpath: Path) -> dict:
    """What the launch-time recovery offer shows. A slot is only `exists`
    when BOTH tiers are present — a sidecar without its `.iris` (or vice
    versa) is unrestorable and reads as empty."""
    state = _read_state(dirpath)
    if state is None or not (dirpath / SNAPSHOT_IRIS).exists():
        return {"exists": False, "written": None, "n_analyses": 0, "tables": []}
    return {"exists": True,
            "written": state.get("written"),
            "n_analyses": len(state.get("analyses", [])),
            "tables": [t.get("name") for t in state.get("tables", [])]}


def load_snapshot(dirpath: Path) -> dict:
    """The snapshot as a loaded document dict (document.load_document shape),
    with the sidecar's newer analyses and per-table hierarchies overlaid.
    Raises FileNotFoundError when the slot is empty/incomplete."""
    with _LOCK:
        state = _read_state(dirpath)
        if state is None:
            raise FileNotFoundError("no autosave snapshot")
        data = (dirpath / SNAPSHOT_IRIS).read_bytes()
    doc = document.load_document(data)
    doc["analyses"] = state.get("analyses", doc["analyses"])
    doc["provenance"] = state.get("provenance", doc.get("provenance"))
    for tm in state.get("tables", []):
        name, hierarchy = tm.get("name"), tm.get("hierarchy")
        if name in doc["tables"] and hierarchy is not None:
            doc["tables"][name]["hierarchy"] = hierarchy
    return doc


def clear(dirpath: Path) -> None:
    """Empty the slot (explicit Save superseded it, or the user discarded the
    offer). Leftover .tmp files from an interrupted write go too."""
    with _LOCK:
        for name in (SNAPSHOT_IRIS, STATE_JSON,
                     SNAPSHOT_IRIS + ".tmp", STATE_JSON + ".tmp"):
            try:
                (dirpath / name).unlink()
            except FileNotFoundError:
                pass
