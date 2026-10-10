import asyncio
from datetime import UTC, datetime

from pytest import MonkeyPatch

from app.models import Caption, CaptionPatch, Command, DisplaySettings, FormattedResult, PublicationMode, PublicSnapshot, SourceEvent
from app.relay import CaptionRelay


def event(revision: int = 1) -> SourceEvent:
    return SourceEvent(utterance_id="one", revision=revision, text=f"字幕{revision}", source_event_id=f"event-{revision}")


def source_caption(relay: CaptionRelay, caption_id: str, text: str, *, revision: int = 1, final: bool = True) -> Caption:
    result = relay.source_event(SourceEvent(
        utterance_id=caption_id, revision=revision, text=text, is_final=final,
        source_event_id=f"{caption_id}-{revision}",
    ))
    assert isinstance(result, Caption)
    return result


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
        assert second.model_dump()["captions"][0].keys() == {"id", "revision", "text", "speaker"}
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


def test_public_range_follows_input_order_and_restores_older_published_captions() -> None:
    relay = CaptionRelay()
    relay.display_settings(DisplaySettings(display_mode="recent"))
    source_caption(relay, "one", "最初の途中入力", final=False)
    source_caption(relay, "two", "先に確定した入力")
    source_caption(relay, "three", "三番目の入力")
    first = source_caption(relay, "one", "後から確定した最初の入力", revision=2)
    assert [caption.id for caption in relay.public_snapshot().captions] == ["three"]
    relay.patch_caption("one", CaptionPatch(text="最初の文の訂正", base_revision=first.revision))
    relay.display_settings(DisplaySettings(display_mode="recent", history_count=3))
    assert [(caption.id, caption.text) for caption in relay.public_snapshot().captions] == [
        ("one", "最初の文の訂正"), ("two", "先に確定した入力"), ("three", "三番目の入力"),
    ]
    relay.display_settings(DisplaySettings(display_mode="recent", history_count=1))
    assert [caption.id for caption in relay.public_snapshot().captions] == ["three"]
    relay.display_settings(DisplaySettings(display_mode="recent", history_count=3))
    assert [caption.id for caption in relay.public_snapshot().captions] == ["one", "two", "three"]
    assert len(relay.captions()) == 3


def test_scroll_history_keeps_all_public_captions_and_syncs_old_corrections() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        first = source_caption(relay, "0", "最初の入力")
        for number in range(1, 12):
            source_caption(relay, str(number), f"入力{number}")
        stream = relay.snapshots()
        initial = await anext(stream)
        assert initial.display.display_mode == "scroll"
        assert [caption.id for caption in initial.captions] == [str(number) for number in range(12)]
        relay.patch_caption("0", CaptionPatch(text="最初の文の訂正", base_revision=first.revision))
        corrected = await anext(stream)
        assert len(corrected.captions) == 12
        assert corrected.captions[0].text == "最初の文の訂正"
        relay.display_settings(DisplaySettings(display_mode="recent", history_count=2))
        assert [caption.id for caption in (await anext(stream)).captions] == ["10", "11"]
        relay.display_settings(DisplaySettings(display_mode="scroll", history_count=2))
        restored = await anext(stream)
        assert [caption.id for caption in restored.captions] == [str(number) for number in range(12)]
        assert restored.captions[0].text == "最初の文の訂正"
        await stream.aclose()
        reconnected = relay.snapshots()
        assert await anext(reconnected) == restored
        await reconnected.aclose()
    asyncio.run(run())


def test_manual_first_publication_of_an_older_caption_keeps_input_order() -> None:
    relay = CaptionRelay()
    relay.display_settings(DisplaySettings(display_mode="recent"))
    relay.publication_mode(PublicationMode(auto_publish=False))
    older = source_caption(relay, "one", "古い入力")
    newer = source_caption(relay, "two", "新しい入力")
    assert relay.public_snapshot().captions == []
    relay.patch_caption("two", CaptionPatch(text="新しい文の確認", base_revision=newer.revision))
    relay.patch_caption("one", CaptionPatch(text="古い文の確認", base_revision=older.revision))
    assert [caption.id for caption in relay.public_snapshot().captions] == ["two"]
    relay.display_settings(DisplaySettings(display_mode="recent", history_count=2))
    assert [(caption.id, caption.text) for caption in relay.public_snapshot().captions] == [
        ("one", "古い文の確認"), ("two", "新しい文の確認"),
    ]


