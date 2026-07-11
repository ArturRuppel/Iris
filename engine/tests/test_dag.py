from iris_engine.dag import linear_to_dag


def test_linear_to_dag_chains_inputs():
    table = {"schema": {"columns": [{"name": "x", "type": "numeric"}]},
             "rows": [{"x": 1}, {"x": 2}]}
    steps = [{"kind": "filter", "conditions": []},
             {"kind": "derive", "column": "y", "expr": "x + 1"}]
    dag = linear_to_dag(table, steps)
    assert [n["id"] for n in dag["nodes"]] == ["src", "s0", "s1"]
    assert dag["nodes"][0]["kind"] == "source"
    assert dag["nodes"][1]["inputs"] == ["src"]
    assert dag["nodes"][2]["inputs"] == ["s0"]
    assert dag["output"] == "s1"


def test_linear_to_dag_no_steps_outputs_source():
    table = {"schema": {"columns": []}, "rows": []}
    dag = linear_to_dag(table, [])
    assert dag["output"] == "src"
    assert [n["id"] for n in dag["nodes"]] == ["src"]


from iris_engine.dag import topo_order, DagError
import pytest


def test_topo_order_respects_inputs():
    nodes = [{"id": "src", "kind": "source", "table": {}},
             {"id": "a", "kind": "step", "inputs": ["src"]},
             {"id": "b", "kind": "step", "inputs": ["src"]},
             {"id": "j", "kind": "step", "inputs": ["a", "b"]}]
    order = topo_order(nodes)
    assert order.index("src") < order.index("a") < order.index("j")
    assert order.index("b") < order.index("j")


def test_topo_order_rejects_cycle():
    nodes = [{"id": "a", "kind": "step", "inputs": ["b"]},
             {"id": "b", "kind": "step", "inputs": ["a"]}]
    with pytest.raises(DagError):
        topo_order(nodes)


def test_topo_order_rejects_missing_input():
    nodes = [{"id": "a", "kind": "step", "inputs": ["ghost"]}]
    with pytest.raises(DagError):
        topo_order(nodes)


from iris_engine.dag import evaluate_dag
from iris_engine.reduce import apply_reduction
from iris_engine.main import _load_frame


def _table():
    return {"schema": {"columns": [{"name": "cell", "type": "categorical"},
                                   {"name": "v", "type": "numeric"}]},
            "rows": [{"cell": "a", "v": 1.0}, {"cell": "b", "v": 3.0}]}


def test_evaluate_dag_equals_fold_on_linear():
    table, steps = _table(), [{"kind": "derive", "column": "w", "expr": "v * 2"}]
    dag = linear_to_dag(table, steps)
    dag_df, _ = evaluate_dag(dag)
    df0, sch0 = _load_frame(table)
    fold_df, _ = apply_reduction(df0, sch0, steps)
    assert dag_df["w"].tolist() == fold_df["w"].tolist()


def test_evaluate_dag_diamond_joins_two_branches():
    # src fans out to two derives, which join back on `cell`.
    table = _table()
    nodes = [
        {"id": "src", "kind": "source", "table": table},
        {"id": "hi", "kind": "step", "inputs": ["src"],
         "step": {"kind": "derive", "column": "hi", "expr": "v + 10"}},
        {"id": "lo", "kind": "step", "inputs": ["src"],
         "step": {"kind": "derive", "column": "lo", "expr": "v - 10"}},
        {"id": "j", "kind": "step", "inputs": ["hi", "lo"],
         "step": {"kind": "join", "on": ["cell"], "how": "inner"}},
    ]
    dag = {"nodes": nodes, "output": "j"}
    out, schema = evaluate_dag(dag)
    assert {"hi", "lo"} <= set(out.columns)
    assert out.loc[out.cell == "a", "hi"].iloc[0] == 11.0
    assert out.loc[out.cell == "a", "lo"].iloc[0] == -9.0


from iris_engine.dag import evaluate_dag_traced


def test_evaluate_dag_traced_returns_every_node_frame():
    table = _table()
    dag = linear_to_dag(table, [{"kind": "filter",
        "conditions": [{"column": "v", "op": ">", "value": 2.0}]}])
    cache, order = evaluate_dag_traced(dag)
    assert set(cache) == {"src", "s0"}
    assert len(cache["src"][0]) == 2      # source: both rows
    assert len(cache["s0"][0]) == 1       # after filter v > 2: one row
    assert order[0] == "src"
