import type { ColumnDef } from "./types";

/* The derive expression is stored with column NAMES (what the engine parses:
   `step_um / 0.25`) but shown and typed with column LABELS (what the table
   shows: `displacement since the previous frame (µm)` / 0.25). A label that is
   not a plain identifier is wrapped in backticks, which the engine accepts as a
   column reference by name or label. These two functions are the only place the
   translation happens; they are inverses on every expression that round-trips. */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/* the expression's functions — never mistaken for a column label */
const FUNCS = new Set(["log", "log2", "log10", "sqrt", "exp", "abs", "str", "quantile"]);
/* a backticked reference (possibly still being typed, no closing tick yet), a
   string literal, an identifier, or a run of anything else */
const TOKEN = /`[^`]*`?|"[^"]*"?|'[^']*'?|[A-Za-z_][A-Za-z0-9_]*|[^`"'A-Za-z_]+/g;

const plain = (s: string): boolean => IDENT.test(s) && !FUNCS.has(s);
const quoted = (s: string): string => plain(s) ? s : `\`${s}\``;

/* name → label, for the display */
export function exprToDisplay(expr: string, columns: ColumnDef[]): string {
  const byName = new Map(columns.map((c) => [c.name, c.label || c.name]));
  const names = new Set(columns.map((c) => c.name));
  const show = (name: string): string => {
    const label = byName.get(name)!;
    // a label that is another column's name would read back as that column
    return names.has(label) && label !== name ? `\`${label}\`` : quoted(label);
  };
  return (expr.match(TOKEN) ?? []).map((tok) => {
    if (tok[0] === '"' || tok[0] === "'") return tok;
    if (tok[0] === "`") {
      if (!tok.endsWith("`") || tok.length < 2) return tok;
      const ref = tok.slice(1, -1).trim();
      return byName.has(ref) ? show(ref) : tok;
    }
    return byName.has(tok) ? show(tok) : tok;
  }).join("");
}

/* label → name, for the stored step. A bare identifier that is a column name
   stays; one that is a column label becomes the name; anything else is left as
   typed (a function, a number's exponent, a column not in this table yet). */
export function exprToNames(display: string, columns: ColumnDef[]): string {
  const byName = new Set(columns.map((c) => c.name));
  const byLabel = new Map(columns.map((c) => [c.label || c.name, c.name]));
  return (display.match(TOKEN) ?? []).map((tok) => {
    if (tok[0] === '"' || tok[0] === "'") return tok;
    if (tok[0] === "`") {
      if (!tok.endsWith("`") || tok.length < 2) return tok;
      const ref = tok.slice(1, -1).trim();
      const name = byLabel.get(ref) ?? (byName.has(ref) ? ref : null);
      return name === null ? tok : quoted(name);
    }
    if (byName.has(tok)) return tok;
    const name = byLabel.get(tok);
    return name === undefined ? tok : quoted(name);
  }).join("");
}
