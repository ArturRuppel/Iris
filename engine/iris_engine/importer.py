"""CSV / TSV / Excel import: sniffing, type inference, preview, commit.

All parsing goes through pandas (the buy-not-build line); this module only
decides the options to hand it and shapes the result into the typed-column
table model. Everything is read as strings first so inference is ours and
the preview can show exactly what a cell contained before conversion.
"""
from __future__ import annotations

import csv
import io
import re

import pandas as pd

# tokens treated as missing in addition to truly empty cells
MISSING_TOKENS = {"", "na", "n/a", "nan", "null", "none", "-", "?", "missing", "."}

RESERVED_NAMES = {"id", "excluded"}  # row bookkeeping fields in the table model

EXCEL_SUFFIXES = (".xlsx", ".xlsm", ".xls")

PREVIEW_ROWS = 30
MAX_LEVELS = 40  # above this a column is too granular to be categorical
HEADER_SAMPLE = 200  # rows parsed for the fast headers-first pass (type guess)


def _decode(data: bytes) -> tuple[str, str]:
    for enc in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace"), "latin-1"


def _sniff(text: str) -> dict:
    sample = text[:64_000]
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = ","
    # decimal commas only make sense when the comma isn't the field separator
    decimal = ","
    if delimiter == "," or not re.search(r"\d,\d", sample):
        decimal = "."
    return {"delimiter": delimiter, "decimal": decimal}


def _sanitize_names(labels: list[str]) -> list[str]:
    names, seen = [], set()
    for i, label in enumerate(labels, 1):
        # Keep '.' — it's the family separator the column picker groups on
        # (cell_shape.area, cell_shape.perimeter → "cell_shape"). Everything
        # else non-word collapses to '_'; trim stray leading/trailing separators.
        name = re.sub(r"[^\w.]+", "_", str(label).strip().lower()).strip("_.") or f"col_{i}"
        if name in RESERVED_NAMES:
            name += "_col"
        base, k = name, 2
        while name in seen:
            name, k = f"{base}_{k}", k + 1
        seen.add(name)
        names.append(name)
    return names


def _read_raw(data: bytes, filename: str, options: dict,
              nrows: int | None = None) -> tuple[pd.DataFrame, dict]:
    """Read everything as strings; returns (df, resolved options). `nrows` caps
    the parse to a head sample (the headers-first pass: column names + a quick
    type guess without parsing a multi-million-row file)."""
    header = options.get("header", True)
    if filename.lower().endswith(EXCEL_SUFFIXES):
        xl = pd.ExcelFile(io.BytesIO(data))
        sheet = options.get("sheet")
        if sheet not in xl.sheet_names:
            sheet = xl.sheet_names[0]
        df = xl.parse(sheet, header=0 if header else None, dtype=str, nrows=nrows)
        resolved = {"kind": "excel", "sheet": sheet, "sheets": xl.sheet_names,
                    "header": header, "decimal": ".", "delimiter": None,
                    "encoding": None}
    else:
        text, encoding = _decode(data)
        sniffed = _sniff(text)
        delimiter = options.get("delimiter") or sniffed["delimiter"]
        decimal = options.get("decimal") or sniffed["decimal"]
        # The C parser is ~2x faster on large files; it handles every
        # single-character delimiter we offer. Fall back to the lenient Python
        # parser only if C trips on something (e.g. ragged quoting).
        read_kw = dict(sep=delimiter, dtype=str, header=0 if header else None,
                       skipinitialspace=True, keep_default_na=False, nrows=nrows)
        try:
            df = pd.read_csv(io.StringIO(text), engine="c", **read_kw)
        except (pd.errors.ParserError, ValueError):
            df = pd.read_csv(io.StringIO(text), engine="python", **read_kw)
        resolved = {"kind": "csv", "delimiter": delimiter, "decimal": decimal,
                    "encoding": encoding, "header": header, "sheet": None,
                    "sheets": None}

    labels = ([str(c) for c in df.columns] if header
              else [f"Column {i}" for i in range(1, len(df.columns) + 1)])
    df.columns = _sanitize_names(labels)
    _clean(df)
    df, labels = _reshape(df, labels, options.get("reshape"))
    return df, {**resolved, "labels": labels,
                "reshape": options.get("reshape")}


def _clean(df: pd.DataFrame) -> None:
    """Strip whitespace and blank out missing tokens, in place. Vectorized per
    column (a handful of str ops) rather than per cell, which on a wide/long
    table is millions of Python calls."""
    for c in df.columns:
        s = df[c]
        # Both readers use dtype=str, but the C parser may hand back a pandas
        # StringDtype rather than object — accept either. A genuinely non-string
        # column (e.g. an all-empty Excel column inferred as float) has nothing to
        # strip or match, so leave it untouched.
        if not pd.api.types.is_string_dtype(s):
            continue
        s = s.str.strip()
        # NaN where the cell is already missing (Excel blanks) or matches a
        # missing token case-insensitively; isin never yields NaN, so OR is safe.
        df[c] = s.mask(s.isna() | s.str.lower().isin(MISSING_TOKENS))


