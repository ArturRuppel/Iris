# Multiple Input Tables — Plan B (Engine `.iris` format + frontend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Prerequisite: Plan A is merged** (the pool, `tableId`, `rightTableId`, and the materialized-right cache all exist).

**Goal:** Persist the full multi-table workspace in a self-contained, de-duplicated `.iris`: a top-level **`tables`** section (each table once, by name, with its schema + hierarchy + rows) and analyses that reference tables by name. Lifts Plan A's single-main-table save limitation.

**Design:** `docs/superpowers/specs/2026-06-27-multi-table-input-design.md` (§6.1 "Plan B", §3b).

**Architecture:** The `.iris` is engine-owned (`engine/iris_engine/document.py`, a ZIP of Parquet + JSON). Plan B teaches `save_document`/`load_document` a multi-table layout and back-compat reads of today's single-table 2.0 files, updates `/document/save` (accept several table sessions) and `/document/load` (create a session per table, return them all), and rewires the frontend save/load to round-trip pool tables by reference instead of inlining join rights.

**Tech Stack:** Python 3.13 + FastAPI + pandas/pyarrow, pytest (engine); TypeScript + Jotai + Vitest (frontend).

**Invariants:**
- **Back-compat read.** Iris still loads today's 2.0 single-table files (the CellFlow→Iris export contract) — migrated into the pool at load, no legacy branch past the loader.
- **De-duplicated.** Each table is stored once even if many analyses (or many joins) reference it.
- **No row truncation.** Save reads each session's *full* frame (as `/document/save` does today).
- Commit trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017eSJF9bsHq4JiSyLbe78uM
  ```

---

## File structure

- **Modify** `engine/iris_engine/document.py` — `save_document(tables, analyses, …)` (multi-table writer, `FORMAT_VERSION` → `"2.1"`); `load_document` reads 2.1 **and** 2.0.
- **Modify** `engine/iris_engine/main.py` — `SaveRequest`/`LoadRequest` models; `/document/save` resolves N sessions; `/document/load` creates N sessions and returns them.
- **Modify** `engine/tests/test_engine.py` (and/or `engine/tests/test_document.py` if present) — pytest for both formats + round-trip.
- **Modify** `src/types.ts` — `engine.saveDocument`/`loadDocument` signatures + `LoadedDocument` shape (`tables[]`).
- **Modify** `src/state.ts` — `loadDocumentAtom` rebuilds the pool from `tables[]`; drop the inline-right *save* resolution (now references); keep the 2.0 inline-right *load* migration only for legacy files surfaced by the engine.
- **Modify** `src/App.tsx` — save sends all pool tables + reference-bearing specs; remove the Plan-A single-main-table notice.

---

## Task 1: `save_document` writes the multi-table layout

**Files:** Modify `engine/iris_engine/document.py`; test in `engine/tests/test_document.py` (create if absent).

**Context.** Today: one `data/table.parquet` + `data/schema.json`. New 2.1 layout: `tables/<name>/table.parquet`, `tables/<name>/schema.json`, `tables/<name>/hierarchy.json`; analyses unchanged (they already carry `table_id`/`right_table_id` from Plan A).

- [ ] **Step 1 — failing test.**

```python
# engine/tests/test_document.py
import io, json, zipfile
from iris_engine import document

S = {"schema_version": "1.0", "columns": [{"name": "k", "type": "identifier", "label": "K"}]}

def test_save_writes_one_parquet_per_named_table():
    tables = {
        "cells":  {"schema": S, "hierarchy": {"spine": ["k"], "fn": {}}, "rows": [{"id": "1", "k": "a"}]},
        "annot":  {"schema": S, "hierarchy": {"spine": [], "fn": {}},   "rows": [{"id": "1", "k": "a"}]},
    }
    data = document.save_document(tables, [{"id": "an1", "table_id": "cells"}], {}, {})
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set(z.namelist())
        assert "tables/cells/table.parquet" in names
        assert "tables/cells/schema.json" in names
        assert "tables/cells/hierarchy.json" in names
        assert "tables/annot/table.parquet" in names
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["format_version"] == "2.1"
```

- [ ] **Step 2 — run, verify fail.** `cd engine && python -m pytest tests/test_document.py::test_save_writes_one_parquet_per_named_table -q` → FAIL.
- [ ] **Step 3 — implement.** Change the signature and writer:

```python
FORMAT_VERSION = "2.1"

