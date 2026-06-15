"""PyInstaller entry point for the frozen sidecar binary.

`iris_engine/main.py` uses relative imports, so it cannot be frozen as a
top-level script; this wrapper imports the package properly.
Build with: pyinstaller iris-engine.spec  (from engine/)
"""
from iris_engine.main import main

if __name__ == "__main__":
    main()
