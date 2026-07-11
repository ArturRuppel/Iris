import type { ExplorerNode } from "../explorer/graph";

/* A node names the TABLE it holds (a thing you view); the step that produced it
   is named on its incoming edge (a thing you edit). So the box reads as data, the
   wire above it as a verb. The source table's name is the base; every derived
   table appends what it became ("table_1 · filtered", "table_1 · per species"),
   from the node's own label, so each reduced table reads as its own thing. A
   join's right input carries its own referenced-table label. */
export function nodeTableName(node: ExplorerNode, sourceName: string): string {
  switch (node.phase) {
    case "terminal": return "Figure";
    case "source": return sourceName;
    case "join-input": return node.label;
    default: return `${sourceName} · ${node.label}`;   // reduce / grain / post
  }
}
