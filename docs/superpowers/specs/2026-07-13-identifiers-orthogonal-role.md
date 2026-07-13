# Identifiers as an orthogonal role (any column can be an identifier)

## Problem
Today `identifier` is one of the mutually-exclusive column *types*
(`numeric | categorical | identifier | bool`), and the Data-tab role toggle only
appears for non-numeric columns. So a numeric column (time, dose, position) can
be a nesting key only if the importer guesses it, and never by hand; and once a
column is an identifier it loses its value type, so it can't be plotted on an
axis. That's the bind: a time column wants to be *both* a spine key (honest raw
grain) *and* a numeric x-axis, and the type-union model makes those exclusive.

## Model change
Make **identifier a role orthogonal to the value type**:
- `ColumnDef.type` is strictly the value type: `numeric | categorical | bool`.
- `ColumnDef.identifier?: boolean` — the nesting-key role, independent of type.

A numeric identifier keeps value type `numeric`, so it still plots on x/y and
drives the stats family; the identifier *role* is what puts it on the spine and
forces discrete treatment on color/shape/facet (the superplot idiom).

### Channel rule (the one place the two axes meet)
`channelType(col, channel)`:
- identifier + color/shape/facet → `categorical` (discrete per-grain).
- identifier + x/y/size → value type if numeric, else **not offered**
  (a nominal key belongs on a grouping channel, not a measurement axis).
- non-identifier → value type everywhere.

`colTypeOf(col)` becomes the pure value type (never null). `colType(schema,name)`
= axis type = `channelType(col,"x")` (numeric-or-null for identifiers).

## Uniqueness assertion (the honesty part)
Invariant: **the identifier columns must jointly key the raw table** — the tuple
of all identifier columns is unique per row. When it holds, each row is one
distinguishable observation and n at every grain is honest. When it fails, two
rows share an identity with nothing to tell them apart: either a missing key
(mark the repeat axis — frame/time — as an identifier; now possible without
losing the axis) or genuine duplicate data.

Enforced in `SessionTable.set_schema` (the chokepoint every role change flows
through): compute `df.duplicated(subset=identifier_cols)`; if any, raise
`IdentifierError` (→ HTTP 422 with a message naming the identifiers, the collision
count, and an example colliding tuple). The frontend `setColumnRoleAtom` awaits
the push, and on failure surfaces the message inline in the HierarchyPanel and
does **not** commit the role change (the toggle reverts). Data is never touched.

Note: promotion (adding an identifier) can only *increase* uniqueness, so it
never trips the error; demotion and already-colliding imports are what it guards.

## Sites to migrate
TS: types.ts (union + flag), channels.ts (colTypeOf/colType/channelType,
offeredColumns, geomSatisfiableByColumns, ID_AS_CATEGORICAL role-keyed),
state.ts (identifierCols, setColumnRoleAtom → sets flag + validates),
HierarchyPanel (toggle every column; inline error), DataTable (editable/cellClass
by `identifier`), StepJoin (join keys by role), cardTestStore.

Py: specutil (add `is_identifier`), hierarchy.py (_level_table measures/carry,
identity_merge, join_leaf_key), main.py (join spine), importer._infer_type
(→ (type, identifier)), document._infer_schema + sample schema literal,
scales.py (color_numeric excludes identifiers), compiler.py (dodge/discrete color
by role), statmodel.py (color grouping by role), guards.py (color numeric),
session.py (set_schema validation + IdentifierError).
