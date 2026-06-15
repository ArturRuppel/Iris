"""PyInstaller runtime hook: runs before any application import.

Pins matplotlib's cache to a stable per-user directory. Without this, a
frozen app can end up with the font cache in a throwaway location and
re-scan every installed font (minutes) on every launch instead of once
per machine. Also gives the cache a home when the parent process passes
a minimal environment without HOME.
"""
import os
from pathlib import Path

if "MPLCONFIGDIR" not in os.environ:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        cache = base / "Iris" / "matplotlib"
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
        cache = base / "iris" / "matplotlib"
    try:
        cache.mkdir(parents=True, exist_ok=True)
        os.environ["MPLCONFIGDIR"] = str(cache)
    except OSError:
        pass  # fall back to matplotlib's own resolution
