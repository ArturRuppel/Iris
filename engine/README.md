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
scipy, pingouin, matplotlib, seaborn). FastAPI / uvicorn come only with the
`server` extra.

## Library use

```python
from iris_engine import compiler, document, stats   # no FastAPI needed

# load a .iris, build a figure from one of its analysis specs, save it
# (see iris_engine.compiler.build_figure)
```

## HTTP service

```bash
iris-engine            # requires the [server] extra
```

## License

AGPL-3.0 — see `LICENSE`.