def save_document(tables: dict, analyses: list[dict],
                  provenance: dict, engine_snapshot: dict) -> bytes:
    """`tables`: {name -> {schema, hierarchy, rows}}. Each is stored once; analyses
    reference tables by name (table_id / right_table_id)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps({
            "format_version": FORMAT_VERSION,
            "modified": datetime.now(timezone.utc).isoformat(),
            "engine": build_info.build_identity(),
            "engine_snapshot": engine_snapshot,
        }, indent=2))
        for name, t in tables.items():
            pq = io.BytesIO()
            pd.DataFrame(t["rows"]).to_parquet(pq, index=False, engine="pyarrow", compression="zstd")
            z.writestr(f"tables/{name}/table.parquet", pq.getvalue(), compress_type=zipfile.ZIP_STORED)
            z.writestr(f"tables/{name}/schema.json", json.dumps(t["schema"], indent=2))
            z.writestr(f"tables/{name}/hierarchy.json", json.dumps(t.get("hierarchy", {"spine": [], "fn": {}}), indent=2))
        for i, an in enumerate(analyses, 1):
            z.writestr(f"analyses/{i:02d}-{an.get('id', 'analysis')}.json", json.dumps(an, indent=2))
        z.writestr("provenance.json", json.dumps(provenance, indent=2))
    return buf.getvalue()
```

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(engine): save_document writes the multi-table 2.1 layout`).

---

## Task 2: `load_document` reads 2.1 and migrates legacy 2.0

**Files:** Modify `engine/iris_engine/document.py`; test in `engine/tests/test_document.py`.

- [ ] **Step 1 — failing test.**

```python
def test_load_roundtrips_2_1_tables():
    tables = {"cells": {"schema": S, "hierarchy": {"spine": ["k"], "fn": {}}, "rows": [{"id": "1", "k": "a"}]}}
    data = document.save_document(tables, [{"id": "an1", "table_id": "cells"}], {}, {})
    doc = document.load_document(data)
    assert set(doc["tables"]) == {"cells"}
    assert doc["tables"]["cells"]["rows"] == [{"id": "1", "k": "a"}]
    assert doc["tables"]["cells"]["hierarchy"]["spine"] == ["k"]
    assert doc["analyses"][0]["table_id"] == "cells"

def test_load_migrates_legacy_2_0_single_table():
    # build a 2.0 file with the OLD writer shape, assert load returns a one-entry `tables`.
    legacy = _legacy_2_0_bytes(S, [{"id": "1", "k": "a"}], [{"id": "an1"}])  # helper writes data/table.parquet
    doc = document.load_document(legacy)
    assert len(doc["tables"]) == 1
    name = next(iter(doc["tables"]))
    assert doc["tables"][name]["rows"] == [{"id": "1", "k": "a"}]
```

(The implementing agent writes `_legacy_2_0_bytes` to emit the 2.0 layout — `data/table.parquet` + `data/schema.json` — from the pre-Plan-B writer, or keeps a checked-in fixture `.iris`.)

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Branch on layout:

```python
def load_document(data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        manifest = json.loads(z.read("manifest.json"))
        if _version_tuple(manifest.get("format_version", "0")) > _version_tuple(FORMAT_VERSION):
            raise ValueError("document was saved by a newer version")
        names = z.namelist()
        analyses = [json.loads(z.read(n)) for n in sorted(names) if n.startswith("analyses/")]
        provenance = json.loads(z.read("provenance.json"))
        if any(n.startswith("tables/") for n in names):                      # 2.1
            tables = {}
            tnames = sorted({n.split("/")[1] for n in names if n.startswith("tables/")})
            for name in tnames:
                df = pd.read_parquet(io.BytesIO(z.read(f"tables/{name}/table.parquet")), engine="pyarrow")
                tables[name] = {
                    "schema": json.loads(z.read(f"tables/{name}/schema.json")),
                    "hierarchy": json.loads(z.read(f"tables/{name}/hierarchy.json")),
                    "rows": json.loads(df.to_json(orient="records")),
                }
        else:                                                                # legacy 2.0
            schema = json.loads(z.read("data/schema.json"))
            df = pd.read_parquet(io.BytesIO(z.read("data/table.parquet")), engine="pyarrow")
            tables = {"table_1": {"schema": schema, "hierarchy": {"spine": [], "fn": {}},
                                  "rows": json.loads(df.to_json(orient="records"))}}
    return {"manifest": manifest, "tables": tables, "analyses": analyses, "provenance": provenance}
```

(Legacy 2.0 join `right` tables stay inline in the analysis JSON; the frontend's existing migration — Plan A Task 9 — lifts them into the pool. So 2.0 files load as one pool table + frontend-migrated join rights.)

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(engine): load_document reads 2.1 and migrates legacy 2.0`).

---

## Task 3: `/document/save` resolves several sessions

**Files:** Modify `engine/iris_engine/main.py`; test in `engine/tests/test_engine.py` (TestClient).

**Context.** Today `SaveRequest` carries one `table`/`table_id`. New: a list of tables to embed, each a session id (or inline) + name + hierarchy.

- [ ] **Step 1 — failing test (TestClient):** create two sessions via `/table/create`, POST `/document/save` with both ids + an analysis referencing them, assert a base64 `.iris` returns and reloads (via Task 4) to two tables.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Extend the request model:

```python
class SaveTable(BaseModel):
    name: str
    table_id: str | None = None
    table: dict | None = None        # inline fallback
    hierarchy: dict = {"spine": [], "fn": {}}

class SaveRequest(BaseModel):
    tables: list[SaveTable]
    analyses: list[dict]
    provenance: dict = {}

@app.post("/document/save")
def doc_save(req: SaveRequest):
    tables = {}
    for st in req.tables:
        t = _resolve_table(st.table, st.table_id)
        rows = t["rows"] if "rows" in t else session_mod.records(t["frame"])
        tables[st.name] = {"schema": t["schema"], "hierarchy": st.hierarchy, "rows": rows}
    data = document.save_document(tables, req.analyses, req.provenance, engine_snapshot())
    return {"filename": "document.iris", "data_base64": base64.b64encode(data).decode()}
```

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(engine): /document/save embeds several named tables`).

---

## Task 4: `/document/load` creates a session per table

**Files:** Modify `engine/iris_engine/main.py`; test in `engine/tests/test_engine.py`.

- [ ] **Step 1 — failing test:** POST a 2.1 `.iris` to `/document/load`; assert the response `tables` is a list of `{name, id, n, version, schema, hierarchy, counts}` with a live session id each; assert analyses come back with their `table_id`/`right_table_id`.
- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.**

```python
@app.post("/document/load")
def doc_load(req: LoadRequest):
    try:
        doc = document.load_document(base64.b64decode(req.data_base64))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"could not read document: {e}") from e
    out = []
    for name, t in doc["tables"].items():
        tid = _SESSIONS.create(t["schema"], frame_from_table(t))
        s = _SESSIONS.get(tid)
        out.append({"name": name, "id": tid, "schema": t["schema"], "hierarchy": t["hierarchy"],
                    "n": s.n, "version": s.version, "counts": s.counts(),
                    "rows": s.window(0, 200)})
    return {"manifest": doc["manifest"], "analyses": doc["analyses"],
            "provenance": doc["provenance"], "tables": out}
```

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(engine): /document/load creates a session per named table`).

---

## Task 5: Frontend — save sends pool tables by reference

**Files:** Modify `src/types.ts`, `src/App.tsx`, `src/state.ts`, `src/state.test.ts`.

**Context.** Replace Plan A's inline-at-save with reference-bearing save: send every pool table the analyses reference, plus specs carrying `table_id`/`right_table_id` (no inline `right`). Remove `specForSave`'s inlining (Plan A Task 11) — specs now serialize references directly.

- [ ] **Step 1 — failing test.** A pure `saveTablesFor(plottables, pool)` returns the de-duplicated set of `{name, table_id, hierarchy}` for every table referenced as a main table or a join right:

```ts
it("saveTablesFor collects each referenced table once (main + join rights)", () => {
  // pool: cells, annot; two analyses both rooted in cells, one joining annot
  // → returns [cells, annot] once each.
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.**
  - `src/types.ts`: `saveDocument(tables: SaveTable[], analyses: AnalysisSpec[], provenance)` and `LoadedDocument` gains `tables: LoadedTable[]` (drop the single `id/n/version/schema/counts` top-level — they move into `tables[]`). `AnalysisSpec` join steps serialize `right_table_id` (add to the save serializer) and `table_id` on the analysis.
  - `src/state.ts`: `buildSpec`/save serializer emits `table_id: p.tableId` and join steps as `{ kind:"join", on, how, right_table_id: s.rightTableId }` (no inline `right`). `saveTablesFor` computes the referenced set.
  - `src/App.tsx` `doSave`/`doSaveAs`: build `tables` via `saveTablesFor`, each `{ name: t.id, table_id: t.handle.id, hierarchy: t.hierarchy }`; call the new `engine.saveDocument`. Remove the Plan-A single-main-table notice.

- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(app): save the full table pool by reference (2.1 format)`).

---

## Task 6: Frontend — load rebuilds the full pool

**Files:** Modify `src/state.ts`, `src/state.test.ts`, `src/App.tsx`.

- [ ] **Step 1 — failing test.** `loadDocumentAtom` given a `LoadedDocument` with two `tables` builds a two-entry pool, binds each analysis's `tableId`, and leaves join `rightTableId`s as the referenced names (no inline migration needed for 2.1):

```ts
it("loadDocument (2.1) rebuilds the pool and keeps references", () => {
  // doc.tables = [cells, annot]; analysis table_id=cells, join right_table_id=annot
  // → pool length 2; plottable.tableId=cells; join.rightTableId=annot
});
```

- [ ] **Step 2 — run, verify fail.**
- [ ] **Step 3 — implement.** Rewrite `loadDocumentAtom` to consume `doc.tables[]`: for each, push a `WorkspaceTable` (`{ id: name, name, schema, hierarchy, handle: { id, n, version, schema, counts } }`); set `activeTableIdAtom` to the first. Map analyses via `plottableFromSpec` (now reading `table_id` + join `right_table_id`). **Keep** the Plan A legacy path: if an analysis still carries an inline `join.right` (a 2.0 file the engine migrated to a single pool table), run the Plan A inline→pool migration for those joins. `App.tsx` `doLoad`/`doLoadExample` pass the new `LoadedDocument` shape through.
- [ ] **Step 4 — run, verify pass.**
- [ ] **Step 5 — commit** (`feat(state): loadDocument rebuilds the full pool from the 2.1 tables section`).

---

## Task 7: E2E — multi-main-table workspace round-trips, de-duplicated

**Files:** Modify the Playwright e2e suite.

- [ ] **Step 1 — write the e2e:** import two CSVs; build analysis 1 rooted in table A and analysis 2 rooted in table B (distinct main tables — the case Plan A could not save); add a join in analysis 1 referencing table B. Save `.iris`; reopen the saved file's bytes and assert (via a small check or by reload) that table B is stored **once**; reload into the app and confirm both analyses render with their correct main tables and the join survives as a reference.
- [ ] **Step 2 — run, verify pass.**
- [ ] **Step 3 — commit** (`test(e2e): multi-main-table .iris round-trips, de-duplicated`).

---

## Done criteria (Plan B)
- A workspace with analyses rooted in **different** main tables saves and reloads intact (Plan A's limitation lifted).
- A `.iris` stores each referenced table **once**, by name; analyses reference by name; the file is self-contained.
- Today's **2.0 single-table** `.iris` still loads (migrated into the pool).
- `cd engine && python -m pytest -q` green; `npm test -- --run`, `npx tsc --noEmit`, `npm run build` green.

## Out of scope
- Table rename/remove/reorder; per-analysis main-table picker UI; the workbench drag-to-join gesture (separate slices).

## Known follow-ups (surfaced by the final review, non-blocking)
- **>8-table workspaces are unsafe (engine LRU cap).** `SessionStore` holds ≤8 sessions; pool tables are referenced by session id only, so a >8-table save `409`s and `/document/load` evicts the earliest sessions before returning them. Not reachable in normal use today. Fix = raise/remove the cap or rehydrate evicted sessions from the persisted rows. See design §8.
- **`validation/test_export_gallery.py` dirties committed assets.** It regenerates `src/examples/assets/*.iris` into the committed dir as a pytest side effect — now flipping them to 2.1, which (if accidentally committed) would silently retire the runtime back-compat exercise (examples are intentionally kept at 2.0). Redirect the gallery export to a tmp dir under test.
- **`buildAllSpecs` family fallback uses the active table's schema** for a non-active plottable rooted in a *different* table with no cached preview (`state.ts`), so the saved spec's derived `family`/`test` can be wrong. Cosmetic only — the engine re-derives on open and `specAtom` re-derives when the plottable becomes active. Resolve each plottable's fallback schema from its own pool table.
