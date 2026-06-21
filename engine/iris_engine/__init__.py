"""Iris engine: headless statistics + figure rendering for the .iris format."""
from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("iris-engine")
except PackageNotFoundError:  # running from a source checkout, not installed
    __version__ = "0.1.0"

__all__ = ["__version__"]
