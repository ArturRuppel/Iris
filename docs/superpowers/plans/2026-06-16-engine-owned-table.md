# Engine-Owned Table (Single Source of Truth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine the single owner of the data table so the browser holds only the visible viewport, not all N rows — removing the duplicate full-table copy in `rowsAtom` and the per-edit re-upload.

**Architecture:** Introduce a server-side, mutable, stably-identified **session table** (a pandas DataFrame + schema + monotonic version) created on import / sample / document-load. The browser's `DataTable` switches from ag-grid's client-side row model (`rowData={rows}`) to the **Infinite Row Model** (community edition), fetching row windows by session id. Cell edits and exclusion toggles become small ops against the session table that bump its version; compute (analyze/reduce/export) and save resolve the table by session id instead of re-shipping rows. `rowsAtom` stops holding the dataset.

**Tech Stack:** Python 3 / FastAPI / pandas (engine); React / Jotai / ag-grid-community Infinite Row Model (frontend); pytest (engine tests); Playwright (frontend e2e).

**Why phased:** Phase A is a self-contained backend addition with full pytest coverage and ships independently (nothing consumes it yet). Phases B–D cut the frontend over in read → write → cleanup order, each leaving the app working.

**Pre-req note:** The working tree already contains the uncommitted `.iris`/Parquet change (`document.py`, `main.py`, `App.tsx`, requirements). Commit or stash that first so this plan's commits are clean and independently revertable.

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `engine/iris_engine/session.py` | **New.** `SessionStore` + `SessionTable`: mutable DataFrame-backed table with stable id, windowed reads, cell/exclusion mutation, distinct-levels, version counter. | A |
| `engine/tests/test_session.py` | **New.** Unit tests for the session table. | A |
| `engine/iris_engine/main.py` | Wire session endpoints (`/table/create`, `/table/{id}/rows`, `/table/{id}/edit`, `/table/{id}/exclude`, `/table/{id}/distinct`); resolve compute + save by session id; create a session on `/sample`. | A, C, D |
| `engine/tests/test_engine.py` | Extend: compute-by-session-id, save-by-session-id. | C, D |
| `src/types.ts` | Engine client methods for the new endpoints; `TableHandle` type. | B, C, D |
| `src/state.ts` | `tableHandleAtom` (id + version + schema + n) replaces full-row ownership; `rowsAtom` retired from the data path; exclusion/edit/level atoms call ops. | B, C, D |
| `src/components/DataTable.tsx` | Infinite Row Model datasource; ops on edit. | B, C |
| `src/components/FigurePane.tsx` | Source the excluded-count from the table handle, not `rows`. | C |
| `src/App.tsx` | Drop the upload-to-token effect; load paths create a session; save/export by id. | B, D |
| `e2e/` | Update fixtures that asserted client-side grid behavior. | B, C |

---

## Phase A — Backend session table (independently shippable)

### Task A1: `SessionTable` — construction, identity, windowed read

**Files:**
- Create: `engine/iris_engine/session.py`
- Test: `engine/tests/test_session.py`

- [ ] **Step 1: Write the failing test**

```python
# engine/tests/test_session.py
import pandas as pd
import pytest
from iris_engine import session


SCHEMA = {"schema_version": "1.0", "columns": [
    {"name": "g", "type": "categorical", "label": "G", "levels": ["a", "b"]},
    {"name": "y", "type": "numeric", "label": "Y"},
]}


def _df(n=5):
    return pd.DataFrame({
        "id": [str(i + 1) for i in range(n)],
        "excluded": [False] * n,
        "g": (["a", "b"] * n)[:n],
        "y": [float(i) for i in range(n)],
    })


def test_create_returns_id_and_window():
    store = session.SessionStore()
    tid = store.create(SCHEMA, _df())
    t = store.get(tid)
    assert t is not None
    assert t.n == 5
    assert t.version == 0
    win = t.window(0, 2)
    assert [r["id"] for r in win] == ["1", "2"]
    assert win[0]["y"] == 0.0 and win[0]["g"] == "a"


def test_window_clamps_and_handles_nan_as_none():
    store = session.SessionStore()
    df = _df(3)
    df.loc[1, "y"] = float("nan")
    tid = store.create(SCHEMA, df)
    t = store.get(tid)
    win = t.window(1, 99)             # end past the tail clamps
    assert win[0]["y"] is None        # NaN -> JSON null
    assert len(win) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_session.py -q`
