import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import CaptionPatch, Command, PublicationMode
from app.relay import CaptionRelay
from app.udtalk import UdtalkDecoder, UdtalkProtocolError, WebMessage


def message(text="認識文", *, identifier="speech:00", phase="finalized", clock=1.0,
            end=True, kind=0):
    return WebMessage(meta=json.dumps({
        "utteranceIdentifier": identifier, "phase": phase, "text": text,
        "connected": {"timestamp": clock, "name": "private speaker"},
        "finalizedTimestamp": clock, "endOfUtterance": end, "type": kind,
        "originalText": "private original", "localeIdentifier": "ja-JP",
    }))


def test_fragments_are_grouped_not_treated_as_revisions():
    decoder = UdtalkDecoder("private-room")
    partial = decoder.decode([message("本日は", phase="updated", end=False)])[0]
    assert partial.is_final is False
    # A final suffix completes earlier finalized fragments, as in the viewer.
    events = decoder.decode([
        message("本日は", clock=2.0, end=False),
        message("ありがとうございます", identifier="speech:01", clock=3.0),
    ])
    assert len(events) == 1
    assert events[0].utterance_id == partial.utterance_id
    assert events[0].revision == 2
    assert events[0].text == "本日はありがとうございます"
    assert events[0].is_final is True
    assert "private" not in events[0].model_dump_json()


def test_replay_stale_and_same_text_new_utterance():
    decoder = UdtalkDecoder("room")
    latest = message(clock=2.0)
    first = decoder.decode([latest])[0]
    assert decoder.decode([latest, message("古い結果", clock=1.0)]) == []
    second = decoder.decode([message(identifier="second:00")])[0]
    assert first.text == second.text
    assert first.utterance_id != second.utterance_id
    assert first.utterance_id != UdtalkDecoder("other-room").decode([latest])[0].utterance_id


def test_same_text_completion_and_fragment_gap():
    decoder = UdtalkDecoder("room")
    first = decoder.decode([message(phase="updated", end=False)])[0]
    completed = decoder.decode([message(clock=2.0)])[0]
    assert completed.revision == first.revision + 1
    assert completed.is_final is True
    gap = decoder.decode([message(identifier="gap:01")])[0]
    assert gap.is_final is False


def test_silence_placeholder_and_removal_tombstone():
    decoder = UdtalkDecoder("room")
    assert decoder.decode([message("", phase="removed", identifier="", clock=0.0, kind=-1)]) == []
    assert decoder.decode([WebMessage(meta='{"utteranceIdentifier":"","text":"","type":-1}')]) == []
    assert decoder.decode([message("...", phase="created", kind=-1, end=None)]) == []
    assert decoder.decode([message("", phase="removed", kind=-1, clock=2.0)]) == []
    assert decoder.decode([message(clock=1.5)]) == []
    assert decoder.decode([message(identifier="real:00")])[0].is_final
    removed = decoder.decode([message("", identifier="real:00", phase="removed", clock=2.0)])[0]
    assert removed.removed and not removed.is_final
    assert decoder.decode([message(identifier="real:00")]) == []


def test_text_during_recognition_can_have_unknown_type():
    decoder = UdtalkDecoder("room")
    partial = decoder.decode([message("途中の入力", phase="updated", kind=-1, end=None)])[0]
    assert partial.text == "途中の入力" and partial.is_final is False


def test_invalid_batch_does_not_partly_advance_decoder():
    decoder = UdtalkDecoder("room")
    with pytest.raises(UdtalkProtocolError, match="format is invalid"):
        decoder.decode([message(), WebMessage(meta='{"text":"private secret"}')])
    assert decoder.decode([message()])[0].revision == 1


def test_adapter_events_use_existing_publication_and_edit_rules():
    async def verify():
        decoder = UdtalkDecoder("room")
        relay = CaptionRelay()
        stream = relay.snapshots()
        assert (await anext(stream)).captions == []
        partial = decoder.decode([message("途中", phase="updated", end=False)])[0]
        relay.source_event(partial)
        assert relay.public_snapshot().captions == []
        final = decoder.decode([message("確定", clock=2.0)])[0]
        relay.source_event(final)
        assert (await anext(stream)).captions[0].text == "確定"
        caption = relay.captions()[0]
        relay.patch_caption(caption.id, CaptionPatch(text="手修正", base_revision=caption.revision))
        assert (await anext(stream)).captions[0].text == "手修正"
        for event in decoder.decode([message("後着の認識", clock=3.0)]):
            relay.source_event(event)
        for event in decoder.decode([message("", phase="removed", clock=4.0)]):
            relay.source_event(event)
        assert relay.captions()[0].text == "手修正"
        assert relay.public_snapshot().captions[0].text == "手修正"
        assert set(relay.public_snapshot().captions[0].model_dump()) == {"id", "revision", "text"}
        await stream.aclose()
    asyncio.run(verify())


def test_removal_retracts_unedited_public_text_and_cannot_replay():
    with TestClient(create_app()) as client:
        decoder = UdtalkDecoder("room")
        for event in decoder.decode([message()]):
            assert client.post("/api/source/events", json=event.model_dump()).status_code == 200
        removed = decoder.decode([message("", phase="removed", clock=2.0)])[0]
        client.post("/api/source/events", json=removed.model_dump())
        assert client.get("/api/view").json()["captions"] == []
        assert client.post("/api/source/events", json=removed.model_dump()).json()["status"] == "duplicate"


def test_review_mode_and_hidden_input_remain_private():
    relay = CaptionRelay()
    decoder = UdtalkDecoder("room")
    relay.publication_mode(PublicationMode(auto_publish=False))
    relay.source_event(decoder.decode([message()])[0])
    assert relay.public_snapshot().captions == []
    relay.command(Command(command="hide"))
    relay.source_event(decoder.decode([message(identifier="hidden:00")])[0])
    relay.command(Command(command="show"))
    relay.publication_mode(PublicationMode(auto_publish=True))
    relay.source_event(decoder.decode([message("後着の入力", identifier="hidden:00", clock=2.0)])[0])
    assert relay.public_snapshot().captions == []


def test_removal_validation_and_disabled_connection():
    with TestClient(create_app()) as client:
        assert client.get("/api/source/udtalk").json()["state"] == "disabled"
        for changes in [{"text": "nonempty"}, {"is_final": True}, {"formatted_text": "AI"}]:
            event = UdtalkDecoder("room").decode([message()])[0].model_dump()
            event.update(text="", is_final=False, removed=True)
            event.update(changes)
            assert client.post("/api/source/events", json=event).status_code == 422
