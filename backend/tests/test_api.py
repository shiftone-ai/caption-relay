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
    assert set(public["captions"][0]) == {"id", "revision", "text", "speaker"}
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


def test_ai_candidate_is_editable_and_human_revision_is_protected(client: TestClient) -> None:
    original = source(client, text="えー、本日はありがとうございます。", formatted_text="本日はありがとうございます。")
    assert original["original"] == "えー、本日はありがとうございます。"
    assert original["text"] == "本日はありがとうございます。"
    assert client.get("/api/view").json()["captions"][0]["text"] == original["text"]
    saved = client.patch("/api/captions/one", json={"text": "ご参加ありがとうございます。", "base_revision": original["revision"]}).json()
    updated = source(client, revision=2, source_event_id="ai-second", formatted_text="本日はご来場ありがとうございます。")
    assert updated["text"] == saved["text"]
    assert updated["formatted_text"] == "本日はご来場ありがとうございます。"
    assert client.get("/api/view").json()["captions"][0]["text"] == saved["text"]


def test_manual_publication_waits_for_save_and_preserves_previous_public_text(client: TestClient) -> None:
    original = source(client)
    client.put("/api/publication-mode", json={"auto_publish": False})
    updated = source(client, revision=2, source_event_id="update", formatted_text="新しい修正候補")
    assert updated["text"] == "新しい修正候補"
    assert client.get("/api/view").json()["captions"][0]["text"] == "原文"
    new = source(client, utterance_id="two", source_event_id="two")
    assert new["published"] is False
    assert len(client.get("/api/view").json()["captions"]) == 1
    client.patch("/api/captions/two", json={"text": "確認済み", "base_revision": new["revision"]})
    assert client.get("/api/view").json()["captions"][-1]["text"] == "確認済み"
    client.put("/api/publication-mode", json={"auto_publish": True})
    assert client.get("/api/events").json()[0]["public_revision"] == original["revision"]


def test_saving_interim_update_preserves_previous_public_caption(client: TestClient) -> None:
    published = source(client, text="公開済みの文")
    interim = source(client, revision=2, source_event_id="interim", is_final=False, text="途中の文")
    saved = client.patch("/api/captions/one", json={"text": "人が訂正した文", "base_revision": interim["revision"]})
    assert saved.status_code == 200
    assert saved.json()["text"] == "人が訂正した文"
    public = client.get("/api/view").json()["captions"]
    assert public == [{"id": "one", "revision": published["revision"], "text": "公開済みの文", "speaker": None}]

    source(client, revision=3, source_event_id="final", is_final=True, text="確定した原文")
    assert client.get("/api/view").json()["captions"][-1]["text"] == "人が訂正した文"


def test_display_settings_are_shared_without_exposing_operator_data(client: TestClient) -> None:
    source(client)
    response = client.put("/api/display", json={
        "background": "#ffffff", "foreground": "#171717", "font": "serif",
        "font_size": 48, "position": "bottom", "history_count": 3,
    })
    assert response.status_code == 200
    assert client.get("/api/session").json()["display"] == response.json()
    public = client.get("/api/view").json()
    assert public["display"] == response.json()
    assert "original" not in public["captions"][0]
    assert client.put("/api/display", json={"font_size": 8}).status_code == 422
    assert client.put("/api/display", json={"background": "url(evil)"}).status_code == 422


def test_manual_save_cannot_republish_hidden_period(client: TestClient) -> None:
    client.put("/api/publication-mode", json={"auto_publish": False})
    client.post("/api/commands", json={"command": "hide"})
    hidden = source(client)
    client.post("/api/commands", json={"command": "show"})
    client.patch("/api/captions/one", json={"text": "隠したままの修正", "base_revision": hidden["revision"]})
    assert client.get("/api/view").json()["captions"] == []


def test_late_ai_results_check_source_revision_and_preserve_human_edit(client: TestClient) -> None:
    original = source(client)
    result = client.put("/api/captions/one/formatted", json={"source_revision": 1, "text": "AI修正結果"})
    assert result.status_code == 200
    assert result.json()["original"] == "原文"
    assert client.get("/api/view").json()["captions"][0]["text"] == "AI修正結果"
    client.patch("/api/captions/one", json={"text": "人の修正", "base_revision": result.json()["revision"]})
    updated = client.put("/api/captions/one/formatted", json={"source_revision": 1, "text": "後着のAI候補"}).json()
    assert updated["text"] == "人の修正"
    assert updated["formatted_text"] == "後着のAI候補"
    assert client.get("/api/view").json()["captions"][0]["text"] == "人の修正"
    source(client, revision=2, source_event_id="new-source")
    stale = client.put("/api/captions/one/formatted", json={"source_revision": 1, "text": "古いAI結果"})
    assert stale.json() == {"status": "stale"}
    assert client.put("/api/captions/missing/formatted", json={"source_revision": 1, "text": "候補"}).status_code == 404
    assert client.put("/api/captions/one/formatted", json={"source_revision": 2, "text": "　 "}).status_code == 422
    assert original["original"] == "原文"


def test_public_api_returns_display_range_without_discarding_operator_history(client: TestClient) -> None:
    assert client.get("/api/view").json()["captions"] == []
    for number in range(12):
        source(client, utterance_id=str(number), source_event_id=f"event-{number}", text=f"字幕{number}")
    assert [caption["id"] for caption in client.get("/api/view").json()["captions"]] == [str(number) for number in range(12)]
    assert len(client.get("/api/events").json()) == 12
    for count, expected in [(3, ["9", "10", "11"]), (1, ["11"]), (10, [str(number) for number in range(2, 12)])]:
        response = client.put("/api/display", json={"display_mode": "recent", "history_count": count})
        assert response.status_code == 200
        snapshot = client.get("/api/view").json()
        assert snapshot["display"]["history_count"] == count
        assert [caption["id"] for caption in snapshot["captions"]] == expected
        assert all(set(caption) == {"id", "revision", "text", "speaker"} for caption in snapshot["captions"])
    assert len(client.get("/api/events").json()) == 12
