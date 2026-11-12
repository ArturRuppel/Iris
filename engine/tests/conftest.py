"""Suite-wide settings.

Starlette's TestClient sends `Host: testserver`, which the engine's Host guard
(main.py, `_origin_guard`) would refuse, so the suite admits that name the way a
deployment admits its own. And no test may touch the real crash-recovery slot:
the autosave directory points at a temporary folder for the whole run (tests
that set IRIS_AUTOSAVE_DIR themselves still win).
"""
import os

import pytest

os.environ["IRIS_ALLOWED_HOSTS"] = "testserver"


@pytest.fixture(autouse=True, scope="session")
def _private_autosave_dir(tmp_path_factory):
    before = os.environ.get("IRIS_AUTOSAVE_DIR")
    os.environ["IRIS_AUTOSAVE_DIR"] = str(tmp_path_factory.mktemp("autosave"))
    yield
    if before is None:
        os.environ.pop("IRIS_AUTOSAVE_DIR", None)
    else:
        os.environ["IRIS_AUTOSAVE_DIR"] = before