Expected: FAIL with `AttributeError: module 'iris_engine.session' has no attribute 'SessionStore'`

- [ ] **Step 3: Write minimal implementation**

```python
# engine/iris_engine/session.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_session.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/session.py engine/tests/test_session.py
git commit -m "feat(session): DataFrame-backed session table with windowed reads"
```

---

### Task A2: Mutation ops — edit cell, toggle exclusion, distinct levels

**Files:**
- Modify: `engine/iris_engine/session.py`
- Test: `engine/tests/test_session.py`

- [ ] **Step 1: Write the failing test**

```python
# append to engine/tests/test_session.py
def test_edit_cell_bumps_version_and_persists():
    store = session.SessionStore()
    tid = store.create(SCHEMA, _df())
    t = store.get(tid)
    t.edit_cell("2", "y", 99.0)
    assert t.version == 1
    assert t.window(1, 2)[0]["y"] == 99.0


def test_edit_unknown_row_or_column_raises():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df()))
    with pytest.raises(KeyError):
        t.edit_cell("nope", "y", 1.0)
    with pytest.raises(KeyError):
        t.edit_cell("1", "nope", 1.0)


def test_toggle_exclusion_returns_new_state():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df()))
    assert t.toggle_exclusion("1") is True
    assert t.window(0, 1)[0]["excluded"] is True
    assert t.toggle_exclusion("1") is False
    assert t.version == 2


def test_distinct_levels_sorted_strings_capped():
    store = session.SessionStore()
    df = _df(6)
    df["g"] = ["b", "a", "c", "a", "b", "a"]
    t = store.get(store.create(SCHEMA, df))
    assert t.distinct("g") == ["a", "b", "c"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_session.py -q`
Expected: FAIL with `AttributeError: 'SessionTable' object has no attribute 'edit_cell'`

- [ ] **Step 3: Write minimal implementation**

```python
# in engine/iris_engine/session.py, add to SessionTable

_DISTINCT_CAP = 1000  # the editor only needs a bounded level list

    def _row_pos(self, row_id: str) -> int:
        hits = self._df.index[self._df["id"].astype(str) == str(row_id)]
        if len(hits) == 0:
            raise KeyError(f"unknown row id {row_id!r}")
        return int(hits[0])

    def edit_cell(self, row_id: str, column: str, value) -> None:
        if column not in self._df.columns:
            raise KeyError(f"unknown column {column!r}")
        pos = self._row_pos(row_id)
        self._df.at[pos, column] = value
        self.version += 1

    def toggle_exclusion(self, row_id: str) -> bool:
        pos = self._row_pos(row_id)
        new = not bool(self._df.at[pos, "excluded"])
        self._df.at[pos, "excluded"] = new
        self.version += 1
        return new

    def distinct(self, column: str) -> list[str]:
        if column not in self._df.columns:
            raise KeyError(f"unknown column {column!r}")
        vals = self._df[column].dropna().astype(str).unique().tolist()
        return sorted(vals)[: self._DISTINCT_CAP]
```

Note: `_DISTINCT_CAP` is a class attribute — place it inside the `SessionTable` class body (above the methods), not at module scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_session.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/session.py engine/tests/test_session.py
git commit -m "feat(session): cell edit, exclusion toggle, distinct levels"
```

---

### Task A3: Session endpoints + `/sample` creates a session

**Files:**
- Modify: `engine/iris_engine/main.py` (add request models near the others ~line 30–90; add a module-level `_SESSIONS`; add endpoints near the other `@app.post` routes ~line 374; change `/sample` ~line 369)
- Test: `engine/tests/test_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# append to engine/tests/test_engine.py
from fastapi.testclient import TestClient
from iris_engine.main import app

