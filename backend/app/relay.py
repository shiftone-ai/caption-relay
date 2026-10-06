import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from .ai import AiRouter
from .models import (
    AiRouting, AiSettings, Caption, CaptionPatch, Command, PublicCaption, PublicSnapshot,
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
        self._seen_events: set[str] = set()
        self._subscribers: set[asyncio.Queue[PublicSnapshot]] = set()
        self._visible = True
        self._revision = 0
        self._auto_publish = True
        self._display = DisplaySettings()
        self._ai = AiRouter()

    def session(self) -> Session:
        return Session(visible=self._visible, count=len(self._captions),
                       auto_publish=self._auto_publish,
                       display=self._display.model_copy(deep=True))

    def captions(self) -> list[Caption]:
        return [caption.model_copy(deep=True) for caption in self._captions.values()]

    def public_snapshot(self) -> PublicSnapshot:
        return PublicSnapshot(
            visible=self._visible,
            display=self._display.model_copy(deep=True),
            captions=[
                PublicCaption(id=caption.id, revision=caption.public_revision, text=caption.public_text)
                for caption in self._captions.values()
                if caption.published and caption.public_revision is not None and caption.public_text is not None
            ],
        )

    def _publish(self) -> None:
        snapshot = self.public_snapshot()
        for queue in self._subscribers:
            if queue.full():
                # Every event is a complete snapshot; discard old snapshots.
                while not queue.empty():
                    queue.get_nowait()
            queue.put_nowait(snapshot.model_copy(deep=True))

    def source_event(self, event: SourceEvent) -> Caption | SourceIgnored:
        if event.source_event_id in self._seen_events:
            return SourceIgnored(status="duplicate")
        self._seen_events.add(event.source_event_id)
        existing = self._captions.get(event.utterance_id)
        if existing:
            if event.revision <= existing.source_revision:
                return SourceIgnored(status="stale")
            existing.original = event.text
            existing.source_revision = event.revision
            existing.formatted_text = event.formatted_text
            existing.source_final = event.is_final
            if not existing.human_edited:
                self._revision += 1
                existing.text = event.formatted_text or event.text
                existing.revision = self._revision
            if self._visible and event.is_final and existing.publish_eligible and self._auto_publish:
                self._publish_caption(existing)
        else:
            self._revision += 1
            existing = Caption(
                id=event.utterance_id, utterance_id=event.utterance_id,
                received_at=datetime.now(UTC),
                source_revision=event.revision, revision=self._revision,
                original=event.text, text=event.formatted_text or event.text,
                formatted_text=event.formatted_text, source_final=event.is_final,
                published=self._visible and event.is_final and self._auto_publish,
                publish_eligible=self._visible,
            )
            self._captions[event.utterance_id] = existing
            if existing.published:
                self._publish_caption(existing)
        existing.ai_result = None
        existing.ai_request = self._ai.plan(event.revision) if event.is_final and event.formatted_text is None and not existing.human_edited else None
        self._publish()
        return existing.model_copy(deep=True)

    def patch_caption(self, caption_id: str, patch: CaptionPatch) -> Caption:
        caption = self._captions.get(caption_id)
        if caption is None:
            raise CaptionNotFound(caption_id)
        if patch.base_revision != caption.revision:
            raise RevisionConflict(caption)
        self._revision += 1
        caption.text = patch.text
        caption.revision = self._revision
        caption.human_edited = True
        if self._visible and caption.publish_eligible and caption.source_final:
            self._publish_caption(caption)
        self._publish()
        return caption.model_copy(deep=True)

    @staticmethod
    def _publish_caption(caption: Caption) -> None:
        caption.published = True
        caption.public_text = caption.text
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
