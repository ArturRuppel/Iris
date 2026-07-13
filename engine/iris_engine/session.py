"""Server-owned session table: the single source of truth for the editable data.

Holds the table as a pandas DataFrame keyed by a stable id (not a content hash),
so cell edits mutate it in place and the browser never needs more than the rows
it is showing. A monotonic `version` bumps on every mutation; compute and the
grid use it to know the table changed."""
from __future__ import annotations

import threading
import uuid

import pandas as pd


def records(df: pd.DataFrame) -> list[dict]:
    # object dtype so NaN/NaT survive the replace; then -> None for JSON null.
    return df.astype(object).where(pd.notnull(df), None).to_dict(orient="records")


class SessionTable:
    _DISTINCT_CAP = 1000  # the editor only needs a bounded level list

    def __init__(self, schema: dict, df: pd.DataFrame):
        self.schema = schema
        self._df = df.reset_index(drop=True)
        self.version = 0
        # Sync endpoints run in uvicorn's threadpool, so an /analyze snapshot can
        # race a concurrent cell edit. Guard the frame so a read sees a consistent
        # table and writes serialize.
        self._lock = threading.Lock()

    @property
    def n(self) -> int:
        return len(self._df)

    def snapshot(self) -> pd.DataFrame:
        """A consistent, caller-owned copy of the whole frame, taken under the
        lock so it can't tear against a concurrent edit. Compute reads
        this directly instead of round-tripping the frame through a row list — a
        vectorized copy, not the per-cell boxing `records` pays."""
        with self._lock:
            return self._df.copy()

    def window(self, start: int, end: int) -> list[dict]:
        with self._lock:
            start = max(0, start)
            end = min(self.n, max(start, end))
            return records(self._df.iloc[start:end])

    def _row_pos(self, row_id: str) -> int:
        hits = self._df.index[self._df["id"].astype(str) == str(row_id)]
        if len(hits) == 0:
            raise KeyError(f"unknown row id {row_id!r}")
        return int(hits[0])

    def edit_cell(self, row_id: str, column: str, value) -> None:
        with self._lock:
            if column not in self._df.columns:
                raise KeyError(f"unknown column {column!r}")
            pos = self._row_pos(row_id)
            self._df.at[pos, column] = value
            self.version += 1

    def relabel_category(self, column: str, from_label: str, to_label: str) -> dict:
        """Rename a categorical level across every row that carries it — the tidy
        effect of renaming a leaf/group header in the grouped sheet. Honest about
        loss: if `to_label` already exists as a sibling level, the rename *merges*
        the two (their rows now share a level → two grouped columns collapse into
        one), so we report `merged` and let the UI state it. Schema levels, if the
        column carries an explicit list, are kept in sync (renamed, deduped on
        merge). Bumps `version`."""
        with self._lock:
            if column not in self._df.columns:
                raise KeyError(f"unknown column {column!r}")
            col = self._df[column]
            mask = col.astype(str) == str(from_label)
            n = int(mask.sum())
            if n == 0:
                raise KeyError(f"no rows with {column}={from_label!r}")
            merged = bool((col.astype(str) == str(to_label)).any())
            self._df.loc[mask, column] = to_label
            # rebuild schema as a copy (never mutate the caller's dict) so an
            # explicit level list follows the rename, deduped on merge.
            def _relabel_levels(c: dict) -> dict:
                if c["name"] != column or c.get("levels") is None:
                    return c
                renamed = [to_label if x == from_label else x for x in c["levels"]]
                seen: list = []      # dedupe on merge, preserving order
                for x in renamed:
                    if x not in seen:
                        seen.append(x)
                return {**c, "levels": seen}
            self.schema = {**self.schema,
                           "columns": [_relabel_levels(c) for c in self.schema["columns"]]}
            self.version += 1
            return {"n": n, "merged": merged}

    def delete_rows(self, ids: list[str]) -> int:
        """Drop the given tidy rows by id — the effect of deleting a grouped column
        (a full factor combination) or a band (an outer factor value); the grouped
        sheet supplies the ids from the pivot it already holds. Lossy by definition,
        so it returns the number actually removed for the UI to state. Unknown ids
        are ignored (idempotent). Only bumps `version` if something was dropped."""
        with self._lock:
            want = {str(i) for i in ids}
            mask = self._df["id"].astype(str).isin(want)
            n = int(mask.sum())
            if n:
                self._df = self._df[~mask].reset_index(drop=True)
                self.version += 1
            return n

    def add_level(self, factor: str, level: str) -> dict:
        """Add a new level to a categorical factor, blank across the design — the
        tidy effect of adding a column in the grouped sheet. For every existing
        combination of the *other* factors it appends `depth` fresh rows (depth =
        the current max replicate count per full factor combination), each
        carrying the new level and a blank value, so the new grouped column
        arrives full-height and immediately editable. Pure addition (not lossy).
        Rejects a level that already exists (that would silently pad existing
        columns, not add one). If the factor carries an explicit schema level
        list, the new level is appended to it. Bumps `version`; returns how many
        rows were appended and their layout (combinations × depth)."""
        with self._lock:
            if factor not in self._df.columns:
                raise KeyError(f"unknown column {factor!r}")
            cats = [c["name"] for c in self.schema["columns"]
                    if c.get("type") == "categorical" and c["name"] in self._df.columns]
            if factor not in cats:
                raise KeyError(f"{factor!r} is not a categorical factor")
            level = str(level)
            if (self._df[factor].astype(str) == level).any():
                raise KeyError(f"level {level!r} already exists in {factor!r}")
            value_cols = [c["name"] for c in self.schema["columns"]
                          if c.get("type") == "numeric"]
            others = [c for c in cats if c != factor]
            # replicate depth = tallest full-combination group today, so the new
            # column runs the full height of the grid rather than a lone cell.
            depth = 1 if self._df.empty else max(
                int(self._df.groupby(cats, dropna=False).size().max()), 1)
            combos = (self._df[others].drop_duplicates().to_dict(orient="records")
                      if others else [{}])
            new_rows = []
            for combo in combos:
                for _ in range(depth):
                    row = {**combo, factor: level}
                    for v in value_cols:
                        row[v] = float("nan")
                    row["id"] = uuid.uuid4().hex
                    new_rows.append(row)
            add_df = pd.DataFrame(new_rows).reindex(columns=self._df.columns)
            self._df = pd.concat([self._df, add_df], ignore_index=True)
            # keep an explicit level list in sync (append, never mutating caller's)
            def _add_level(c: dict) -> dict:
                if c["name"] != factor or c.get("levels") is None:
                    return c
                return {**c, "levels": [*c["levels"], level]}
            self.schema = {**self.schema,
                           "columns": [_add_level(c) for c in self.schema["columns"]]}
            self.version += 1
            return {"added": len(new_rows), "combos": len(combos), "depth": depth}

    def drop_column(self, column: str) -> dict:
        """Remove a categorical factor column entirely — the tidy effect of
        deleting a grouping row in the grouped sheet. Lossy: the factor's labels
        are gone and rows that differed only by it become undifferentiated
        replicates (no rows are dropped, only the column). Refuses to drop the
        value column or the id (only a categorical factor). Keeps the schema in
        sync (a copy, never mutating the caller's). Bumps `version`."""
        with self._lock:
            if column not in self._df.columns:
                raise KeyError(f"unknown column {column!r}")
            col_def = next((c for c in self.schema["columns"] if c["name"] == column), None)
            if col_def is None or col_def.get("type") != "categorical":
                raise KeyError(f"{column!r} is not a categorical factor")
            self._df = self._df.drop(columns=[column])
            self.schema = {**self.schema,
                           "columns": [c for c in self.schema["columns"]
                                       if c["name"] != column]}
            self.version += 1
            return {"dropped": column}

    def set_schema(self, schema: dict) -> None:
        """Replace the column schema in place (types, labels, levels) without
        touching the data — the Data tab retypes a column (identifier↔classifier)
        and the engine must see the new type on the next analyze, or the frontend
        and engine silently disagree about which test ran. A schema-only change:
        the frame's values are unchanged, so no row is coerced or dropped. Bumps
        `version` so every result cache keyed on it invalidates."""
        with self._lock:
            missing = [c["name"] for c in schema["columns"]
                       if c["name"] not in self._df.columns]
            if missing:
                raise KeyError(f"schema columns not in table: {missing!r}")
            self.schema = schema
            self.version += 1

    def distinct(self, column: str) -> list[str]:
        with self._lock:
            if column not in self._df.columns:
                raise KeyError(f"unknown column {column!r}")
            vals = self._df[column].dropna().astype(str).unique().tolist()
        return sorted(vals)[: self._DISTINCT_CAP]

    def counts(self) -> dict:
        with self._lock:
            return {"total": self.n}


