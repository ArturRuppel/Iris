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


def evaluate_dag(dag: dict) -> tuple:
    """Topologically evaluate `dag['nodes']`, returning the `output` node's
    (frame, schema). Source nodes load their inline {schema, rows}; unary step
    nodes fold one input through `_apply_step`; a join step merges its two inputs
    via `_join_frames`. Each node is evaluated once and cached by id."""
    from .main import _load_frame
    from .reduce import _apply_step, _join_frames

    by_id = {n["id"]: n for n in dag["nodes"]}
    output = dag.get("output")
    if output not in by_id:
        raise DagError(f"reduce DAG output {output!r} is not a node")
    cache: dict[str, tuple] = {}
    for nid in topo_order(dag["nodes"]):
        node = by_id[nid]
        if node.get("kind") == "source":
            cache[nid] = _load_frame(node["table"])
            continue
        step = node.get("step") or {}
        inputs = node.get("inputs") or []
        if step.get("kind") == "join":
            if len(inputs) != 2:
                raise DagError(f"join node {nid!r} needs exactly 2 inputs")
            left_df, left_schema = cache[inputs[0]]
            right_df, right_schema = cache[inputs[1]]
            out, schema = _join_frames(left_df, left_schema, right_df, right_schema,
                                       step.get("on") or [], step.get("how", "inner"))
        else:
            if len(inputs) != 1:
                raise DagError(f"step node {nid!r} needs exactly 1 input")
            in_df, in_schema = cache[inputs[0]]
            out, schema, _info = _apply_step(in_df, in_schema, step)
            out = out.reset_index(drop=True)
            if "id" not in out.columns:
                out = out.assign(id=[str(i + 1) for i in range(len(out))])
        cache[nid] = (out, schema)
    return cache[output]
