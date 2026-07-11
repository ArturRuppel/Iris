"""Reduce DAG: a node set evaluated topologically, converging to one `output`
node whose frame feeds collapse -> plot/stats. A `source` node carries its rows
inline ({schema, rows}); a `step` node names the node id(s) it consumes in
`inputs` (one for the unary steps, two for join: [left, right]).

The linear pipeline is the degenerate DAG (one source, a straight input chain);
`linear_to_dag` builds it so the evaluator can be proven equal to the old fold."""
from __future__ import annotations


def linear_to_dag(table: dict, steps: list[dict] | None) -> dict:
    """A straight chain: source `src` -> `s0` -> `s1` -> ... . `output` is the
    last step, or the source when there are no steps."""
    nodes: list[dict] = [{"id": "src", "kind": "source", "table": table}]
    prev = "src"
    for i, step in enumerate(steps or []):
        nid = f"s{i}"
        nodes.append({"id": nid, "kind": "step", "step": step, "inputs": [prev]})
        prev = nid
    return {"nodes": nodes, "output": prev}
