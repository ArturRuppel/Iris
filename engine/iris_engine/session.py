"""Server-owned session table: the single source of truth for the editable data.

Holds the table as a pandas DataFrame keyed by a stable id (not a content hash),
so cell edits mutate it in place and the browser never needs more than the rows
it is showing. A monotonic `version` bumps on every mutation; compute and the
grid use it to know the table changed."""
from __future__ import annotations

import threading
import uuid

import numpy as np
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

    def frame(self) -> pd.DataFrame:
        return self._df

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
