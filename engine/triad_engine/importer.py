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
        name = re.sub(r"\W+", "_", str(label).strip().lower()).strip("_") or f"col_{i}"
        if name in RESERVED_NAMES:
            name += "_col"
        base, k = name, 2
        while name in seen:
            name, k = f"{base}_{k}", k + 1
        seen.add(name)
        names.append(name)
    return names


def _read_raw(data: bytes, filename: str, options: dict) -> tuple[pd.DataFrame, dict]:
    """Read everything as strings; returns (df, resolved options)."""
    header = options.get("header", True)
    if filename.lower().endswith(EXCEL_SUFFIXES):
        xl = pd.ExcelFile(io.BytesIO(data))
        sheet = options.get("sheet")
        if sheet not in xl.sheet_names:
            sheet = xl.sheet_names[0]
        df = xl.parse(sheet, header=0 if header else None, dtype=str)
        resolved = {"kind": "excel", "sheet": sheet, "sheets": xl.sheet_names,
                    "header": header, "decimal": ".", "delimiter": None,
                    "encoding": None}
    else:
        text, encoding = _decode(data)
        sniffed = _sniff(text)
        delimiter = options.get("delimiter") or sniffed["delimiter"]
        decimal = options.get("decimal") or sniffed["decimal"]
        df = pd.read_csv(io.StringIO(text), sep=delimiter, dtype=str,
                         header=0 if header else None, engine="python",
                         skipinitialspace=True, keep_default_na=False)
        resolved = {"kind": "csv", "delimiter": delimiter, "decimal": decimal,
                    "encoding": encoding, "header": header, "sheet": None,
                    "sheets": None}

    labels = ([str(c) for c in df.columns] if header
              else [f"Column {i}" for i in range(1, len(df.columns) + 1)])
    df.columns = _sanitize_names(labels)
    df = df.map(lambda v: v.strip() if isinstance(v, str) else v)
    df = df.mask(df.map(lambda v: not isinstance(v, str)
                        or v.lower() in MISSING_TOKENS))
    return df, {**resolved, "labels": labels}


def _as_numeric(s: pd.Series, decimal: str) -> pd.Series:
    if decimal == ",":
        s = s.str.replace(".", "", regex=False)  # thousands separators
        s = s.str.replace(",", ".", regex=False)
    return pd.to_numeric(s, errors="coerce")


def _infer_type(s: pd.Series, decimal: str) -> str:
    non_na = s.dropna()
    if non_na.empty:
        return "categorical"
    numeric_frac = _as_numeric(non_na, decimal).notna().mean()
    if numeric_frac >= 0.95:
        return "numeric"
    n_distinct = non_na.nunique()
    if n_distinct == len(non_na) and len(non_na) > 10:
        return "identifier"  # every value unique: a label, not a grouping
    return "categorical" if n_distinct <= MAX_LEVELS else "identifier"


def _levels_in_order(s: pd.Series) -> list[str]:
    return list(dict.fromkeys(v for v in s if pd.notna(v)))


def _column_report(df: pd.DataFrame, labels: list[str], decimal: str,
                   types: dict[str, str] | None = None) -> list[dict]:
    cols = []
    for name, label in zip(df.columns, labels):
        s = df[name]
        ctype = (types or {}).get(name) or _infer_type(s, decimal)
        non_na = s.dropna()
        col = {"name": name, "label": label, "type": ctype,
               "n_missing": int(s.isna().sum()),
               "n_distinct": int(non_na.nunique()),
               "examples": non_na.head(3).tolist()}
        if ctype == "numeric":
            col["n_unparsed"] = int((_as_numeric(non_na, decimal).isna()).sum())
        elif ctype == "categorical":
            col["levels"] = _levels_in_order(s)[:MAX_LEVELS]
        cols.append(col)
    return cols


def _typed_rows(df: pd.DataFrame, columns: list[dict], decimal: str,
                limit: int | None = None) -> list[dict]:
    out = df if limit is None else df.head(limit)
    converted = {}
    for col in columns:
        s = out[col["name"]]
        if col["type"] == "numeric":
            nums = _as_numeric(s, decimal)
            converted[col["name"]] = [None if pd.isna(v) else float(v) for v in nums]
        else:
            converted[col["name"]] = [None if pd.isna(v) else str(v) for v in s]
    rows = []
    for i in range(len(out)):
        row = {"id": f"r{i + 1}", "excluded": False}
        for name, vals in converted.items():
            row[name] = vals[i]
        rows.append(row)
    return rows


def preview(data: bytes, filename: str, options: dict | None = None) -> dict:
    """Sniff, infer, and return enough for the wizard to render a preview.

    `options` carries user overrides on a re-preview (delimiter, decimal,
    header, sheet, and per-column `types` as {name: type})."""
    options = options or {}
    df, resolved = _read_raw(data, filename, options)
    labels = resolved.pop("labels")
    columns = _column_report(df, labels, resolved["decimal"],
                             types=options.get("types"))
    return {"options": resolved, "columns": columns, "n_rows": len(df),
            "rows": _typed_rows(df, columns, resolved["decimal"],
                                limit=PREVIEW_ROWS)}


def commit(data: bytes, filename: str, options: dict,
           columns: list[dict]) -> dict:
    """Produce the full table (schema + rows) with user-confirmed types."""
    df, resolved = _read_raw(data, filename, options)
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
    return {"schema": schema, "rows": _typed_rows(df, columns, decimal)}
