import asyncio
from collections.abc import AsyncIterator

from .models import (
    Caption, CaptionPatch, Command, PublicCaption, PublicSnapshot,
    Session, SourceEvent, SourceIgnored, Visibility,
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

    def session(self) -> Session:
        return Session(visible=self._visible, count=len(self._captions))

    def captions(self) -> list[Caption]:
        return [caption.model_copy(deep=True) for caption in self._captions.values()]

    def public_snapshot(self) -> PublicSnapshot:
        return PublicSnapshot(
            visible=self._visible,
            captions=[
                PublicCaption(id=caption.id, revision=caption.revision, text=caption.text)
                for caption in self._captions.values() if caption.published
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
            if not existing.human_edited:
                self._revision += 1
                existing.text = event.text
                existing.revision = self._revision
            existing.published = self._visible and event.is_final and existing.publish_eligible
        else:
            self._revision += 1
            existing = Caption(
                id=event.utterance_id, utterance_id=event.utterance_id,
                source_revision=event.revision, revision=self._revision,
                original=event.text, text=event.text,
                published=self._visible and event.is_final, publish_eligible=self._visible,
            )
            self._captions[event.utterance_id] = existing
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
