from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as client:
        yield client


def source(client: TestClient, **changes: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "utterance_id": "one", "revision": 1, "text": "原文",
        "is_final": True, "source_event_id": "event-one",
    }
    payload.update(changes)
    response = client.post("/api/source/events", json=payload)
    assert response.status_code == 200
    return response.json()


def test_edit_conflict_and_human_priority(client: TestClient) -> None:
    original = source(client)
    response = client.patch("/api/captions/one", json={"text": "修正", "base_revision": original["revision"]})
    assert response.status_code == 200
    corrected = response.json()
    conflict = client.patch("/api/captions/one", json={"text": "古い修正", "base_revision": original["revision"]})
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["latest"]["text"] == "修正"
    updated = source(client, text="上流の変更", revision=2, source_event_id="event-two")
    assert updated["text"] == "修正"
    assert updated["revision"] == corrected["revision"]


def test_duplicate_and_stale_inputs(client: TestClient) -> None:
    source(client)
    assert source(client)["status"] == "duplicate"
    assert source(client, source_event_id="older")["status"] == "stale"
    assert client.get("/api/session").json()["count"] == 1


def test_public_response_uses_only_public_fields(client: TestClient) -> None:
    original = source(client)
    client.patch("/api/captions/one", json={"text": "公開文", "base_revision": original["revision"]})
    public = client.get("/api/view").json()
    assert public["visible"] is True
    assert public["captions"][0]["text"] == "公開文"
    assert set(public["captions"][0]) == {"id", "revision", "text"}
    assert "原文" not in client.get("/api/view").text


def test_hidden_input_does_not_publish_on_resume(client: TestClient) -> None:
    source(client)
    assert client.post("/api/commands", json={"command": "hide"}).json() == {"visible": False}
    source(client, utterance_id="hidden", source_event_id="hidden")
    client.post("/api/commands", json={"command": "show"})
    source(client, utterance_id="hidden", source_event_id="hidden-final", revision=2)
    assert client.get("/api/view").json()["captions"] == []
    source(client, utterance_id="new", source_event_id="new")
    assert [caption["id"] for caption in client.get("/api/view").json()["captions"]] == ["new"]


@pytest.mark.parametrize("changes", [
    {"revision": "1"}, {"revision": True}, {"revision": 0},
    {"is_final": "false"}, {"utterance_id": ""}, {"published": True},
])
def test_input_rejects_invalid_types_and_unexpected_fields(client: TestClient, changes: dict[str, object]) -> None:
    payload: dict[str, object] = {"utterance_id": "one", "revision": 1, "text": "原文", "source_event_id": "event"}
    payload.update(changes)
    assert client.post("/api/source/events", json=payload).status_code == 422
    assert client.get("/api/session").json()["count"] == 0


def test_patch_and_command_validation(client: TestClient) -> None:
    original = source(client)
    assert client.patch("/api/captions/one", json={"text": "　 ", "base_revision": original["revision"]}).status_code == 422
    assert client.post("/api/commands", json={"command": "invalid"}).status_code == 422
    assert client.patch("/api/captions/missing", json={"text": "修正", "base_revision": 1}).status_code == 404


def test_apps_have_independent_sessions(client: TestClient) -> None:
    source(client)
    with TestClient(create_app()) as other:
        assert other.get("/api/session").json()["count"] == 0


def test_frontend_build_is_served(client: TestClient) -> None:
    for path in ["/", "/view/demo"]:
        response = client.get(path)
        assert response.status_code == 200
        assert 'id="root"' in response.text
        assert "/static/assets/" in response.text


def test_openapi_declares_response_models(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    public_schema = schema["paths"]["/api/view"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
    assert public_schema == {"$ref": "#/components/schemas/PublicSnapshot"}
    assert schema["components"]["schemas"]["Command"]["properties"]["command"]["enum"] == ["show", "hide"]
