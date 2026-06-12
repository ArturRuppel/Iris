"""PyInstaller entry point for the frozen sidecar binary.

`triad_engine/main.py` uses relative imports, so it cannot be frozen as a
top-level script; this wrapper imports the package properly.
Build with: pyinstaller triad-engine.spec  (from engine/)
"""
from triad_engine.main import main

if __name__ == "__main__":
    main()
