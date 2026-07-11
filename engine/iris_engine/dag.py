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


class DagError(ValueError):
    """The reduce DAG is malformed (cycle, missing input, missing output)."""


def topo_order(nodes: list[dict]) -> list[str]:
    """Kahn topological sort over `inputs` edges. Raises DagError on a cycle or a
    reference to an undeclared node id."""
    ids = {n["id"] for n in nodes}
    deps = {n["id"]: [i for i in (n.get("inputs") or [])] for n in nodes}
    for nid, ins in deps.items():
        missing = [i for i in ins if i not in ids]
        if missing:
            raise DagError(f"node {nid!r} names unknown input(s) {missing!r}")
    indeg = {nid: 0 for nid in ids}
    children: dict[str, list[str]] = {nid: [] for nid in ids}
    for nid, ins in deps.items():
        for i in ins:
            indeg[nid] += 1
            children[i].append(nid)
    queue = sorted(nid for nid, d in indeg.items() if d == 0)
    order: list[str] = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for c in sorted(children[nid]):
            indeg[c] -= 1
            if indeg[c] == 0:
                queue.append(c)
    if len(order) != len(ids):
        raise DagError("reduce DAG contains a cycle")
    return order
