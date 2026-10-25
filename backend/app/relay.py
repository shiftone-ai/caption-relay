import asyncio
from bisect import insort
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from .ai import AiRouter
from .models import (
    AiCorrectionContext, AiModelId, AiRouting, AiSettings, Caption, CaptionPatch, Command, PublicCaption, PublicSnapshot,
    DisplaySettings, FormattedResult, PublicationMode, Session, SourceEvent, SourceIgnored, Visibility,
)


class CaptionNotFound(Exception):
    pass


class RevisionConflict(Exception):
    def __init__(self, latest: Caption) -> None:
        self.latest = latest.model_copy(deep=True)
        super().__init__("revision conflict")


class CaptionRelay:
    """Owns the in-memory session. Run with a single server process."""

    def __init__(self) -> None:
        self._captions: dict[str, Caption] = {}
        self._caption_positions: dict[str, int] = {}
        self._published_ids: list[str] = []
        self._seen_events: set[str] = set()
        self._retired_utterances: set[str] = set()
        self._subscribers: set[asyncio.Queue[PublicSnapshot]] = set()
        self._visible = True
        self._revision = 0
        self._auto_publish = True
        self._display = DisplaySettings()
        self._ai = AiRouter()
        self._connection_mode = "host"
        self._context_start_position = 0
        self._public_signature: tuple[bool, str, tuple[tuple[str, str, str | None], ...]] = (
            self._visible, self._display.model_dump_json(), (),
        )

    def session(self) -> Session:
        return Session(visible=self._visible, count=len(self._captions),
                       auto_publish=self._auto_publish,
                       display=self._display.model_copy(deep=True))

    def captions(self) -> list[Caption]:
        return [caption.model_copy(deep=True) for caption in self._captions.values()]

    def reset_captions(self) -> None:
        self._retired_utterances.update(self._captions)
        self._captions.clear()
        self._caption_positions.clear()
        self._published_ids.clear()
        self._revision += 1
        self.connection_mode(self._connection_mode)

    def public_snapshot(self) -> PublicSnapshot:
        if self._connection_mode == "client":
            return PublicSnapshot(visible=False, captions=[], display=self._display.model_copy(deep=True))
        captions: list[PublicCaption] = []
        published_ids = self._published_ids if self._display.display_mode == "scroll" else self._published_ids[-self._display.history_count:]
        for caption_id in published_ids:
            caption = self._captions[caption_id]
            if caption.public_revision is not None and caption.public_text is not None:
                captions.append(PublicCaption(id=caption.id, revision=caption.public_revision, text=caption.public_text,
                    speaker=caption.public_speaker if self._display.speaker_display != "hidden" else None))
        return PublicSnapshot(
            visible=self._visible,
            display=self._display.model_copy(deep=True),
            captions=captions,
        )

    def connection_mode(self, mode: str, *, reset_context: bool = True) -> None:
        self._connection_mode = mode
        if reset_context:
            self._context_start_position = len(self._captions)
        self._publish()

    def ai_context(self, caption_id: str) -> AiCorrectionContext:
        """Snapshot only preceding, complete utterances from the current connection."""
        position = self._caption_positions[caption_id]
        recent: list[str] = []
        size = 0
        for identifier in reversed(self._captions):
            previous_position = self._caption_positions[identifier]
            if previous_position >= position:
                continue
            if previous_position < self._context_start_position:
                break
            previous = self._captions[identifier]
            if not previous.source_final or not previous.text.strip():
                continue
            if size + len(previous.text) > 3000:
                break
            recent.append(previous.text)
            size += len(previous.text)
            if len(recent) == 6:
                break
        return AiCorrectionContext(background=self._ai.snapshot().settings.background,
                                   recent_utterances=list(reversed(recent)))

    def _publish(self) -> None:
        snapshot = self.public_snapshot()
        signature = (
            snapshot.visible, snapshot.display.model_dump_json(),
            tuple((caption.id, caption.text, caption.speaker) for caption in snapshot.captions),
        )
        if signature == self._public_signature:
            return
        self._public_signature = signature
        for queue in self._subscribers:
            if queue.full():
                # Every event is a complete snapshot; discard old snapshots.
                while not queue.empty():
                    queue.get_nowait()
            queue.put_nowait(snapshot.model_copy(deep=True))

    def source_event(self, event: SourceEvent, *, remote_edit: bool = False) -> Caption | SourceIgnored:
        if event.utterance_id in self._retired_utterances:
            return SourceIgnored(status="stale")
        if event.source_event_id in self._seen_events:
            return SourceIgnored(status="duplicate")
        self._seen_events.add(event.source_event_id)
        existing = self._captions.get(event.utterance_id)
        if existing is None and event.removed:
            return SourceIgnored(status="stale")
        if existing:
            if event.revision <= existing.source_revision:
                return SourceIgnored(status="stale")
            existing.original = event.text
            existing.speaker = event.speaker
            existing.source_revision = event.revision
            existing.formatted_text = event.formatted_text
            existing.source_final = event.is_final
            if not existing.human_edited or remote_edit:
                self._revision += 1
                existing.text = event.formatted_text or event.text
                existing.revision = self._revision
            if event.removed and not existing.human_edited:
                existing.published = False
                existing.public_text = None
                existing.public_speaker = None
                existing.public_revision = None
                if existing.id in self._published_ids:
                    self._published_ids.remove(existing.id)
            if self._visible and event.is_final and existing.publish_eligible and self._auto_publish:
                self._publish_caption(existing)
        else:
            self._revision += 1
            existing = Caption(
                id=event.utterance_id, utterance_id=event.utterance_id,
                received_at=datetime.now(UTC),
                source_revision=event.revision, revision=self._revision,
                original=event.text, text=event.formatted_text or event.text, speaker=event.speaker,
                formatted_text=event.formatted_text, source_final=event.is_final,
                published=False,
                publish_eligible=self._visible and self._connection_mode == "host",
            )
            self._caption_positions[event.utterance_id] = len(self._captions)
            self._captions[event.utterance_id] = existing
            if self._visible and event.is_final and existing.publish_eligible and self._auto_publish:
                self._publish_caption(existing)
        if remote_edit:
            existing.human_edited = True
        existing.ai_result = None
        existing.ai_request = self._ai.plan(event.revision) if event.is_final and event.formatted_text is None and not existing.human_edited else None
        existing.ai_status = "queued" if existing.ai_request is not None else "off"
        existing.ai_error = None
        self._publish()
        return existing.model_copy(deep=True)

    def caption(self, caption_id: str) -> Caption:
        caption = self._captions.get(caption_id)
        if caption is None:
            raise CaptionNotFound(caption_id)
        return caption.model_copy(deep=True)

    def validate_patch(self, caption_id: str, patch: CaptionPatch) -> Caption:
        caption = self.caption(caption_id)
        if patch.base_revision != caption.revision or (
            patch.base_source_revision is not None and patch.base_source_revision != caption.source_revision
        ):
            raise RevisionConflict(caption)
        return caption

    def ai_availability(self, models: set[AiModelId]) -> None:
        self._ai.set_available(models)

    def ai_status(self, caption_id: str, request_id: str, status: str, message: str | None = None) -> None:
        caption = self._captions[caption_id]
        if caption.ai_request is not None and caption.ai_request.id == request_id:
            # Validate external status values through the existing model contract.
            update = caption.model_dump()
            update.update(ai_status=status, ai_error=message)
            self._captions[caption_id] = Caption.model_validate(update)

    def patch_caption(self, caption_id: str, patch: CaptionPatch) -> Caption:
        self.validate_patch(caption_id, patch)
        caption = self._captions[caption_id]
        self._revision += 1
        caption.text = patch.text
        caption.revision = self._revision
        caption.human_edited = True
        if self._visible and caption.publish_eligible and caption.source_final:
            self._publish_caption(caption)
        self._publish()
        return caption.model_copy(deep=True)

    def _publish_caption(self, caption: Caption) -> None:
        if not caption.published:
            # A late final result or manual save keeps the original input order.
            insort(self._published_ids, caption.id, key=self._caption_positions.__getitem__)
        caption.published = True
        caption.public_text = caption.text
        caption.public_speaker = caption.speaker
        caption.public_revision = caption.revision

    def formatted_result(self, caption_id: str, result: FormattedResult) -> Caption | SourceIgnored:
        caption = self._captions.get(caption_id)
        if caption is None:
            raise CaptionNotFound(caption_id)
        if result.source_revision != caption.source_revision:
            return SourceIgnored(status="stale")
        if result.ai is not None:
            planned = caption.ai_request
            if planned is None or planned.id != result.ai.request_id or planned.model_id != result.ai.model_id:
                return SourceIgnored(status="stale")
            if caption.ai_result is not None:
                return SourceIgnored(status="duplicate")
            self._ai.record(result.ai)
            caption.ai_result = result.ai.model_copy(deep=True)
            caption.ai_status = "succeeded"
            caption.ai_error = None
        if caption.formatted_text == result.text:
            return caption.model_copy(deep=True)
        caption.formatted_text = result.text
        if not caption.human_edited:
            self._revision += 1
            caption.text = result.text
            caption.revision = self._revision
        if self._auto_publish and self._visible and caption.publish_eligible and caption.source_final:
            self._publish_caption(caption)
        self._publish()
        return caption.model_copy(deep=True)

    def command(self, command: Command) -> Visibility:
        self._visible = command.command == "show"
        if not self._visible:
            for caption in self._captions.values():
                caption.published = False
                caption.publish_eligible = False
            self._published_ids.clear()
        self._publish()
        return Visibility(visible=self._visible)

    def publication_mode(self, mode: PublicationMode) -> PublicationMode:
        self._auto_publish = mode.auto_publish
        return PublicationMode(auto_publish=self._auto_publish)

    def display_settings(self, settings: DisplaySettings) -> DisplaySettings:
        self._display = settings.model_copy(deep=True)
        self._publish()
        return self._display.model_copy(deep=True)

    def ai_routing(self) -> AiRouting:
        return self._ai.snapshot()

    def ai_settings(self, settings: AiSettings) -> AiRouting:
        return self._ai.configure(settings)

    async def snapshots(self) -> AsyncIterator[PublicSnapshot]:
        queue: asyncio.Queue[PublicSnapshot] = asyncio.Queue(maxsize=4)
        # Registration and initial snapshot happen without an await between them.
        self._subscribers.add(queue)
        try:
            yield self.public_snapshot()
            while True:
                yield await queue.get()
        finally:
            self._subscribers.discard(queue)
