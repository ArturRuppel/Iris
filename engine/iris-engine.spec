# PyInstaller spec for the Iris engine sidecar (single-file binary).
# Build from engine/:  pyinstaller iris-engine.spec
# Output: dist/iris-engine  — copy to src-tauri/binaries/iris-engine-<target-triple>
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# Stamp the engine identity (version/commit/dirty) into the package before the
# binary is frozen — the packaged sidecar is not a git checkout and cannot read
# its own commit at runtime. build_info reads this stamp; it is gitignored.
from build_stamp_gen import write_stamp
write_stamp(Path(SPECPATH))

hiddenimports = (
    # uvicorn picks loop/protocol/lifespan implementations at runtime
    collect_submodules("uvicorn")
    # pingouin pulls these lazily / via pandas_flavor registration
    + collect_submodules("pingouin")
    + ["pandas_flavor", "seaborn", "scipy.special.cython_special"]
    # pandas imports its Excel engine lazily inside read_excel()
    + ["openpyxl"]
    # matplotlib loads output backends dynamically at savefig() time;
    # static analysis only catches the Agg default
    + ["matplotlib.backends.backend_agg", "matplotlib.backends.backend_svg",
       "matplotlib.backends.backend_pdf"]
)

datas = collect_data_files("pingouin") + collect_data_files("matplotlib")

a = Analysis(
    ["freeze_entry.py"],
    pathex=["."],
    hiddenimports=hiddenimports,
    datas=datas,
    runtime_hooks=["freeze_runtime_hook.py"],
    excludes=[
        # never used by the engine; keeps the binary smaller
        "tkinter", "PyQt5", "PyQt6", "PySide2", "PySide6", "wx",
        "IPython", "jupyter", "notebook", "pytest", "sphinx",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="iris-engine",
    console=True,           # sidecar: no window; stdout goes to the shell's log
    upx=False,              # UPX breaks signing later and saves little here
    strip=False,
)