def _reshape(df: pd.DataFrame, labels: list[str],
             reshape: dict | None) -> tuple[pd.DataFrame, list[str]]:
    """Stack wide columns (one column per condition) into a long condition +
    value pair; rows whose value is missing are dropped, so ragged columns
    of unequal length work. Level order = column order."""
    if not reshape:
        return df, labels
    value_cols = [c for c in reshape.get("value_columns", []) if c in df.columns]
    if len(value_cols) < 2:
        raise ValueError("reshape needs at least two value columns")
    label_of = dict(zip(df.columns, labels))
    id_vars = [c for c in df.columns if c not in value_cols]
    var_label = str(reshape.get("var_name") or "Condition")
    val_label = str(reshape.get("value_name") or "Value")
    long = df.melt(id_vars=id_vars, value_vars=value_cols,
                   var_name="__var", value_name="__val")
    long["__var"] = long["__var"].map(label_of)  # levels get the pretty labels
    long = long[long["__val"].notna()].reset_index(drop=True)
    new_labels = [label_of[c] for c in id_vars] + [var_label, val_label]
    long.columns = _sanitize_names(new_labels)
    return long, new_labels


def _as_numeric(s: pd.Series, decimal: str) -> pd.Series:
    if decimal == ",":
        s = s.str.replace(".", "", regex=False)  # thousands separators
        s = s.str.replace(",", ".", regex=False)
    return pd.to_numeric(s, errors="coerce")


# Column names that denote a *nesting key* (an identifier), not a measurement
# or a free classifier — the spine columns of an experiment. Pure value
# inspection can't separate an integer index (frame, cell_id) from an integer
# measure, nor a low-cardinality grouping string (date, well) from a classifier,
# so the name carries the domain hint. Matched as whole underscore-/dot-delimited
# tokens, plus the common `*_id` / `*_index` suffixes. Tune freely.
_ID_TOKENS = frozenset({
    "id", "index", "idx", "frame", "date", "time", "timepoint", "well",
    "position", "replicate", "rep", "subject", "track", "plate", "batch",
    "field", "roi", "slice", "fov",
})
_ID_SUFFIXES = ("_id", "_ids", "_index", "_idx")


def _looks_like_identifier(name: object) -> bool:
    n = str(name).lower()
    if n.endswith(_ID_SUFFIXES):
        return True
    tokens = re.split(r"[._]", n)
    return any(t in _ID_TOKENS for t in tokens)


def _infer_type(s: pd.Series, decimal: str) -> str:
    non_na = s.dropna()
    if non_na.empty:
        return "categorical"
    name_id = _looks_like_identifier(s.name)
    nums = _as_numeric(non_na, decimal)
    if nums.notna().mean() >= 0.95:
        # an integer-valued column named like a key is a grouping index, not a
        # measure; a float-valued one (e.g. time in seconds) stays a measure.
        intlike = bool((nums.dropna() % 1 == 0).all())
        return "identifier" if name_id and intlike else "numeric"
    n_distinct = non_na.nunique()
    if n_distinct == len(non_na) and len(non_na) > 10:
        return "identifier"  # every value unique: a label, not a grouping
    if name_id:
        return "identifier"  # named like a key (date, position_id, well, ...)
    return "categorical" if n_distinct <= MAX_LEVELS else "identifier"


def _levels_in_order(s: pd.Series) -> list[str]:
    return list(dict.fromkeys(v for v in s if pd.notna(v)))


def _column_report(df: pd.DataFrame, labels: list[str], decimal: str,
                   types: dict[str, str] | None = None,
                   counts: bool = True) -> list[dict]:
    """Per-column report for the wizard. With `counts=False` (the headers-first
    pass) only name/label/inferred-type/examples are computed from a head sample
    — the full-data stats (n_missing/n_distinct/n_unparsed/levels) are filled in
    by the later full preview, so the user can start typing/mapping immediately."""
    cols = []
    for name, label in zip(df.columns, labels):
        s = df[name]
        ctype = (types or {}).get(name) or _infer_type(s, decimal)
        non_na = s.dropna()
        col = {"name": name, "label": label, "type": ctype,
               "examples": non_na.head(3).tolist()}
        if counts:
            col["n_missing"] = int(s.isna().sum())
            col["n_distinct"] = int(non_na.nunique())
            if ctype == "numeric":
                col["n_unparsed"] = int((_as_numeric(non_na, decimal).isna()).sum())
            elif ctype == "categorical":
                col["levels"] = _levels_in_order(s)[:MAX_LEVELS]
        cols.append(col)
    return cols


