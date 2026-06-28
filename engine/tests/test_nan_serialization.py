"""A zero-variance group makes scipy/pingouin emit NaN effect sizes and CIs.
FastAPI's strict json.dumps rejects NaN, which used to 500 the whole /analyze
call. The boundary sanitizer in main._json_safe must turn those into null so the
response serializes."""
import math

from fastapi.testclient import TestClient

from iris_engine import document, main
from test_engine import make_spec

client = TestClient(main.app)


def _degenerate_table():
    # Every response identical -> zero within- and between-group variance, so
    # Cohen's d divides by a zero pooled SD (NaN) and shapiro warns range-zero.
    rows = []
    for i in range(1, 21):
        grp = "control" if i <= 10 else "drug_a"
        rows.append({"id": f"r{i}", "subject": f"S{i:02d}", "treatment": grp,
                     "dose": 1.0, "response": 5.0})
    return {"schema": document.SAMPLE_SCHEMA, "rows": rows}


def test_analyze_survives_nan_stats():
    # Force welch_t (the auto-recommendation would dodge to mann_whitney here);
    # welch on a zero-variance group is what produced the NaN t/p/effect/CI that
    # crashed json.dumps in the wild.
    spec = make_spec(override="welch_t")
    r = client.post("/analyze",
                    json={"table": _degenerate_table(), "spec": spec})
    assert r.status_code == 200          # no NaN -> json.dumps crash
    # And any non-finite numeric is null, not NaN, in the parsed payload.
    def assert_finite(o):
        if isinstance(o, float):
            assert math.isfinite(o)
        elif isinstance(o, dict):
            for v in o.values():
                assert_finite(v)
        elif isinstance(o, list):
            for v in o:
                assert_finite(v)
    assert_finite(r.json()["stats"])


def test_json_safe_replaces_non_finite():
    out = main._json_safe({"a": float("nan"), "b": [1.0, float("inf"),
                                                    float("-inf")], "c": "ok"})
    assert out == {"a": None, "b": [1.0, None, None], "c": "ok"}
