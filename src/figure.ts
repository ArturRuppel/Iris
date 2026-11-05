/* Multi-panel figures: the document-level assembly that draws several analyses
   as the panels of one figure. Mirrors engine/iris_engine/assembly.py — the
   engine normalizes again on every save and render, so this copy only has to
   keep the UI's view consistent with what the engine will draw.

   An analysis joins the figure by carrying a tag ("A", "B", …), which is also
   its panel letter. `panels` fixes the order (analysis ids); tagged analyses it
   does not list follow in document order. */

export type FigureDirection = "rows" | "columns";
export interface FigureLetters {
  show: boolean;
  size_pt: number;
  weight: "bold" | "normal";
  position: "outside" | "inside";
}
export interface FigureAssembly {
  version: 1;
  panels: string[];
  /* "rows": panels stacked top to bottom; "columns": side by side */
  direction: FigureDirection;
  /* null: each panel at its own size; otherwise a relative weight per analysis id (missing = 1) */
  sizes: Record<string, number> | null;
  gap_mm: number;
  letters: FigureLetters;
  /* rows only: one x range, x tick labels and x label on the bottom panel only */
  share_x: boolean;
  /* null: from the panels' own sizes */
  width_mm: number | null;
  height_mm: number | null;
}

export const LETTER_DEFAULTS: FigureLetters = { show: true, size_pt: 10, weight: "bold", position: "outside" };
export const FIGURE_DEFAULTS: FigureAssembly = {
  version: 1, panels: [], direction: "rows", sizes: null, gap_mm: 3,
  letters: LETTER_DEFAULTS, share_x: false, width_mm: null, height_mm: null,
};

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/* every field present and in range, unknown keys dropped (assembly.normalize) */
export function normalizeFigure(raw: unknown): FigureAssembly | null {
  if (raw == null || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const l = (f.letters ?? {}) as Record<string, unknown>;
  const panels = Array.isArray(f.panels)
    ? [...new Set(f.panels.filter((p): p is string => typeof p === "string" && p !== ""))] : [];
  let sizes: Record<string, number> | null = null;
  if (f.sizes && typeof f.sizes === "object") {
    sizes = {};
    for (const [k, v] of Object.entries(f.sizes as Record<string, unknown>)) {
      const w = num(v, 0.05, 100);
      if (w != null) sizes[k] = w;
    }
  }
  return {
    version: 1,
    panels,
    direction: f.direction === "columns" ? "columns" : "rows",
    sizes,
    gap_mm: num(f.gap_mm, 0, 100) ?? FIGURE_DEFAULTS.gap_mm,
    letters: {
      show: typeof l.show === "boolean" ? l.show : LETTER_DEFAULTS.show,
      size_pt: num(l.size_pt, 4, 48) ?? LETTER_DEFAULTS.size_pt,
      weight: l.weight === "normal" ? "normal" : "bold",
      position: l.position === "inside" ? "inside" : "outside",
    },
    share_x: typeof f.share_x === "boolean" ? f.share_x : false,
    width_mm: num(f.width_mm, 10, 2000),
    height_mm: num(f.height_mm, 10, 2000),
  };
}

export const tagOf = (x: { tag?: string }): string => (x.tag ?? "").trim();

/* the panels in figure order (assembly.panel_order) */
export function panelOrder<T extends { id: string; tag?: string }>(
  figure: FigureAssembly | null, items: T[]): T[] {
  const tagged = items.filter((x) => tagOf(x));
  const rank = new Map((figure?.panels ?? []).map((id, i) => [id, i]));
  const first = tagged.filter((x) => rank.has(x.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...first, ...tagged.filter((x) => !rank.has(x.id))];
}

/* move one panel up/down in the figure order; writes the full order into `panels` */
export function movePanel<T extends { id: string; tag?: string }>(
  figure: FigureAssembly, items: T[], id: string, dir: -1 | 1): FigureAssembly {
  const ids = panelOrder(figure, items).map((x) => x.id);
  const i = ids.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return figure;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return { ...figure, panels: ids };
}

/* the next free letter for a new panel: A, B, … Z, then A2, B2, … */
export function nextTag(used: string[]): string {
  const taken = new Set(used.map((t) => t.trim()));
  for (let round = 1; ; round++)
    for (let c = 65; c <= 90; c++) {
      const t = String.fromCharCode(c) + (round > 1 ? round : "");
      if (!taken.has(t)) return t;
    }
}

/* What Save to lab book writes as the figure's SVG: the assembled figure when
   the document has an assembly with at least one panel, the one plot when it
   holds exactly one analysis, else a reason it cannot be saved. */
export type LabbookSvgSource = { kind: "assembly" } | { kind: "single" } | { kind: "error"; message: string };
export function labbookSvgSource(nAnalyses: number, figure: FigureAssembly | null, nPanels: number): LabbookSvgSource {
  if (figure && nPanels > 0) return { kind: "assembly" };
  if (nAnalyses === 1) return { kind: "single" };
  if (figure) return { kind: "error", message: "the figure has no panels: give the analyses that belong in it a tag" };
  return { kind: "error", message: `this file holds ${nAnalyses} plots and no figure: tag the panels in the Figure view to save them as one figure` };
}
