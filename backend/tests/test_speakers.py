import asyncio
import json
from time import time

from app.models import Caption, CaptionPatch, DisplaySettings, PublicationMode, SourceEvent
from app.relay import CaptionRelay
from app.udtalk import UdtalkDecoder, WebMessage
from app.udtalk_editor import SharingInfo, UdtalkEditor


def message(name, *, clock=1.0, detected=None, identifier="speech:00", text="認識文"):
    return WebMessage(meta=json.dumps({
        "utteranceIdentifier": identifier, "phase": "finalized", "text": text,
        "type": 0, "endOfUtterance": True, "connected": {"timestamp": clock, "name": name},
        "detectedName": detected, "uniqueIdentifier": "speaker", "sendingUniqueIdentifier": "speaker",
    }))


def test_decoder_preserves_names_and_emits_name_only_revisions_without_stale_rollback():
    decoder = UdtalkDecoder("room")
    first = decoder.decode([message(" 山田 ")])[0]
    assert first.speaker == "山田" and first.text == "認識文"
    renamed = decoder.decode([message("山田太郎", clock=2.0)])[0]
    assert renamed.utterance_id == first.utterance_id and renamed.revision == 2
    assert renamed.speaker == "山田太郎" and renamed.text == first.text
    assert decoder.decode([message("古い名前", clock=1.5)]) == []
    assert decoder.decode([message(" ", clock=3.0)])[0].speaker is None


def test_detected_speaker_takes_precedence_over_device_name_across_fragments():
    decoder = UdtalkDecoder("room")
    result = decoder.decode([
        message("会場", text="質問です。"),
        message("会場", clock=2.0, detected="佐藤", identifier="speech:01", text="確認できますか。"),
    ])[0]
    assert result.speaker == "佐藤" and result.text == "質問です。確認できますか。"


def test_name_changes_reach_sse_and_hidden_mode_omits_names_until_enabled_again():
    async def run():
        relay = CaptionRelay()
        stream = relay.snapshots()
        await anext(stream)
        for revision, name in [(1, "山田"), (2, "山田太郎")]:
            relay.source_event(SourceEvent(utterance_id="one", revision=revision, text="同じ本文",
                speaker=name, source_event_id=f"one-{revision}"))
            public = (await anext(stream)).captions[0]
            assert public.speaker == name and public.text == "同じ本文"
        relay.display_settings(DisplaySettings(speaker_display="hidden"))
        assert (await anext(stream)).captions[0].speaker is None
        assert relay.captions()[0].speaker == "山田太郎"
        relay.display_settings(DisplaySettings(speaker_display="inline"))
        assert (await anext(stream)).captions[0].speaker == "山田太郎"
        await stream.aclose()
    asyncio.run(run())


def test_pending_name_does_not_change_public_name_and_text_edits_preserve_speaker():
    relay = CaptionRelay()
    relay.source_event(SourceEvent(utterance_id="one", revision=1, text="原文", speaker="山田", source_event_id="one-1"))
    relay.publication_mode(PublicationMode(auto_publish=False))
    updated = relay.source_event(SourceEvent(utterance_id="one", revision=2, text="次の文", speaker="山田太郎", source_event_id="one-2"))
    assert isinstance(updated, Caption)
    assert relay.public_snapshot().captions[0].speaker == "山田"
    saved = relay.patch_caption("one", CaptionPatch(text="手修正", base_revision=updated.revision))
    assert saved.speaker == "山田太郎" and relay.public_snapshot().captions[0].speaker == "山田太郎"
    relay.source_event(SourceEvent(utterance_id="one", revision=3, text="後着の認識文", speaker="山田太郎", source_event_id="one-3"))
    assert relay.captions()[0].text == "手修正"


def test_editor_receives_names_and_name_only_changes():
    async def run():
        accepted = []
        editor = UdtalkEditor(SharingInfo("test-talk", "test-key", time() + 3600),
            lambda event, remote_edit: accepted.append(event))
        try:
            editor._receive([message("山田")])
            editor._receive([message("山田太郎", clock=2.0)])
            assert [event.speaker for event in accepted] == ["山田", "山田太郎"]
            assert accepted[0].utterance_id == accepted[1].utterance_id
            assert accepted[1].revision == 2
        finally:
            await editor.stop()
    asyncio.run(run())