def _typed_columns(df: pd.DataFrame, columns: list[dict], decimal: str,
                   limit: int | None = None) -> dict[str, list]:
    """Per-column value lists with the confirmed types applied and NaN → None.
    The columnar building block shared by the row and columnar emitters."""
    out = df if limit is None else df.head(limit)
    converted = {"id": [f"r{i + 1}" for i in range(len(out))],
                 "excluded": [False] * len(out)}
    for col in columns:
        s = out[col["name"]]
        if col["type"] == "numeric":
            nums = _as_numeric(s, decimal)
            converted[col["name"]] = [None if pd.isna(v) else float(v) for v in nums]
        else:
            converted[col["name"]] = [None if pd.isna(v) else str(v) for v in s]
    return converted


def _typed_rows(df: pd.DataFrame, columns: list[dict], decimal: str,
                limit: int | None = None) -> list[dict]:
    cols = _typed_columns(df, columns, decimal, limit)
    names = list(cols)
    n = len(cols["id"])
    return [{name: cols[name][i] for name in names} for i in range(n)]


def read_frame(data: bytes, filename: str, options: dict | None = None
               ) -> tuple[pd.DataFrame, dict]:
    """Parse to a cleaned string frame plus resolved read options. This is the
    expensive step (decode + parse + clean); the caller caches the result so
    re-previews that only change per-column *types* don't re-parse the file."""
    return _read_raw(data, filename, options or {})


def read_header_frame(data: bytes, filename: str, options: dict | None = None
                      ) -> tuple[pd.DataFrame, dict]:
    """Like `read_frame` but parses only a head sample — fast even on a huge
    file, enough to learn the columns and guess their types."""
    return _read_raw(data, filename, options or {}, nrows=HEADER_SAMPLE)


def preview_headers_from_frame(df: pd.DataFrame, resolved: dict,
                               options: dict) -> dict:
    """Headers-first payload: columns + a provisional type guess from the
    sample, no full-data stats or preview rows (those arrive via the full
    preview). `n_rows: None` flags the count as not-yet-known."""
    resolved = dict(resolved)  # don't mutate the cached read result
    labels = resolved.pop("labels")
    columns = _column_report(df, labels, resolved["decimal"],
                             types=options.get("types"), counts=False)
    return {"options": resolved, "columns": columns, "n_rows": None,
            "rows": [], "provisional": True}


def preview_from_frame(df: pd.DataFrame, resolved: dict, options: dict) -> dict:
    """Render a preview from an already-parsed frame (see `read_frame`)."""
    resolved = dict(resolved)  # don't mutate the cached read result
    labels = resolved.pop("labels")
    columns = _column_report(df, labels, resolved["decimal"],
                             types=options.get("types"))
    return {"options": resolved, "columns": columns, "n_rows": len(df),
            "rows": _typed_rows(df, columns, resolved["decimal"],
                                limit=PREVIEW_ROWS)}


def preview(data: bytes, filename: str, options: dict | None = None) -> dict:
    """Sniff, infer, and return enough for the wizard to render a preview.

    `options` carries user overrides on a re-preview (delimiter, decimal,
    header, sheet, and per-column `types` as {name: type})."""
    options = options or {}
    df, resolved = read_frame(data, filename, options)
    return preview_from_frame(df, resolved, options)


def commit_from_frame(df: pd.DataFrame, resolved: dict,
                      columns: list[dict], columnar: bool = False) -> dict:
    """Produce the full table from an already-parsed frame (see `read_frame`).

    `columnar=True` emits `{schema, columns: {name: [...]}, n}` instead of
    `{schema, rows: [...]}`. The columnar form omits the per-row repetition of
    every column name, roughly halving the payload for a wide table — see the
    /import/commit endpoint, which sends it to the browser."""
    resolved = dict(resolved)  # don't mutate the cached read result
    labels = dict(zip(df.columns, resolved.pop("labels")))
    decimal = resolved["decimal"]
    schema_cols = []
    for col in columns:
        name, ctype = col["name"], col["type"]
        if name not in df.columns:
            raise ValueError(f"unknown column {name!r}")
        entry = {"name": name, "type": ctype,
                 "label": col.get("label") or labels[name]}
        if ctype == "categorical":
            entry["levels"] = _levels_in_order(df[name])[:MAX_LEVELS]
        schema_cols.append(entry)
    schema = {"schema_version": "1.0", "columns": schema_cols}
    if columnar:
        return {"schema": schema, "columns": _typed_columns(df, columns, decimal),
                "n": len(df)}
    return {"schema": schema, "rows": _typed_rows(df, columns, decimal)}


def commit(data: bytes, filename: str, options: dict,
           columns: list[dict]) -> dict:
    """Produce the full table (schema + rows) with user-confirmed types."""
    df, resolved = read_frame(data, filename, options)
    return commit_from_frame(df, resolved, columns)
