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
