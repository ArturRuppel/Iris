import type { ColumnDef, Layer, RuleLabelWhere, RuleLineStyle, RuleParams } from "../types";
import { RULE_DEFAULTS } from "../types";
import { NumberField, Row, Seg } from "./inspector/KnobControls";

const LABEL_WHERE: RuleLabelWhere[] = ["first", "all", "none"];
const LINESTYLES: RuleLineStyle[] = ["dashed", "solid", "dotted"];

/* the columns a rule can sit at: numeric measures (an identifier is a key, not
   a position) */
export const ruleColumns = (columns: ColumnDef[]): ColumnDef[] =>
  columns.filter((c) => c.type === "numeric" && !c.identifier);

/* A `rule` layer's own rows: which numeric column the lines sit at, its label and
   where the label shows, and the line's look. These are the layer's `params`
   (per instance — two rules mark two columns), not shared geom style. */
export function RuleParamsRows(
  { layer, columns, onChange }:
  { layer: Layer; columns: ColumnDef[]; onChange: (l: Layer) => void },
) {
  const p: RuleParams = { ...RULE_DEFAULTS, ...(layer.params ?? {}) };
  const set = (patch: Partial<RuleParams>) =>
    onChange({ ...layer, params: { ...(layer.params ?? {}), ...patch } });
  const lid = layer.id ?? "layer";
  const numeric = ruleColumns(columns);
  const missing = !!p.column && !numeric.some((c) => c.name === p.column);
  return (
    <>
      <Row label="Column" labelFor={`${lid}-rule-col`} className="rule-column">
        <select id={`${lid}-rule-col`} className="insp-select" value={p.column ?? ""}
          title="The numeric column the lines sit at, on the plot's value axis: one line per row of this layer's data level, per colour group, per facet cell."
          onChange={(e) => set({ column: e.target.value || null })}>
          <option value="">— pick a column —</option>
          {missing && <option value={p.column!}>{p.column} (not in the data)</option>}
          {numeric.map((c) => (
            <option key={c.name} value={c.name}>{c.label && c.label !== c.name
              ? `${c.label} (${c.name})` : c.name}</option>
          ))}
        </select>
      </Row>
      <Row label="Label" labelFor={`${lid}-rule-label`} className="rule-label">
        <input id={`${lid}-rule-label`} type="text" className="insp-text" placeholder="none"
          value={p.label ?? ""} onChange={(e) => set({ label: e.target.value })} />
      </Row>
      <Row label="Label in" labelId={`${lid}-rule-where`} className="rule-label-where">
        <Seg options={LABEL_WHERE} value={p.label_where ?? "first"}
          labelledBy={`${lid}-rule-where`}
          onChange={(v) => set({ label_where: v as RuleLabelWhere })} />
      </Row>
      <Row label="Line" labelId={`${lid}-rule-ls`} className="rule-linestyle">
        <Seg options={LINESTYLES} value={p.linestyle ?? "dashed"}
          labelledBy={`${lid}-rule-ls`}
          onChange={(v) => set({ linestyle: v as RuleLineStyle })} />
      </Row>
      <Row label="Line width" labelFor={`${lid}-rule-lw`} className="rule-linewidth">
        <NumberField id={`${lid}-rule-lw`} value={p.linewidth} min={0.1} max={6} step={0.1}
          unit="pt" placeholder={String(RULE_DEFAULTS.linewidth)}
          onCommit={(n) => set({ linewidth: n ?? RULE_DEFAULTS.linewidth })} />
      </Row>
    </>
  );
}

/* A layer's data rows: which hierarchy level it draws from and which panel it
   draws into. Its style knobs follow these rows in the layer card (LayerStrip). */
export function LayerCard(
  { layer, levels, maxPanel = 0, faceted = false, columns = [], onChange }:
  { layer: Layer;
    levels: { value: string; label: string }[];
    maxPanel?: number; faceted?: boolean;
    /* the plot's columns, for a rule layer's column picker */
    columns?: ColumnDef[];
    onChange: (l: Layer) => void },
) {
  const setLevel = (level: string) => onChange({ ...layer, level });
  const setPanel = (panel: number) =>
    onChange({ ...layer, panel: panel === 0 ? undefined : panel });
  // only worth offering when the hierarchy has more than the raw level
  const showLevel = levels.length > 1;
  // panel authoring (spec 2.3 Stage 2): choose which side-by-side panel this layer
  // draws into — the existing panels plus one "New panel". Hidden under faceting,
  // where the engine ignores panels (faceting wins), so it's never offered as a
  // no-op. `maxPanel + 2` options = panels 0…maxPanel, then a fresh one.
  const showPanel = !faceted;
  const lid = layer.id ?? "layer";

  return (
    <>
      {showLevel && (
        <Row label="Data level" labelFor={`${lid}-level`} className="layer-level">
          <select id={`${lid}-level`} className="insp-select" value={layer.level ?? ""}
            title="Which level of the data hierarchy this layer draws — raw rows, or one mark per grain (e.g. one per cell, one per date)."
            onChange={(e) => setLevel(e.target.value)}>
            {levels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </Row>
      )}
      {showPanel && (
        <Row label="Panel" labelFor={`${lid}-panel`} className="layer-panel">
          <select id={`${lid}-panel`} className="insp-select" value={String(layer.panel ?? 0)}
            title="Which side-by-side figure panel this layer draws into. Move it to a new panel to show its data stage beside the primary plot instead of overlaid on it."
            onChange={(e) => setPanel(Number(e.target.value))}>
            {Array.from({ length: maxPanel + 2 }, (_, p) => (
              <option key={p} value={p}>
                {p === 0 ? "Primary" : p === maxPanel + 1 ? "New panel" : `Panel ${p + 1}`}
              </option>
            ))}
          </select>
        </Row>
      )}
      {layer.geom === "rule" && (
        <RuleParamsRows layer={layer} columns={columns} onChange={onChange} />
      )}
    </>
  );
}