client = TestClient(app)


def test_session_create_window_and_ops():
    rows = [{"id": str(i + 1), "excluded": False, "treatment": "control",
             "dose": float(i), "response": float(i)} for i in range(40)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    cid = client.post("/table/create", json={"table": table}).json()
    assert cid["n"] == 40 and cid["version"] == 0 and "id" in cid
    tid = cid["id"]

    win = client.post(f"/table/{tid}/rows", json={"start": 0, "end": 10}).json()
    assert len(win["rows"]) == 10 and win["rows"][0]["id"] == "1"

    ex = client.post(f"/table/{tid}/exclude", json={"row_id": "1"}).json()
    assert ex["excluded"] is True and ex["version"] == 1

    ed = client.post(f"/table/{tid}/edit",
                     json={"row_id": "2", "column": "dose", "value": 7.0}).json()
    assert ed["version"] == 2

    dist = client.post(f"/table/{tid}/distinct", json={"column": "treatment"}).json()
    assert dist["values"] == ["control"]


def test_session_missing_id_is_409():
    r = client.post("/table/deadbeef/rows", json={"start": 0, "end": 5})
    assert r.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && python -m pytest tests/test_engine.py -q -k session`
Expected: FAIL (404 — routes not defined yet)

- [ ] **Step 3: Write minimal implementation**

```python
# in engine/iris_engine/main.py

from . import session as session_mod   # add near the other `from . import` lines

_SESSIONS = session_mod.SessionStore()  # add near _TABLE_CACHE


class CreateSessionRequest(BaseModel):
    table: dict


class WindowRequest(BaseModel):
    start: int = 0
    end: int = 100


class EditRequest(BaseModel):
    row_id: str
    column: str
    value: object | None = None


class ExcludeRequest(BaseModel):
    row_id: str


class DistinctRequest(BaseModel):
    column: str


def _session_or_409(tid: str) -> "session_mod.SessionTable":
    t = _SESSIONS.get(tid)
    if t is None:
        raise HTTPException(409, "session table not found; reload the data")
    return t


@app.post("/table/create")
def table_create(req: CreateSessionRequest):
    """Build the server-owned session table from a {schema, rows|columns} payload
    and return its stable id + row count + version. The browser keeps the id, not
    the rows."""
    schema = req.table["schema"]
    df = frame_from_table(req.table)
    if "id" not in df:
        df.insert(0, "id", [str(i + 1) for i in range(len(df))])
    if "excluded" not in df:
        df["excluded"] = False
    tid = _SESSIONS.create(schema, df)
    t = _SESSIONS.get(tid)
    return {"id": tid, "n": t.n, "version": t.version, "schema": schema}


@app.post("/table/{tid}/rows")
def table_rows(tid: str, req: WindowRequest):
    t = _session_or_409(tid)
    return fast_json({"rows": t.window(req.start, req.end),
                      "n": t.n, "version": t.version})


@app.post("/table/{tid}/edit")
def table_edit(tid: str, req: EditRequest):
    t = _session_or_409(tid)
    try:
        t.edit_cell(req.row_id, req.column, req.value)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"version": t.version}


@app.post("/table/{tid}/exclude")
def table_exclude(tid: str, req: ExcludeRequest):
    t = _session_or_409(tid)
    try:
        excluded = t.toggle_exclusion(req.row_id)
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
    return {"excluded": excluded, "version": t.version}


@app.post("/table/{tid}/distinct")
def table_distinct(tid: str, req: DistinctRequest):
    t = _session_or_409(tid)
    try:
        return {"values": t.distinct(req.column)}
    except KeyError as e:
        raise HTTPException(422, str(e)) from e
