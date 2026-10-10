"""Synthetic events follow the published Realtime protocol; no live API calls."""

from app.models import Caption
from app.relay import CaptionRelay
from app.transcription.openai import OpenAITranscripts

import asyncio
import base64
import json
import secrets
from pathlib import Path

from app.transcription.budget import TrialBudget


class ProviderSocket:
    """External Realtime peer implementing only the published events used here."""
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.audio = bytearray()

    async def send(self, raw):
        packet = json.loads(raw)
        self.sent.append(packet)
        if packet["type"] == "session.update":
            await self.incoming.put(json.dumps({"type": "session.updated"}))
        elif packet["type"] == "input_audio_buffer.append":
            self.audio.extend(base64.b64decode(packet["audio"]))
        elif packet["type"] == "input_audio_buffer.commit":
            await self.incoming.put(json.dumps({"type": "input_audio_buffer.committed", "item_id": "one"}))
            await self.incoming.put(json.dumps({"type": "conversation.item.input_audio_transcription.completed",
                                                "item_id": "one", "transcript": "認識結果"}))

    async def recv(self):
        return await self.incoming.get()

    async def close(self):
        self.closed = True


class Voiced:
    def is_speech(self, audio, sample_rate):
        return True


def test_partial_is_revised_and_same_text_final_is_published():
    relay = CaptionRelay()
    transcripts = OpenAITranscripts("first")
    for packet in [
        {"type": "conversation.item.input_audio_transcription.delta", "event_id": "a", "item_id": "one", "delta": "本日は"},
        {"type": "conversation.item.input_audio_transcription.delta", "event_id": "b", "item_id": "one", "delta": "ありがとうございます。"},
    ]:
        for event in transcripts.receive(packet):
            relay.source_event(event)
    assert relay.public_snapshot().captions == []
    assert relay.captions()[0].original == "本日はありがとうございます。"
    final = transcripts.receive({"type": "conversation.item.input_audio_transcription.completed", "event_id": "c",
                                 "item_id": "one", "transcript": "本日はありがとうございます。"})
    assert len(final) == 1
    result = relay.source_event(final[0])
    assert isinstance(result, Caption) and result.source_final
    assert [caption.text for caption in relay.public_snapshot().captions] == ["本日はありがとうございます。"]


def test_out_of_order_finals_keep_the_committed_audio_order():
    relay = CaptionRelay()
    transcripts = OpenAITranscripts("second")
    transcripts.receive({"type": "input_audio_buffer.committed", "item_id": "one", "previous_item_id": None})
    transcripts.receive({"type": "input_audio_buffer.committed", "item_id": "two", "previous_item_id": "one"})
    for packet in [
        {"type": "conversation.item.input_audio_transcription.completed", "item_id": "two", "transcript": "後の発話"},
        {"type": "conversation.item.input_audio_transcription.completed", "item_id": "one", "transcript": "先の発話"},
    ]:
        for event in transcripts.receive(packet):
            relay.source_event(event)
    assert [caption.original for caption in relay.captions()] == ["先の発話", "後の発話"]


def test_duplicates_and_late_deltas_do_not_replace_a_human_edit():
    relay = CaptionRelay()
    transcripts = OpenAITranscripts("third")
    packet = {"type": "conversation.item.input_audio_transcription.delta", "event_id": "a", "item_id": "one", "delta": "認識文"}
    for event in transcripts.receive(packet):
        relay.source_event(event)
    assert transcripts.receive(packet) == []
    before = relay.captions()[0]
    from app.models import CaptionPatch
    relay.patch_caption(before.id, CaptionPatch(text="手修正文", base_revision=before.revision))
    final = {"type": "conversation.item.input_audio_transcription.completed", "event_id": "b", "item_id": "one", "transcript": "認識文の確定"}
    for event in transcripts.receive(final):
        relay.source_event(event)
    assert relay.captions()[0].text == "手修正文"
    assert transcripts.receive(final) == []
    assert transcripts.receive({**packet, "event_id": "late"}) == []


def test_stop_commits_pending_audio_once_and_closes_the_paid_connection(tmp_path: Path):
    from app.transcription.openai import OpenAIRecognizer

    async def verify():
        socket = ProviderSocket()
        async def connect(key):
            return socket
        accepted = []
        recognizer = OpenAIRecognizer(secrets.token_hex(16), "stop", accepted.append,
            TrialBudget(tmp_path / "usage.json", yen_per_usd=200), connector=connect, detector=Voiced())
        await recognizer.start()
        audio = b'\x01\x00' * 4800
        await recognizer.push_audio(audio)
        await recognizer.finish()
        await recognizer.finish()
        assert len([event for event in socket.sent if event["type"] == "input_audio_buffer.commit"]) == 1
        assert bytes(socket.audio) == audio
        assert [event.text for event in accepted if event.is_final] == ["認識結果"]
        assert socket.closed
    asyncio.run(verify())
