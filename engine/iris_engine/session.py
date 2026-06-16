"""Server-owned session table: the single source of truth for the editable data.

Holds the table as a pandas DataFrame keyed by a stable id (not a content hash),
so cell edits and exclusion toggles mutate it in place and the browser never
needs more than the rows it is showing. A monotonic `version` bumps on every
mutation; compute and the grid use it to know the table changed."""
from __future__ import annotations

import threading
import uuid

import numpy as np
import pandas as pd


def _records(df: pd.DataFrame) -> list[dict]:
    # object dtype so NaN/NaT survive the replace; then -> None for JSON null.
    return df.astype(object).where(pd.notnull(df), None).to_dict(orient="records")


class SessionTable:
    def __init__(self, schema: dict, df: pd.DataFrame):
        self.schema = schema
        self._df = df.reset_index(drop=True)
        self.version = 0

    @property
    def n(self) -> int:
        return len(self._df)

    def frame(self) -> pd.DataFrame:
        return self._df

    def window(self, start: int, end: int) -> list[dict]:
        start = max(0, start)
        end = min(self.n, max(start, end))
        return _records(self._df.iloc[start:end])


class SessionStore:
    """Process-global, thread-safe map of id -> SessionTable. Bounded LRU so a
    long session of re-imports can't grow without limit."""

    def __init__(self, maxlen: int = 8):
        self._tables: dict[str, SessionTable] = {}
        self._order: list[str] = []
        self._maxlen = maxlen
        self._lock = threading.Lock()

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
            return self._tables.get(tid)
