import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import CaptionPatch, Command, PublicationMode
from app.relay import CaptionRelay
from app.udtalk import UdtalkDecoder, UdtalkProtocolError, WebMessage


def message(text="認識文", *, identifier="speech:00", phase="finalized", clock=1.0,
            end=True, kind=0, speaker=None, detected_name=None):
    return WebMessage(meta=json.dumps({
        "utteranceIdentifier": identifier, "phase": phase, "text": text,
        "connected": {"timestamp": clock, "name": speaker}, "detectedName": detected_name,
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


@pytest.mark.parametrize("phase", ["created", "updated", "modified"])
def test_empty_partial_keeps_the_published_caption_until_final(phase):
    async def verify():
        decoder = UdtalkDecoder("room")
        relay = CaptionRelay()
        stream = relay.snapshots()
        assert (await anext(stream)).captions == []
        relay.source_event(decoder.decode([message("公開文")])[0])
        assert (await anext(stream)).captions[0].text == "公開文"

        partial = decoder.decode([message("", phase=phase, clock=2.0, end=False)])[0]
        assert not partial.removed and not partial.is_final
        relay.source_event(partial)
        assert relay.captions()[0].original == ""
        assert relay.public_snapshot().captions[0].text == "公開文"

        relay.source_event(decoder.decode([message("次の確定文", clock=3.0)])[0])
        # The stream must not have queued a blank snapshot during the partial.
        assert (await anext(stream)).captions[0].text == "次の確定文"
        await stream.aclose()
    asyncio.run(verify())


@pytest.mark.parametrize("removed_index", [0, 1, 2])
def test_fragment_removal_publishes_the_remaining_final_text(removed_index):
    async def verify():
        decoder = UdtalkDecoder("room")
        relay = CaptionRelay()
        stream = relay.snapshots()
        assert (await anext(stream)).captions == []
        texts = ["前半", "中間", "後半"]
        fragments = [message(text, identifier=f"speech:{index:02d}",
                             clock=float(index + 1), end=index == 2)
                     for index, text in enumerate(texts)]
        relay.source_event(decoder.decode(fragments)[0])
        assert (await anext(stream)).captions[0].text == "前半中間後半"

        removed = message("", identifier=f"speech:{removed_index:02d}",
                          phase="removed", clock=4.0, end=None)
        remaining = decoder.decode([removed])[0]
        expected = "".join(text for index, text in enumerate(texts) if index != removed_index)
        assert remaining.is_final and not remaining.removed
        assert remaining.text == expected
        relay.source_event(remaining)
        assert relay.captions()[0].original == expected
        assert relay.public_snapshot().captions[0].text == expected
        assert (await anext(stream)).captions[0].text == expected

        assert decoder.decode(fragments + [removed]) == []
        assert decoder.decode([message("古い取消済み文", identifier=f"speech:{removed_index:02d}",
                                       clock=3.5)]) == []
        cancelled = decoder.decode([
            message("", identifier=f"speech:{index:02d}", phase="removed", clock=5.0, end=None)
            for index in range(3) if index != removed_index
        ])[0]
        assert cancelled.removed and not cancelled.is_final
        relay.source_event(cancelled)
        assert (await anext(stream)).captions == []
        await stream.aclose()
    asyncio.run(verify())


def test_unseen_fragment_remains_a_gap_until_explicitly_removed():
    decoder = UdtalkDecoder("room")
    incomplete = decoder.decode([
        message("前半"), message("後半", identifier="speech:02", clock=2.0),
    ])[0]
    assert incomplete.is_final is False
    completed = decoder.decode([
        message("", identifier="speech:01", phase="removed", clock=3.0, end=None),
    ])[0]
    assert completed.text == "前半後半" and completed.is_final and not completed.removed


def test_picture_record_does_not_replace_a_text_fragment():
    decoder = UdtalkDecoder("room")
    decoder.decode([message("維持する認識文")])
    assert decoder.decode([message("画像", clock=2.0, kind=1)]) == []


def test_recorded_blackhole_speech_is_private_until_all_fragments_are_final():
    # Captured from iOS UD Talk 344 on macOS via BlackHole + Kyoko.
    # Only protocol fields are retained; identifiers and clock origin are replaced.
    batches = json.loads((Path(__file__).parent / "fixtures/udtalk-blackhole-speech.json").read_text())
    decoder = UdtalkDecoder("test-room")
    relay = CaptionRelay()
    for index, batch in enumerate(batches):
        events = decoder.decode([WebMessage(meta=json.dumps(record)) for record in batch])
        assert len(events) == 1
        assert events[0].revision == index + 1
        for event in events:
            relay.source_event(event)
        if index < len(batches) - 1:
            assert events[0].is_final is False
            assert relay.public_snapshot().captions == []
        else:
            assert events[0].is_final is True
            assert relay.public_snapshot().captions[0].text == (
                "キャプションリレーの音声認識テストです。\n本日はありがとうございます。\n"
            )
        assert decoder.decode([WebMessage(meta=json.dumps(record)) for record in batch]) == []


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
        assert set(relay.public_snapshot().captions[0].model_dump()) == {"id", "revision", "text", "speaker"}
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