def test_stream_ignores_interim_and_revision_only_updates_but_keeps_latest_revision_on_reconnect() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        stream = relay.snapshots()
        assert (await anext(stream)).captions == []
        queue = next(iter(relay._subscribers))
        relay.command(Command(command="show"))
        relay.display_settings(DisplaySettings())
        source_caption(relay, "pending", "途中の入力", final=False)
        relay.formatted_result("pending", FormattedResult(source_revision=1, text="途中入力のAI候補"))
        assert queue.empty()

        source_caption(relay, "one", "公開文")
        initial = await anext(stream)
        repeated = source_caption(relay, "one", "公開文", revision=2)
        assert queue.empty()
        assert relay.public_snapshot().captions[0].revision == repeated.revision
        assert initial.captions[0].revision != repeated.revision
        reconnected = relay.snapshots()
        assert (await anext(reconnected)).captions[0].revision == repeated.revision
        await reconnected.aclose()

        interim = source_caption(relay, "one", "次の途中入力", revision=3, final=False)
        relay.patch_caption("one", CaptionPatch(text="人の訂正", base_revision=interim.revision))
        assert queue.empty()
        source_caption(relay, "one", "次の確定入力", revision=4)
        assert (await anext(stream)).captions[0].text == "人の訂正"
        relay.formatted_result("one", FormattedResult(source_revision=4, text="後着のAI修正"))
        assert queue.empty()
        source_caption(relay, "two", "人の訂正")
        assert [caption.id for caption in (await anext(stream)).captions] == ["one", "two"]
        await stream.aclose()
    asyncio.run(run())


def test_stream_only_notifies_changes_within_the_selected_public_range() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        relay.display_settings(DisplaySettings(display_mode="recent"))
        first = source_caption(relay, "one", "最初の入力")
        source_caption(relay, "two", "二番目の入力")
        source_caption(relay, "three", "三番目の入力")
        stream = relay.snapshots()
        assert [caption.id for caption in (await anext(stream)).captions] == ["three"]
        queue = next(iter(relay._subscribers))
        relay.patch_caption("one", CaptionPatch(text="過去の文の訂正", base_revision=first.revision))
        assert queue.empty()
        relay.display_settings(DisplaySettings(display_mode="recent", history_count=3))
        expanded = await anext(stream)
        assert [(caption.id, caption.text) for caption in expanded.captions] == [
            ("one", "過去の文の訂正"), ("two", "二番目の入力"), ("three", "三番目の入力"),
        ]
        relay.display_settings(DisplaySettings(display_mode="recent", history_count=3))
        assert queue.empty()
        relay.display_settings(DisplaySettings(display_mode="recent", history_count=1))
        assert [caption.id for caption in (await anext(stream)).captions] == ["three"]
        await stream.aclose()
    asyncio.run(run())


def test_stream_notifies_display_and_visibility_changes_without_republishing_hidden_input() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        first = source_caption(relay, "one", "公開文")
        stream = relay.snapshots()
        await anext(stream)
        queue = next(iter(relay._subscribers))
        relay.display_settings(DisplaySettings(font_size=48))
        assert (await anext(stream)).display.font_size == 48
        relay.command(Command(command="hide"))
        hidden = await anext(stream)
        assert hidden.visible is False
        assert hidden.captions == []
        relay.command(Command(command="hide"))
        source_caption(relay, "hidden", "非表示中の入力")
        assert queue.empty()
        relay.command(Command(command="show"))
        resumed = await anext(stream)
        assert resumed.visible is True
        assert resumed.captions == []
        relay.patch_caption("one", CaptionPatch(text="再公開しない訂正", base_revision=first.revision))
        source_caption(relay, "hidden", "非表示中の入力の続き", revision=2)
        assert queue.empty()
        source_caption(relay, "new", "表示再開後の新しい入力")
        assert [caption.id for caption in (await anext(stream)).captions] == ["new"]
        relay.display_settings(DisplaySettings(display_mode="recent", history_count=10))
        assert [caption.id for caption in (await anext(stream)).captions] == ["new"]
        await stream.aclose()
    asyncio.run(run())


def test_public_snapshots_are_independent_for_each_subscriber() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        first = relay.snapshots()
        second = relay.snapshots()
        await anext(first)
        await anext(second)
        source_caption(relay, "one", "公開文")
        first_snapshot = await anext(first)
        first_snapshot.captions[0].text = "購読者の変更"
        first_snapshot.display.background = "#00ff00"
        second_snapshot = await anext(second)
        assert second_snapshot.captions[0].text == "公開文"
        assert second_snapshot.display.background == "#0a0a0a"
        assert relay.public_snapshot().captions[0].text == "公開文"
        assert relay.public_snapshot().display.background == "#0a0a0a"
        await first.aclose()
        assert len(relay._subscribers) == 1
        await second.aclose()
        assert not relay._subscribers
    asyncio.run(run())


def test_overflow_and_reconnect_send_complete_bounded_snapshots() -> None:
    async def run() -> None:
        relay = CaptionRelay()
        relay.display_settings(DisplaySettings(display_mode="recent", history_count=3))
        stream = relay.snapshots()
        await anext(stream)
        for number in range(1, 6):
            source_caption(relay, str(number), f"入力{number}")
        latest = await anext(stream)
        assert [caption.id for caption in latest.captions] == ["3", "4", "5"]
        assert latest.display.history_count == 3
        await stream.aclose()
        reconnected = relay.snapshots()
        assert await anext(reconnected) == relay.public_snapshot()
        await reconnected.aclose()
    asyncio.run(run())
