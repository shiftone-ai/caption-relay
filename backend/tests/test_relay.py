import asyncio

from app.models import Caption, CaptionPatch, PublicSnapshot, SourceEvent
from app.relay import CaptionRelay


def event(revision: int = 1) -> SourceEvent:
    return SourceEvent(utterance_id="one", revision=revision, text=f"字幕{revision}", source_event_id=f"event-{revision}")


def test_returned_captions_cannot_mutate_session_state() -> None:
    relay = CaptionRelay()
    result = relay.source_event(event())
    assert isinstance(result, Caption)
    result.text = "外部の変更"
    relay.captions()[0].text = "一覧の変更"
    assert relay.captions()[0].text == "字幕1"


def test_snapshots_are_typed_immutable_history_and_unregister() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        relay.source_event(event())
        stream = relay.snapshots()
        first = await anext(stream)
        assert isinstance(first, PublicSnapshot)
        relay.patch_caption("one", CaptionPatch(text="修正", base_revision=1))
        second = await anext(stream)
        assert first.captions[0].text == "字幕1"
        assert second.captions[0].text == "修正"
        assert second.model_dump()["captions"][0].keys() == {"id", "revision", "text"}
        await stream.aclose()
    asyncio.run(run())


def test_full_subscription_queue_resynchronizes_with_latest_snapshot() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        stream = relay.snapshots()
        await anext(stream)
        for revision in range(1, 6):
            relay.source_event(event(revision))
        snapshot = await anext(stream)
        assert snapshot.captions[0].text == "字幕5"
        await stream.aclose()
    asyncio.run(run())
