import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Caption, CaptionPatch, Command, DisplaySettings, SourceEvent
from app.relay import CaptionNotFound, CaptionRelay, InvalidCaptionOperation
from app.workflow import CaptionWorkflow


def test_save_replay_keeps_original_result_and_history_private() -> None:
    relay = CaptionRelay()
    with TestClient(create_app(relay, environment={})) as client:
        client.post("/api/source/events", json={"utterance_id": "one", "source_event_id": "one", "revision": 1, "text": "原文"})
        patch = {"text": "手修正", "base_revision": 1, "request_id": "save-one"}
        saved = client.patch("/api/captions/one", json=patch)
        assert saved.status_code == 200
        assert [edit["text"] for edit in saved.json()["edit_history"]] == ["原文", "手修正"]
        next_save = client.patch("/api/captions/one", json={"text": "二度目", "base_revision": saved.json()["revision"]})
        replay = client.patch("/api/captions/one", json=patch)
        assert replay.json() == saved.json()
        assert relay.caption("one").revision == next_save.json()["revision"]
        assert relay.caption("one").text == "二度目"
        mismatch = client.patch("/api/captions/one", json={**patch, "text": "番号の使い回し"})
        assert mismatch.status_code == 409
        assert "保存番号" in mismatch.json()["detail"]
        assert set(relay.public_snapshot().captions[0].model_dump()) == {"id", "revision", "text", "speaker"}


def test_republication_is_explicit_and_moves_only_selected_caption_to_latest() -> None:
    relay = CaptionRelay()
    first = relay.source_event(SourceEvent(utterance_id="one", source_event_id="one", revision=1, text="最初"))
    assert isinstance(first, Caption)
    relay.command(Command(command="hide"))
    relay.source_event(SourceEvent(utterance_id="hidden", source_event_id="hidden", revision=1, text="非公開"))
    relay.command(Command(command="show"))
    for index in range(4):
        relay.source_event(SourceEvent(utterance_id=f"new-{index}", source_event_id=f"new-{index}", revision=1, text=f"新着{index}"))
    relay.display_settings(DisplaySettings(display_mode="recent", history_count=1))
    ordinary = relay.patch_caption("one", CaptionPatch(text="訂正", base_revision=first.revision))
    assert relay.public_snapshot().captions[0].id == "new-3"
    relay.patch_caption("one", CaptionPatch(text=ordinary.text, base_revision=ordinary.revision, republish=True))
    assert [(item.id, item.text) for item in relay.public_snapshot().captions] == [("one", "訂正")]
    assert not relay.caption("hidden").publish_eligible
    relay.source_event(SourceEvent(utterance_id="next", source_event_id="next", revision=1, text="次"))
    assert relay.public_snapshot().captions[0].id == "next"


@pytest.mark.parametrize("mode,visible,final", [("host", False, True), ("client", True, True), ("host", True, False)])
def test_republication_cannot_resume_hidden_output_or_publish_interim_text(mode: str, visible: bool, final: bool) -> None:
    relay = CaptionRelay()
    relay.connection_mode(mode)
    relay.command(Command(command="show" if visible else "hide"))
    result = relay.source_event(SourceEvent(utterance_id="one", source_event_id="one", revision=1, text="原文", is_final=final))
    assert isinstance(result, Caption)
    with pytest.raises(InvalidCaptionOperation):
        relay.patch_caption("one", CaptionPatch(text="再公開", base_revision=result.revision, republish=True))
    assert relay.caption("one").text == "原文"


def test_reset_drops_saved_request_results() -> None:
    async def verify() -> None:
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {})
        result = workflow.source_event(SourceEvent(utterance_id="one", source_event_id="one", revision=1, text="原文"))
        assert isinstance(result, Caption)
        patch = CaptionPatch(text="訂正", base_revision=result.revision, request_id="old-save")
        await workflow.patch_caption("one", patch)
        await workflow.reset_captions()
        with pytest.raises(CaptionNotFound):
            await workflow.patch_caption("one", patch)
    asyncio.run(verify())
