"""CLI: regenerate a case's shippable artifacts — the openable ``.iris`` and a
rendered ``.svg`` per analysis — into the gitignored ``artifacts/`` dir.

    python -m validation.build --all          # every case
    python -m validation.build iris-petal-correlation [reduction-collapse ...]

The ``.iris`` is what you hand a user or open in the app; the ``.svg`` is the
human side of 'look for yourself'. Building never asserts — that's
``test_validation`` — it just produces the files.
"""
from __future__ import annotations

import argparse
import sys

from iris_engine import compiler, document, main

from . import harness


def build_one(case_dir) -> None:
    case = harness.load_case(case_dir)
    name = case.__case_dir__.name
    data = harness.build_iris(case)
    harness.ARTIFACTS.mkdir(exist_ok=True)
    doc = document.load_document(data)
    table = {"schema": doc["schema"], "rows": doc["rows"]}
    n_svg = 0
    for spec in doc["analyses"]:
        fig, *_ = main._run(table, spec)
        svg = compiler.figure_to_svg(fig)
        compiler.close(fig)
        (harness.ARTIFACTS / f"{spec.get('id') or name}.svg").write_text(svg)
        n_svg += 1
    print(f"  built {name}.iris  (+{n_svg} svg)")


def main_cli(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="validation.build")
    ap.add_argument("cases", nargs="*", help="case folder name(s)")
    ap.add_argument("--all", action="store_true", help="build every case")
    args = ap.parse_args(argv)

    if args.all or not args.cases:
        dirs = harness.case_dirs()
    else:
        dirs = [harness.CASES_DIR / c for c in args.cases]
        missing = [d.name for d in dirs if not (d / "case.py").exists()]
        if missing:
            ap.error(f"no such case(s): {', '.join(missing)}")

    print(f"building {len(dirs)} case(s) into {harness.ARTIFACTS}/")
    for d in dirs:
        build_one(d)
    return 0


if __name__ == "__main__":
    sys.exit(main_cli())