class SessionStore:
    """Process-global, thread-safe map of id -> SessionTable. Bounded LRU so a
    long session of re-imports can't grow without limit."""

    def __init__(self, maxlen: int = 8):
        self._tables: dict[str, SessionTable] = {}
        self._order: list[str] = []
        self._maxlen = maxlen
        self._lock = threading.Lock()

    def ensure_capacity(self, n: int) -> None:
        """Raise the LRU bound so at least `n` freshly-created tables coexist.

        A loaded multi-table document creates one session per table in a burst and
        needs them ALL resident at once — the load response hands their ids back
        and the frontend references them on the next analyze/save. Without this the
        default bound silently evicts the earliest tables of a >maxlen document
        before the load loop ends, handing back dead ids (data loss). Only grows
        the bound (to the largest document loaded this process); never shrinks it,
        so a smaller later load can't drop a still-referenced table."""
        with self._lock:
            self._maxlen = max(self._maxlen, n)

    def create(self, schema: dict, df: pd.DataFrame) -> str:
        tid = uuid.uuid4().hex
        with self._lock:
            self._tables[tid] = SessionTable(schema, df)
            self._order.append(tid)
            while len(self._order) > self._maxlen:
                self._tables.pop(self._order.pop(0), None)
        return tid

    def get(self, tid: str | None) -> SessionTable | None:
        if not tid:
            return None
        with self._lock:
            t = self._tables.get(tid)
            if t is not None:
                # True LRU: a get IS a use, so refresh recency. The table the
                # frontend actively analyzes/saves (always the same id) is touched
                # on every request, so it now never evicts under a burst of
                # derived-table creates — without refreshing here, eviction was
                # FIFO-by-creation and the main table (created first) was the first
                # to go, silently breaking a later save.
                self._order.remove(tid)
                self._order.append(tid)
            return t
