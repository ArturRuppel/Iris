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
