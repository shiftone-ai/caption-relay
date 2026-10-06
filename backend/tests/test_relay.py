import asyncio
from datetime import UTC, datetime

from pytest import MonkeyPatch

from app.models import Caption, CaptionPatch, FormattedResult, PublicSnapshot, SourceEvent
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


def test_received_time_stays_at_first_input_through_revisions_and_edits(monkeypatch: MonkeyPatch) -> None:
    first_time = datetime(2026, 10, 6, 1, 2, 3, tzinfo=UTC)
    later_time = datetime(2026, 10, 6, 1, 4, 5, tzinfo=UTC)
    times = iter([first_time, later_time])

    class Clock:
        @staticmethod
        def now(tz: object) -> datetime:
            assert tz is UTC
            return next(times)

    monkeypatch.setattr("app.relay.datetime", Clock)
    relay = CaptionRelay()
    first = relay.source_event(event())
    assert isinstance(first, Caption)
    assert first.received_at == first_time
    assert first.model_dump(mode="json")["received_at"] == "2026-10-06T01:02:03Z"
    relay.source_event(event(2))
    formatted = relay.formatted_result("one", FormattedResult(source_revision=2, text="AI修正"))
    assert isinstance(formatted, Caption)
    saved = relay.patch_caption("one", CaptionPatch(text="手修正", base_revision=formatted.revision))
    assert saved.received_at == first_time
    relay.source_event(event(3))
    relay.source_event(event(3))
    assert relay.captions()[0].received_at == first_time
    second = relay.source_event(SourceEvent(
        utterance_id="two", revision=1, text="次の発話", source_event_id="next-event",
    ))
    assert isinstance(second, Caption)
    assert second.received_at == later_time


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
