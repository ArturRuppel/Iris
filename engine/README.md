# iris-engine

The headless statistics and figure-rendering core of [Iris](https://github.com/ArturRuppel/Iris).

`iris-engine` reads an `.iris` document (a tidy table + schema + premade analysis
specs), runs the inferential statistics, and renders the SuperPlot figures with
matplotlib — all without a browser or the desktop app. It is the same code the
Iris GUI drives, packaged as an importable library so pipelines can produce static
figures (PNG / SVG / PDF) directly.

## Install

```bash
pip install iris-engine            # library: read .iris, run stats, render figures
pip install "iris-engine[server]"  # + the FastAPI HTTP service used by the GUI
```

The bare install pulls only the compute/render stack (numpy, pandas, pyarrow,
scipy, statsmodels, matplotlib). FastAPI / uvicorn come only with the
`server` extra.

## Library use

```python
from iris_engine import compiler, document, stats   # no FastAPI needed

# load a .iris, build a figure from one of its analysis specs, save it
# (see iris_engine.compiler.build_figure)
```

A multi-panel figure: tag the analyses that are panels, pass the assembly to
`save_document`, and render it with `assembly.render_figure` (the same tables
and analyses) or `assembly.render_iris` (the saved bytes):

```python
from iris_engine import assembly, compiler, document, main

analyses = [{**spec_a, "tag": "A"}, {**spec_b, "tag": "B"}]
figure = {"panels": [spec_a["id"], spec_b["id"]], "direction": "rows",
          "share_x": True, "gap_mm": 3, "width_mm": 110}
data = document.save_document(tables, analyses, provenance,
                              main.engine_snapshot(), figure=figure)
fig = assembly.render_figure(tables, analyses, figure)   # or assembly.render_iris(data)
svg = compiler.figure_to_svg(fig)
png = compiler.figure_to_bytes(fig, "png", dpi=110)
compiler.close(fig)
```

The assembly fields and their defaults are in `iris_engine/assembly.py`.

## HTTP service

```bash
iris-engine            # requires the [server] extra
```

## License

AGPL-3.0 — see `LICENSE`.
