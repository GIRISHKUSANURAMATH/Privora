"""HTTP API integration tests, including the experiment runner, reports and security controls."""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

FAST_MODEL = {"hidden": [16], "epochs": 2, "batch_size": 64, "lr": 0.003, "seed": 1}


def _synthetic(client: TestClient, n: int = 800) -> dict[str, Any]:
    r = client.post("/api/datasets/synthetic", json={"key": "patients", "n": n, "seed": 2})
    assert r.status_code == 201, r.text
    return r.json()


def _wait(client: TestClient, exp_id: str, timeout: float = 240) -> dict[str, Any]:
    t0 = time.time()
    while time.time() - t0 < timeout:
        e = client.get(f"/api/experiments/{exp_id}").json()
        if e["status"] in ("completed", "failed", "cancelled"):
            return e
        time.sleep(0.25)
    raise AssertionError("experiment timed out")


def _run(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
    r = client.post("/api/experiments", json=body)
    assert r.status_code == 202, r.text
    e = _wait(client, r.json()["id"])
    assert e["status"] == "completed", e.get("error")
    return e


# ------------------------------------------------------------------ system + headers
def test_health_and_security_headers(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.json()["status"] == "ok"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    info = client.get("/api/system").json()
    assert info["device"] in ("cpu", "cuda") and info["opacus"]


# ------------------------------------------------------------------ datasets
def test_dataset_lifecycle(client: TestClient) -> None:
    ds = _synthetic(client)
    assert client.get("/api/datasets").json()[0]["id"] == ds["id"]
    detail = client.get(f"/api/datasets/{ds['id']}").json()
    assert detail["profile"]["rows"] == ds["rows"] and len(detail["preview"]) == 25
    rows = client.get(f"/api/datasets/{ds['id']}/rows?offset=10&limit=5").json()
    assert rows["offset"] == 10 and len(rows["rows"]) == 5
    pii = client.get(f"/api/datasets/{ds['id']}/pii").json()
    assert "email" in pii["summary"]["direct_identifiers"]
    exp = client.get(f"/api/datasets/{ds['id']}/export")
    assert exp.headers["content-type"].startswith("text/csv")
    assert "attachment" in exp.headers["content-disposition"]
    assert client.delete(f"/api/datasets/{ds['id']}").status_code == 204
    assert client.get(f"/api/datasets/{ds['id']}").status_code == 404


def test_upload_valid_csv(client: TestClient) -> None:
    csv = "x,y,label\n" + "\n".join(f"{i},{i % 7},{i % 2}" for i in range(50))
    r = client.post("/api/datasets/upload", files={"file": ("../../evil name.csv", csv, "text/csv")})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["original_filename"] == "evil name.csv"  # directory components stripped
    assert body["target_hint"] == "label"


@pytest.mark.parametrize(
    ("name", "content", "code"),
    [
        ("x.exe", b"a,b\n1,2", 422),
        ("x.csv", b"\x00\x01\x02", 422),
        ("x.csv", b"", 422),
    ],
)
def test_upload_rejections(client: TestClient, name: str, content: bytes, code: int) -> None:
    assert client.post("/api/datasets/upload", files={"file": (name, content)}).status_code == code


def test_upload_size_limit(client: TestClient) -> None:
    big = b"a,b\n" + b"1,2\n" * 700_000  # ~2.8 MB > 2 MB test limit
    assert client.post("/api/datasets/upload", files={"file": ("big.csv", big)}).status_code == 413


def test_path_traversal_ids_rejected(client: TestClient) -> None:
    for bad in ["..%2F..%2Fetc%2Fpasswd", "abc", "../ppml.sqlite3"]:
        assert client.get(f"/api/datasets/{bad}").status_code == 404


def test_transform_endpoint_and_save(client: TestClient) -> None:
    ds = _synthetic(client)
    r = client.post(
        f"/api/datasets/{ds['id']}/transform",
        json={
            "rules": [{"column": "email", "action": "mask"}, {"column": "full_name", "action": "suppress"}],
            "save": True,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "full_name" not in body["report"]["columns_after"]
    assert body["saved"]["parent_id"] == ds["id"]
    bad = client.post(
        f"/api/datasets/{ds['id']}/transform", json={"rules": [{"column": "nope", "action": "mask"}]}
    )
    assert bad.status_code == 422
    invalid_action = client.post(
        f"/api/datasets/{ds['id']}/transform", json={"rules": [{"column": "email", "action": "rm -rf"}]}
    )
    assert invalid_action.status_code == 422


# ------------------------------------------------------------------ privacy calculator
def test_calculator(client: TestClient) -> None:
    r = client.post(
        "/api/privacy/calculator",
        json={"n": 2000, "batch_size": 64, "epochs": 5, "delta": 1e-5, "target_epsilon": 2.0},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["epsilon"] <= 2.0 + 1e-6 and body["noise_multiplier"] > 0
    assert (
        client.post(
            "/api/privacy/calculator",
            json={"n": 10, "batch_size": 64, "epochs": 1, "delta": 1e-5, "noise_multiplier": 1},
        ).status_code
        == 422
    )


# ------------------------------------------------------------------ experiments end to end
def test_experiment_validation(client: TestClient) -> None:
    ds = _synthetic(client)
    assert client.post("/api/experiments", json={"type": "baseline"}).status_code == 422
    assert (
        client.post(
            "/api/experiments",
            json={"type": "baseline", "data": {"dataset_id": ds["id"], "target": "not_a_column"}},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/experiments",
            json={
                "type": "dp",
                "data": {"dataset_id": ds["id"], "target": "high_risk"},
                "dp": {"target_epsilon": 1, "noise_multiplier": 1},
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/experiments", json={"type": "baseline", "data": {"dataset_id": "f" * 32, "target": "x"}}
        ).status_code
        == 404
    )


def test_comparison_experiment_report_and_reload(client: TestClient) -> None:
    ds = _synthetic(client)
    e = _run(
        client,
        {
            "type": "comparison",
            "data": {"dataset_id": ds["id"], "target": "high_risk"},
            "model": FAST_MODEL,
            "dp": {"target_epsilon": 3.0, "delta": 1e-5},
        },
    )
    models = e["results"]["models"]
    assert [m["kind"] for m in models] == ["conventional", "dp"]
    assert models[1]["privacy"]["epsilon"] <= 3.05
    assert models[0]["privacy"] is None
    assert set(e["results"]["utility_cost"]) == {"accuracy", "precision", "recall", "f1", "roc_auc"}

    rep = client.post(f"/api/reports/{e['id']}")
    assert rep.status_code == 201
    md = rep.json()["markdown"]
    assert "Privacy accounting" in md and f"{models[1]['privacy']['epsilon']:.4f}" in md
    rid = rep.json()["id"]
    html = client.get(f"/api/reports/{rid}/download?format=html")
    assert html.status_code == 200 and "<table>" in html.text and "<script" not in html.text
    assert client.get(f"/api/reports/{rid}/download?format=json").json()["experiment"]["id"] == e["id"]

    mid = models[1]["model_id"]
    ev = client.post(f"/api/models/{mid}/evaluate", json={"dataset_id": ds["id"]})
    assert ev.status_code == 200 and ev.json()["reloaded_from_disk"] is True
    assert 0.4 < ev.json()["metrics"]["accuracy"] <= 1

    dash = client.get("/api/dashboard").json()
    assert dash["totals"]["models"] == 2 and dash["totals"]["dp_models"] == 1
    assert dash["privacy_budget"]["min_epsilon"] == pytest.approx(models[1]["privacy"]["epsilon"])


def test_budget_sweep(client: TestClient) -> None:
    ds = _synthetic(client)
    e = _run(
        client,
        {
            "type": "budget_sweep",
            "data": {"dataset_id": ds["id"], "target": "high_risk"},
            "model": FAST_MODEL,
            "sweep": {"epsilons": [0.5, 4.0]},
        },
    )
    curve = e["results"]["curve"]
    assert [c["target_epsilon"] for c in curve] == [0.5, 4.0]
    assert curve[0]["noise_multiplier"] > curve[1]["noise_multiplier"]
    assert all(c["epsilon"] <= c["target_epsilon"] + 0.05 for c in curve)


def test_federated_experiment(client: TestClient) -> None:
    ds = _synthetic(client)
    e = _run(
        client,
        {
            "type": "federated",
            "data": {"dataset_id": ds["id"], "target": "high_risk"},
            "model": FAST_MODEL,
            "federated": {
                "num_clients": 4,
                "rounds": 3,
                "client_fraction": 0.5,
                "privacy": "client_dp",
                "noise_multiplier": 1.0,
            },
        },
    )
    fed = e["results"]["federated"]
    assert len(fed["rounds"]) == 3 and fed["privacy"]["epsilon"] > 0
    assert e["results"]["models"][1]["kind"] == "federated"


def test_attack_experiment(client: TestClient) -> None:
    ds = _synthetic(client, n=1200)
    e = _run(
        client,
        {
            "type": "attack",
            "data": {"dataset_id": ds["id"], "target": "high_risk", "max_train_rows": 200},
            "model": {"hidden": [64], "epochs": 20, "batch_size": 32, "lr": 0.003},
            "attack": {"epsilons": [2.0], "shadow_models": 1, "max_eval": 300},
        },
    )
    ms = e["results"]["models"]
    assert [m["kind"] for m in ms] == ["conventional", "dp"]
    for m in ms:
        assert 0 <= m["attack"]["best_attack_auc"] <= 1
        assert "shadow_model" in m["attack"]["attacks"]
        assert m["leakage"]["leakage_level"] in ("low", "moderate", "high")
    assert e["results"]["setup"]["attribute"] is not None


def test_pii_experiment(client: TestClient) -> None:
    ds = _synthetic(client)
    e = _run(client, {"type": "pii", "pii": {"dataset_id": ds["id"]}, "model": FAST_MODEL})
    r = e["results"]
    assert r["scan_after"]["summary"]["risk_score"] < r["scan_before"]["summary"]["risk_score"]
    assert "utility" in r and r["derived_dataset_id"]
    assert client.get(f"/api/datasets/{r['derived_dataset_id']}").status_code == 200


def test_failed_experiment_is_recorded(client: TestClient) -> None:
    ds = _synthetic(client, n=300)
    r = client.post(
        "/api/experiments",
        json={
            "type": "dp",
            "data": {"dataset_id": ds["id"], "target": "high_risk"},
            "model": FAST_MODEL,
            "dp": {"target_epsilon": 1.0, "delta": 0.01},
        },
    )  # delta >= 1/n → rejected by DP engine
    e = _wait(client, r.json()["id"])
    assert e["status"] == "failed" and "delta" in e["error"]
    assert client.post(f"/api/reports/{e['id']}").status_code == 409


def test_cancel_and_delete(client: TestClient) -> None:
    ds = _synthetic(client)
    r = client.post(
        "/api/experiments",
        json={
            "type": "baseline",
            "data": {"dataset_id": ds["id"], "target": "high_risk"},
            "model": {**FAST_MODEL, "epochs": 300},
        },
    )
    eid = r.json()["id"]
    time.sleep(0.5)
    assert client.post(f"/api/experiments/{eid}/cancel").status_code == 200
    e = _wait(client, eid)
    assert e["status"] == "cancelled"
    assert client.delete(f"/api/experiments/{eid}").status_code == 204
    assert client.get(f"/api/experiments/{eid}").status_code == 404


# ------------------------------------------------------------------ release-audit regressions
def test_chunked_upload_over_limit_rejected(client: TestClient) -> None:
    """No Content-Length header (chunked transfer): still rejected with 413, not a 400 parse error."""

    def body():  # type: ignore[no-untyped-def]
        yield b'--B\r\nContent-Disposition: form-data; name="file"; filename="big.csv"\r\n\r\n'
        chunk = b"a,b\n" + b"1,2\n" * 65536  # ~256 KB
        for _ in range(40):  # ~10 MB; the test limit is 2 MB
            yield chunk
        yield b"\r\n--B--\r\n"

    r = client.post(
        "/api/datasets/upload", content=body(), headers={"Content-Type": "multipart/form-data; boundary=B"}
    )
    assert r.status_code == 413
    assert r.json()["detail"] == "Request body too large"


def test_body_limit_stops_reading_the_stream() -> None:
    """The guard must stop pulling chunks once the limit is passed (no spooling to disk)."""
    import asyncio

    from ppml.security import BodySizeLimitMiddleware

    pulled = 0
    sent: list[dict] = []

    async def receive():  # type: ignore[no-untyped-def]
        nonlocal pulled
        pulled += 1
        return {"type": "http.request", "body": b"x" * 1000, "more_body": True}

    async def send(message):  # type: ignore[no-untyped-def]
        sent.append(message)

    async def app(scope, rcv, snd):  # type: ignore[no-untyped-def]
        while (await rcv())["type"] == "http.request":  # a greedy body reader
            if pulled > 10_000:
                raise AssertionError("middleware never stopped the stream")
        await snd({"type": "http.response.start", "status": 400, "headers": []})
        await snd({"type": "http.response.body", "body": b"app response"})

    mw = BodySizeLimitMiddleware(app, max_bytes=5_000)
    asyncio.run(mw({"type": "http", "headers": []}, receive, send))
    assert pulled == 6  # 6 x 1000 bytes > 5000, then nothing more is read
    assert sent[0]["status"] == 413 and len(sent) == 2  # app's own 400 was suppressed


def test_declared_content_length_over_limit_rejected(client: TestClient) -> None:
    r = client.post(
        "/api/datasets/upload",
        content=b"x" * (3 * 1024 * 1024),
        headers={"Content-Type": "multipart/form-data; boundary=B"},
    )
    assert r.status_code == 413


def test_foreign_host_header_rejected(client: TestClient) -> None:
    """DNS-rebinding protection: only local host names are served."""
    assert client.get("/api/health", headers={"Host": "evil.example"}).status_code == 400
    assert client.get("/api/health", headers={"Host": "localhost:8000"}).status_code == 200


def test_csp_has_no_third_party_sources(client: TestClient) -> None:
    csp = client.get("/api/health").headers["content-security-policy"]
    assert "http" not in csp and "frame-ancestors 'none'" in csp


def test_json_report_never_contains_unmasked_sample_rows(client: TestClient) -> None:
    import re

    ds = _synthetic(client, n=400)
    e = _run(client, {"type": "pii", "pii": {"dataset_id": ds["id"], "measure_utility": False}})
    assert e["results"]["transform"]["sample_before"], "local record keeps the comparison rows"
    rid = client.post(f"/api/reports/{e['id']}").json()["id"]
    for fmt in ("json", "md", "html"):
        text = client.get(f"/api/reports/{rid}/download?format={fmt}").text
        assert not re.search(r"[a-z]+\.[a-z]+\d*@(?:mail\.)?example\.(?:com|org)", text), fmt
        assert not re.search(r"NID-\d{4}-\d{4}", text), fmt


def test_dashboard_does_not_mix_client_and_example_level_epsilon(client: TestClient) -> None:
    ds = _synthetic(client)
    data = {"dataset_id": ds["id"], "target": "high_risk"}
    dp = _run(client, {"type": "dp", "data": data, "model": FAST_MODEL, "dp": {"target_epsilon": 2.0}})
    fed = _run(
        client,
        {
            "type": "federated",
            "data": data,
            "model": FAST_MODEL,
            "federated": {"num_clients": 4, "rounds": 2, "privacy": "client_dp", "noise_multiplier": 0.6},
        },
    )
    assert dp["results"]["models"][0]["privacy"]["unit"] == "example"
    assert fed["results"]["federated"]["privacy"]["unit"] == "client"
    budget = client.get("/api/dashboard").json()["privacy_budget"]
    example_eps = dp["results"]["models"][0]["privacy"]["epsilon"]
    assert budget["min_epsilon"] == budget["max_epsilon"] == pytest.approx(example_eps)
    assert budget["client_level_models"] == 1