```

Change `/sample` so a session is created up front and the full rows are not the contract:

```python
@app.get("/sample")
def sample():
    data = document.load_sample()                       # {schema, rows}
    tid = _SESSIONS.create(data["schema"],
                           frame_from_table(data))
    t = _SESSIONS.get(tid)
    return {"id": tid, "n": t.n, "version": t.version,
            "schema": data["schema"], "rows": t.window(0, 200)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && python -m pytest tests/test_engine.py -q -k session`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full engine suite (no regressions)**

Run: `cd engine && python -m pytest tests/test_engine.py -q`
Expected: PASS (all previously-passing tests still pass; `/sample` shape changed but no test asserted its old shape — confirm)

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_engine.py
git commit -m "feat(api): session-table endpoints; /sample creates a session"
```

---

## Phase B — Frontend read path (grid pulls windows, stops owning rows)

### Task B1: Engine client + `TableHandle` type

**Files:**
- Modify: `src/types.ts` (engine object ~line 470; add `TableHandle` near the other table types)

- [ ] **Step 1: Add the type and client methods**

```typescript
// src/types.ts — near the Table types
export interface TableHandle {
  id: string;
  n: number;
  version: number;
  schema: Schema;
}

// inside the `engine` object literal:
  createSession: (table: Table) =>
    post<{ id: string; n: number; version: number; schema: Schema }>(
      "/table/create", { table }),
  rowsWindow: (id: string, start: number, end: number) =>
    post<{ rows: Row[]; n: number; version: number }>(
      `/table/${id}/rows`, { start, end }),
  editCell: (id: string, rowId: string, column: string, value: unknown) =>
    post<{ version: number }>(`/table/${id}/edit`,
      { row_id: rowId, column, value }),
  toggleExclude: (id: string, rowId: string) =>
    post<{ excluded: boolean; version: number }>(`/table/${id}/exclude`,
      { row_id: rowId }),
  distinct: (id: string, column: string) =>
    post<{ values: string[] }>(`/table/${id}/distinct`, { column }),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(client): session-table engine methods + TableHandle"
```

---

### Task B2: `tableHandleAtom` and load paths create a session

**Files:**
- Modify: `src/state.ts` (`tableTokenAtom` ~line 472; `loadTableAtom` ~line 192; `loadDocumentAtom` ~line 275)
- Modify: `src/App.tsx` (the upload-to-token effect ~line 124; `/sample` + load wiring)

- [ ] **Step 1: Add the handle atom**

```typescript
// src/state.ts — replaces the role of tableTokenAtom for the data path
import type { TableHandle } from "./types";
export const tableHandleAtom = atom<TableHandle | null>(null);
```

- [ ] **Step 2: Load paths set the handle instead of full rows**

In `loadTableAtom` and `loadDocumentAtom`, the incoming payload now carries a
session `id`/`n`/`version`. Set `tableHandleAtom` and seed `rowsAtom` with only
the first window the server returned (used for the figure's excluded-count until
Phase C moves that server-side). Replace the `set(rowsAtom, table.rows)` /
`set(rowsAtom, doc.rows)` lines accordingly, e.g.:

```typescript
// loadTableAtom
set(tableHandleAtom, { id: table.id, n: table.n, version: table.version,
                       schema: table.schema });
set(rowsAtom, table.rows ?? []);          // first window only (preview)
```

Update the `Table` type (and `loadTable` callers) so `id/n/version` are present;
`/sample` and `/document/load` now return them (document/load wiring is Task D2 —
until then keep a fallback that calls `engine.createSession({schema, rows})` when
`id` is absent).

- [ ] **Step 3: Replace the upload-to-token effect in App.tsx**

The effect at `src/App.tsx:124` uploaded `rowsAtom` to `/table` to mint a token.
Delete it. Compute now references `tableHandleAtom.id` directly (Task C2 swaps the
analyze/reduce calls). For this task, set `tableToken` ← `handle.id` so the existing
analyze/reduce effects keep working unchanged:

```typescript
const handle = useAtomValue(tableHandleAtom);
useEffect(() => { setTableToken(handle?.id ?? null); }, [handle?.id]);
```

(The compute endpoints already resolve `table_token`; Task C3 points them at the
session store so an id resolves.)

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npx tsc --noEmit` → clean.
Start engine + vite; load the sample. Expect the figure to render (compute still
works because `table_token` now carries the session id, resolved in Task C3 — so
do B2 and C3 in the same review batch, or temporarily keep `/table` alive).

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/App.tsx
git commit -m "feat(state): table handle replaces full-row upload"
```

---

### Task B3: `DataTable` Infinite Row Model datasource

**Files:**
- Modify: `src/components/DataTable.tsx` (the `<AgGridReact>` block ~line 135; remove `rowData={rows}`)

- [ ] **Step 1: Replace client-side rows with an infinite datasource**

ag-grid-community ships the Infinite Row Model in `AllCommunityModule` (already
registered). Swap `rowData` for `rowModelType="infinite"` + a datasource that
pages by window:

```tsx
import { useMemo, useRef, type CSSProperties } from "react";
import type { GridApi, IDatasource } from "ag-grid-community";
// ...
const handle = useAtomValue(tableHandleAtom);
const gridApiRef = useRef<GridApi<Row> | null>(null);

const datasource = useMemo<IDatasource>(() => ({
  rowCount: handle?.n,
  getRows: async (params) => {
    if (!handle) { params.failCallback(); return; }
    try {
      const { rows, n } = await engine.rowsWindow(
        handle.id, params.startRow, params.endRow);
      params.successCallback(rows, n);     // n = known last row -> exact count
    } catch {
      params.failCallback();
    }
  },
}), [handle?.id, handle?.version]);   // version bump (Phase C) refetches
```

On the grid:

```tsx
<AgGridReact<Row>
  theme={theme}
  rowModelType="infinite"
  datasource={datasource}
  cacheBlockSize={200}
  maxBlocksInCache={10}
  columnDefs={columnDefs}
  getRowId={(p) => p.data.id}
  suppressFieldDotNotation
  readOnlyEdit
  onCellEditRequest={onCellEditRequest}
  onGridReady={(e) => { gridApiRef.current = e.api; }}
  rowClassRules={{ excluded: (p) => !!p.data?.excluded }}
  /* ...unchanged props... */
/>
```

Remove the `rowData={rows}` line and the `const included = rows.filter(...)`
footer count (replace the footer with `handle?.n` total; the included/excluded
split moves server-side in Task C1 — for now show only the total).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Manual verify the grid scrolls and pages**

Start engine + vite, load the sample (or import `cells_by_frame`). Scroll the
grid: rows load in blocks (watch the network tab for `/table/{id}/rows` calls).
Confirm a wide import doesn't ship all rows on load.

- [ ] **Step 4: Update e2e that assumed client-side rows**

Run: `node e2e/plottables_test.mjs` (and the others). Where a test read all rows
from the DOM, switch to asserting the first visible block. Fix until each exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/DataTable.tsx e2e/
git commit -m "feat(ui): DataTable pulls row windows (infinite row model)"
```

---

## Phase C — Frontend write path (edits as ops, version-driven invalidation)

### Task C1: Server reports included/excluded counts on the handle

**Files:**
- Modify: `engine/iris_engine/session.py` (`SessionTable`)
- Modify: `engine/iris_engine/main.py` (include counts in `/table/create`, `/sample`, and op responses)
- Test: `engine/tests/test_session.py`

- [ ] **Step 1: Write the failing test**

```python
# append to engine/tests/test_session.py
def test_counts_reflect_exclusions():
    store = session.SessionStore()
    t = store.get(store.create(SCHEMA, _df(4)))
    assert t.counts() == {"total": 4, "excluded": 0}
    t.toggle_exclusion("1")
    assert t.counts() == {"total": 4, "excluded": 1}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_session.py -q -k counts`
Expected: FAIL (`'SessionTable' object has no attribute 'counts'`)

- [ ] **Step 3: Implement `counts()` and surface it**

```python
# SessionTable
    def counts(self) -> dict:
        excluded = int(self._df["excluded"].fillna(False).astype(bool).sum())
        return {"total": self.n, "excluded": excluded}
```

Add `**t.counts()` (or a `"counts"` key) to the `/table/create`, `/sample`,
`/table/{id}/exclude`, and `/table/{id}/edit` responses.

- [ ] **Step 4: Run tests**

Run: `cd engine && python -m pytest tests/test_session.py -q`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/session.py engine/iris_engine/main.py engine/tests/test_session.py
git commit -m "feat(session): excluded/total counts on the handle"
```

---

### Task C2: Edits + exclusions call ops; FigurePane reads the count

**Files:**
- Modify: `src/components/DataTable.tsx` (`onCellEditRequest` ~line 90)
- Modify: `src/state.ts` (`toggleExclusionAtom` ~line 97; `setColumnRoleAtom` ~line 523)
- Modify: `src/components/FigurePane.tsx` (`nExcluded` ~line 223)

- [ ] **Step 1: Route grid edits through the engine**

```tsx
// DataTable onCellEditRequest
const setHandle = useSetAtom(tableHandleAtom);
const onCellEditRequest = async (e: CellEditRequestEvent<Row>) => {
  if (!handle) return;
  const field = e.colDef.field!;
  if (field === "excluded") {
    const { version, ...counts } = await engine.toggleExclude(handle.id, e.data.id);
    logExclusion(e.data.id /* state set elsewhere */);
    setHandle({ ...handle, version, ...counts });
    return;
  }
  const col = schema.columns.find((c) => c.name === field);
  let value = e.newValue as unknown;
  if (col?.type === "numeric")
    value = value == null || value === "" || Number.isNaN(Number(value))
      ? null : Number(value);
  else if (col?.type === "bool")
    value = value == null || value === "" ? null
      : value === "true" || value === true;
  const { version } = await engine.editCell(handle.id, e.data.id, field, value);
  setHandle({ ...handle, version });
};
```

Bumping `handle.version` re-creates the datasource (Task B3 dep list), so the
grid refetches the affected block and compute (Task C3) re-runs.

- [ ] **Step 2: `toggleExclusionAtom` keeps only the provenance log**

The exclusion *state* now lives server-side; the atom keeps logging provenance.
Reduce it to appending an `ExclusionEvent` (drop the `rowsAtom` mutation):

```typescript
export const toggleExclusionAtom = atom(null,
  (get, set, arg: { rowId: string; excluded: boolean }) => {
    set(exclusionLogAtom, [...get(exclusionLogAtom),
      { row_id: arg.rowId, excluded: arg.excluded, at: new Date().toISOString() }]);
  });
```

Update its callers (FigurePane point-menu exclude, DataTable) to call
`engine.toggleExclude` then log with the returned `excluded`.

- [ ] **Step 3: `setColumnRoleAtom` derives levels from the server**

Replace the `rows.map(...)` level derivation with `engine.distinct(handle.id, name)`.
Make the atom async or pre-fetch the values before setting the schema:

```typescript
// caller (HierarchyPanel) fetches first, then dispatches with levels in hand
const values = await engine.distinct(handle.id, name);
setColumnRole({ name, role, levels: values });
```

- [ ] **Step 4: FigurePane excluded-count from the handle**

```tsx
const handle = useAtomValue(tableHandleAtom);
const nExcluded = handle?.schema ? /* counts carried on handle */ excludedCount : 0;
```

Carry `excluded` on `tableHandleAtom` (Task C1 returns it) and read it here
instead of `rows.filter((r) => r.excluded).length`.

- [ ] **Step 5: Typecheck + manual verify**

Run: `npx tsc --noEmit` → clean. Then: edit a numeric cell → it persists and the
figure re-renders; click ✕ on a row → it greys out and the excluded count and the
figure update; change a column's role in the Data tab → levels populate.

- [ ] **Step 6: Update e2e + commit**

Run the `aesthetics`, `drag`, `layers`, `plottables`, `resize` e2e; fix any that
toggled exclusions via the old client-side path. Then:

```bash
git add src/components/DataTable.tsx src/components/FigurePane.tsx src/state.ts e2e/
git commit -m "feat(ui): cell edits & exclusions are server ops"
```

---

### Task C3: Compute resolves the session table by id

**Files:**
- Modify: `engine/iris_engine/main.py` (`_resolve_table` ~line 108; `/analyze`, `/reduce`, `/hierarchy`, `/export`)
- Test: `engine/tests/test_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# append to engine/tests/test_engine.py
def test_analyze_by_session_id():
    rows = [{"id": str(i + 1), "excluded": False,
             "treatment": "control" if i < 20 else "drug_a",
             "dose": float(i % 10), "response": float(i)} for i in range(40)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    tid = client.post("/table/create", json={"table": table}).json()["id"]
    spec = make_spec()                       # existing helper
    r = client.post("/analyze", json={"table_token": tid, "spec": spec})
    assert r.status_code == 200
    assert "figure" in r.json()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_engine.py -q -k analyze_by_session`
Expected: FAIL (409 "table not cached" — `_resolve_table` doesn't know session ids)

- [ ] **Step 3: Teach `_resolve_table` about the session store**

```python
def _resolve_table(table: dict | None, token: str | None) -> dict:
    if table is not None:
        if token:
            _TABLE_CACHE.setdefault(token, table)
        return table
    sess = _SESSIONS.get(token)
    if sess is not None:
        return {"schema": sess.schema, "rows": sess.window(0, sess.n)}
    if token and token in _TABLE_CACHE:
        return _TABLE_CACHE[token]
    raise HTTPException(409, "table not cached; resend full table")
```

(`sess.window(0, n)` returns the full row list for compute; pandas already holds
it, so this is an in-process slice, not a transfer. A later optimization can hand
the DataFrame straight to `_load_frame` without the dict round-trip.)

- [ ] **Step 4: Run tests**

Run: `cd engine && python -m pytest tests/test_engine.py -q`
Expected: PASS (all)

- [ ] **Step 5: Point the frontend compute calls at the id (cleanup)**

Now that ids resolve, replace `{ token: tableToken }` with `{ token: handle.id }`
(or rename the `TableRef`/`tableField` token key to `table_token: id`) in the
analyze/reduce/export effects, and drop the temporary `setTableToken(handle.id)`
shim from Task B2. The analyze/reduce effect dep arrays add `handle?.version` so
an edit re-runs compute.

- [ ] **Step 6: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_engine.py src/App.tsx
git commit -m "feat(api): compute resolves the session table by id"
```

---

## Phase D — Cleanup (save/export/load by id, delete dead row-ownership)

### Task D1: Save resolves the session table by id

**Files:**
- Modify: `engine/iris_engine/main.py` (`SaveRequest` ~line 56; `/document/save` ~line 494)
- Modify: `src/types.ts` (`saveDocument`); `src/App.tsx` (`doSave` ~line 230)
- Test: `engine/tests/test_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# append to engine/tests/test_engine.py
def test_save_by_session_id_roundtrips():
    rows = [{"id": str(i + 1), "excluded": False, "treatment": "control",
             "dose": float(i), "response": float(i)} for i in range(5)]
    table = {"schema": document.SAMPLE_SCHEMA, "rows": rows}
    tid = client.post("/table/create", json={"table": table}).json()["id"]
    saved = client.post("/document/save", json={
        "table_id": tid, "analyses": [make_spec()],
        "provenance": {"exclusions": []}}).json()
    assert saved["filename"] == "document.iris"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && python -m pytest tests/test_engine.py -q -k save_by_session`
Expected: FAIL (422 — `SaveRequest` requires `table`, not `table_id`)

- [ ] **Step 3: Accept a `table_id` on save**

```python
class SaveRequest(BaseModel):
    table: dict | None = None
    table_id: str | None = None
    analyses: list[dict]
    provenance: dict


@app.post("/document/save")
def doc_save(req: SaveRequest):
    table = _resolve_table(req.table, req.table_id)
    data = document.save_document(table["schema"], table["rows"],
                                  req.analyses, req.provenance, engine_snapshot())
    return {"filename": "document.iris",
            "data_base64": base64.b64encode(data).decode()}
```

Frontend `saveDocument(handle.id, analyses, provenance)` → posts `{ table_id }`.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd engine && python -m pytest tests/test_engine.py -q` → PASS.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/main.py engine/tests/test_engine.py src/types.ts src/App.tsx
git commit -m "feat(api): save the document by session id"
```

---

### Task D2: `/document/load` creates a session; export by id; delete `rowsAtom` data path

**Files:**
- Modify: `engine/iris_engine/main.py` (`/document/load` ~line 503)
- Modify: `src/App.tsx` (`doLoad` ~line 238; `doExport` ~line 224)
- Modify: `src/state.ts` (retire `rowsAtom` as the data store; remove `seededTokenAtom`, `tableEpoch` upload machinery)

- [ ] **Step 1: `/document/load` returns a session handle**

```python
@app.post("/document/load")
def doc_load(req: LoadRequest):
    try:
        doc = document.load_document(base64.b64decode(req.data_base64))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read document: {e}") from e
    tid = _SESSIONS.create(doc["schema"], frame_from_table(doc))
    t = _SESSIONS.get(tid)
    return {**doc, "id": tid, "n": t.n, "version": t.version,
            "rows": t.window(0, 200)}     # first window only
```

- [ ] **Step 2: Frontend load + export use the id; remove the fallback shim**

`doLoad` reads `id/n/version` and sets `tableHandleAtom` (remove the Task B2
`createSession` fallback). `doExport` always uses `{ token: handle.id }` (drop the
`{ schema, rows }` branch).

- [ ] **Step 3: Delete the dead row-ownership code**

Remove `seededTokenAtom`, the `tableEpoch`/`putTable` upload effect remnants, and
any remaining `set(rowsAtom, fullRows)`. `rowsAtom` either goes away or is retyped
to hold only the current preview window (document its new, narrow purpose).

- [ ] **Step 4: Full verification**

Run: `cd engine && python -m pytest tests/ -q` → all pass.
Run: `npx tsc --noEmit` → clean.
Run each `e2e/*.mjs` against a live engine + vite → all exit 0.
Manual: import `cells_by_frame` (82k rows) and confirm via the network tab that
load ships only a window, scrolling pages, edits/exclusions persist and re-render,
save produces a `.iris` that reopens identically.

- [ ] **Step 5: Commit**

```bash
git add engine/iris_engine/main.py src/App.tsx src/state.ts
git commit -m "feat: engine owns the table end-to-end; browser holds the viewport"
```

---

## Self-Review notes

- **Spec coverage:** windowed read (A1/B3), mutation ops (A2/C2), counts (C1), compute-by-id (C3), save-by-id (D1), load creates session (D2), `/sample` creates session (A3). All browser `rows` consumers identified earlier are reassigned: grid→infinite datasource (B3); FigurePane excluded-count→handle (C2/C1); `setColumnRole` levels→`distinct` (C2); save/export→id (D1/D2); edits/exclusions→ops (C2).
- **Type consistency:** `TableHandle = {id, n, version, schema}` (B1) is the single shape threaded through `tableHandleAtom`, load paths, datasource, and ops. Op responses return `{version}` / `{excluded, version, total, excluded}`; the handle is updated from them.
- **Known sequencing coupling:** B2 leaves a temporary `setTableToken(handle.id)` shim so the app keeps working before C3 makes ids resolve; review B2+C3 together (or keep `/table` alive until C3). Called out in B2 Step 3 and C3 Step 5.
- **Out of scope (YAGNI):** server-side sort/filter in the grid (no sort/filter exists today), session persistence across engine restarts, optimistic single-row patch instead of block refetch. Note these as follow-ups, don't build them.
- **Risk:** ag-grid Infinite Row Model + editing is the fiddly part; B3 + C2 are the tasks most likely to need iteration. The backend (Phase A) is low-risk and fully unit-tested.
