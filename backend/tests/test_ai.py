import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ai import AiRouter
from app.models import AiSettings


GEMINI = "gemini-3.1-flash-lite"
CLAUDE = "claude-haiku-4-5"
CODEX = "gpt-5.3-codex"


def test_unmeasured_speed_route_uses_a_configured_candidate_when_preferred_key_is_missing() -> None:
    router = AiRouter()
    router.set_available({CLAUDE})
    result = router.configure(AiSettings(strategy="speed", preferred_model=GEMINI))
    assert result.selected_model == CLAUDE
    assert result.connected is True and result.reason == "unmeasured"
    assert all(model.measured_latency_ms is None for model in result.models)


def settings(strategy: str, preferred: str = CLAUDE, candidates: list[str] | None = None) -> dict[str, object]:
    return {"strategy": strategy, "preferred_model": preferred, "candidates": candidates or [GEMINI, CLAUDE, CODEX]}


def source(client: TestClient, name: str, revision: int = 1, final: bool = True) -> dict[str, object]:
    response = client.post("/api/source/events", json={
        "utterance_id": name, "revision": revision, "text": "えー、原文です。",
        "source_event_id": f"{name}-{revision}", "is_final": final,
    })
    assert response.status_code == 200
    return response.json()


def complete(client: TestClient, caption: dict[str, object], elapsed: float, text: str = "原文です。") -> dict[str, object]:
    planned = caption["ai_request"]
    assert isinstance(planned, dict)
    response = client.put(f"/api/captions/{caption['id']}/formatted", json={
        "source_revision": caption["source_revision"], "text": text,
        "ai": {"request_id": planned["id"], "model_id": planned["model_id"], "elapsed_ms": elapsed},
    })
    assert response.status_code == 200
    return response.json()


def test_routes_new_final_inputs_and_preserves_the_original_plan_after_settings_change() -> None:
    with TestClient(create_app(environment={})) as client:
        assert client.get("/api/ai").json()["connected"] is False
        assert source(client, "off")["ai_request"] is None
        client.put("/api/ai", json=settings("manual"))
        assert source(client, "partial", final=False)["ai_request"] is None
        first = source(client, "one")
        assert first["ai_request"]["model_id"] == CLAUDE
        client.put("/api/ai", json=settings("manual", CODEX))
        assert source(client, "two")["ai_request"]["model_id"] == CODEX
        assert complete(client, first, 300.0)["text"] == "原文です。"
        assert source(client, "one", 2)["ai_request"]["model_id"] == CODEX
        assert complete(client, first, 1.0) == {"status": "stale"}
        public = client.get("/api/view").json()
        assert "ai_request" not in str(public) and "ai_result" not in str(public)


def test_cost_route_uses_only_selected_candidates() -> None:
    with TestClient(create_app(environment={})) as client:
        result = client.put("/api/ai", json=settings("cost", CODEX)).json()
        assert result["selected_model"] == GEMINI
        result = client.put("/api/ai", json=settings("cost", CODEX, [CLAUDE, CODEX])).json()
        assert result["selected_model"] == CLAUDE
        assert source(client, "one")["ai_request"]["model_id"] == CLAUDE


def test_speed_uses_measurements_without_fabricating_latency_or_counting_replays() -> None:
    with TestClient(create_app(environment={})) as client:
        result = client.put("/api/ai", json=settings("speed", CODEX)).json()
        assert result["selected_model"] == CODEX and result["reason"] == "unmeasured"
        assert all(model["measured_latency_ms"] is None for model in result["models"])
        first = source(client, "codex")
        complete(client, first, 700.0)
        assert complete(client, first, 1.0) == {"status": "duplicate"}
        client.put("/api/ai", json=settings("manual", GEMINI))
        gemini = source(client, "gemini")
        complete(client, gemini, 200.0)
        result = client.put("/api/ai", json=settings("speed", CODEX)).json()
        assert result["selected_model"] == GEMINI and result["reason"] == "speed"
        codex = next(model for model in result["models"] if model["id"] == CODEX)
        assert codex["measured_latency_ms"] == 700.0 and codex["latency_samples"] == 1


def test_routed_results_reject_wrong_models_and_preserve_human_edits() -> None:
    with TestClient(create_app(environment={})) as client:
        client.put("/api/ai", json=settings("manual"))
        first = source(client, "one")
        wrong = client.put("/api/captions/one/formatted", json={
            "source_revision": 1, "text": "誤ったAIの結果",
            "ai": {"request_id": first["ai_request"]["id"], "model_id": CODEX, "elapsed_ms": 1.0},
        })
        assert wrong.json() == {"status": "stale"}
        client.patch("/api/captions/one", json={"text": "人の修正", "base_revision": first["revision"]})
        result = complete(client, first, 250.0)
        assert result["text"] == "人の修正" and result["formatted_text"] == "原文です。"
        assert result["ai_result"]["model_id"] == CLAUDE


@pytest.mark.parametrize("payload", [
    settings("manual", "unknown"),
    settings("manual", GEMINI, [CLAUDE]),
    settings("speed", GEMINI, [GEMINI, GEMINI]),
    {"strategy": "cost", "preferred_model": GEMINI, "candidates": []},
])
def test_invalid_routing_settings_do_not_replace_saved_settings(payload: dict[str, object]) -> None:
    with TestClient(create_app(environment={})) as client:
        before = client.get("/api/ai").json()
        assert client.put("/api/ai", json=payload).status_code == 422
        assert client.get("/api/ai").json() == before
