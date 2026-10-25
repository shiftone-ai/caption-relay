"""One active connection, with isolated room state and saved connection bookmarks."""

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

from .models import (
    AiRouting, AiSettings, Caption, CaptionPatch, Command, ConnectionSettings, ConnectionStatus,
    DisplaySettings, FormattedResult, PublicationMode, SourceIgnored, Visibility,
)
from .room_models import RoomCatalog, RoomDetails, RoomDraft, RoomSummary, SavedRoom
from .room_store import RoomStore
from .udtalk_editor import EditorError, decode_editor_url
from .workflow import CaptionWorkflow


class RoomNotFound(Exception):
    pass


class RoomConflict(Exception):
    pass


def validate_connection(settings: ConnectionSettings) -> None:
    if settings.mode == "client":
        if settings.input_source != "udtalk" or not settings.editor_url:
            raise EditorError("UDトークの編集用の参加リンクを入力してください。")
        decode_editor_url(settings.editor_url)
    elif settings.editor_url:
        raise EditorError("独立配信では編集用リンクを使いません。")


class Rooms:
    def __init__(self, initial: CaptionWorkflow, factory: Callable[[], CaptionWorkflow], store: RoomStore) -> None:
        self.store = store
        self._factory = factory
        self._workflows = {"default": initial}
        self.active_room_id: str | None = None if store.restored else "default"
        self._configured: dict[str, ConnectionSettings] = {}
        self._changes = asyncio.Lock()

    def start(self) -> None:
        if self.active_room_id is not None:
            self._workflows["default"].start()

    async def stop(self) -> None:
        async with self._changes:
            self.active_room_id = None
            for workflow in self._workflows.values():
                await workflow.stop()

    def _record(self, room_id: str) -> SavedRoom:
        try:
            return self.store.get(room_id)
        except KeyError:
            raise RoomNotFound("ルームが見つかりません。ホームから選び直してください。") from None

    def workflow(self, room_id: str | None = None, generation: int | None = None, *, active: bool = False) -> CaptionWorkflow:
        identifier = room_id or self.active_room_id or "default"
        room = self._record(identifier)
        if generation is not None and generation != room.generation:
            raise RoomConflict("字幕がリセットされました。画面を読み直してください。")
        if active and self.active_room_id != identifier:
            raise RoomConflict("このルームの接続は終了しました。ホームから接続してください。")
        if identifier not in self._workflows:
            workflow = self._factory()
            workflow.relay.ai_settings(room.ai)
            workflow.relay.display_settings(room.display)
            workflow.relay.publication_mode(PublicationMode(auto_publish=room.auto_publish))
            if not room.visible:
                workflow.relay.command(Command(command="hide"))
            self._workflows[identifier] = workflow
        return self._workflows[identifier]

    def details(self, room_id: str) -> RoomDetails:
        room = self._record(room_id)
        workflow = self._workflows.get(room_id)
        return RoomDetails(id=room.id, name=room.name, generation=room.generation,
            last_used_at=room.last_used_at, caption_count=workflow.relay.session().count if workflow else 0,
            mode=room.connection.mode, input_source=room.connection.input_source, recognizer=room.connection.recognizer,
            background=room.ai.background, ai=room.ai,
            connection=room.connection.model_copy(update={"editor_url": None}))

    def catalog(self) -> RoomCatalog:
        records = sorted(self.store.all(), key=lambda room: (room.last_used_at or datetime.min.replace(tzinfo=UTC), room.id), reverse=True)
        return RoomCatalog(active_room_id=self.active_room_id,
            rooms=[RoomSummary.model_validate(self.details(room.id).model_dump(exclude={"ai", "connection"})) for room in records])

    async def save_room(self, draft: RoomDraft, room_id: str | None = None) -> RoomDetails:
        async with self._changes:
            existing = self._record(room_id) if room_id is not None else None
            settings = draft.connection.model_copy(deep=True)
            if existing is not None and settings.mode == "client" and settings.editor_url is None and existing.connection.mode == "client":
                settings.editor_url = existing.connection.editor_url
            validate_connection(settings)
            room = existing or SavedRoom(id=str(uuid4()), name=draft.name)
            room = room.model_copy(update={"name": draft.name, "connection": settings, "ai": draft.ai.model_copy(deep=True)})
            self.store.put(room)
            if room.id in self._workflows:
                self._workflows[room.id].relay.ai_settings(room.ai)
            return self.details(room.id)

    async def connect(self, room_id: str) -> RoomDetails:
        async with self._changes:
            room = self._record(room_id)
            validate_connection(room.connection)
            room.last_used_at = datetime.now(UTC)
            self.store.put(room)
            if self.active_room_id != room_id or self._configured.get(room_id) != room.connection:
                previous = self._workflows.get(self.active_room_id or "")
                self.active_room_id = None
                if previous is not None:
                    await previous.stop()
                target = self.workflow(room_id)
                try:
                    target.relay.ai_settings(room.ai)
                    target.relay.display_settings(room.display)
                    target.relay.publication_mode(PublicationMode(auto_publish=room.auto_publish))
                    target.relay.command(Command(command="show" if room.visible else "hide"))
                    await target.configure(room.connection)
                    target.start()
                except BaseException:
                    await target.stop()
                    raise
                self.active_room_id = room_id
                self._configured[room_id] = room.connection.model_copy(deep=True)
            return self.details(room_id)

    async def leave(self, room_id: str, generation: int) -> RoomCatalog:
        async with self._changes:
            target = self.workflow(room_id, generation, active=True)
            self.active_room_id = None
            await target.stop()
            return self.catalog()

    async def reset(self, room_id: str, generation: int) -> RoomDetails:
        async with self._changes:
            target = self.workflow(room_id, generation, active=True)
            room = self._record(room_id)
            room.generation += 1
            self.store.put(room)
            await target.reset_captions()
            return self.details(room_id)

    async def configure(self, room_id: str | None, generation: int | None, settings: ConnectionSettings) -> ConnectionStatus:
        async with self._changes:
            target = self.workflow(room_id, generation, active=True)
            validate_connection(settings)
            room = self._record(room_id or self.active_room_id or "default")
            self.store.put(room.model_copy(update={"connection": settings.model_copy(deep=True)}))
            result = await target.configure(settings)
            self._configured[room.id] = settings.model_copy(deep=True)
            return result

    def set_ai(self, room_id: str | None, generation: int | None, settings: AiSettings) -> AiRouting:
        target = self.workflow(room_id, generation, active=True)
        room = self._record(room_id or self.active_room_id or "default")
        self.store.put(room.model_copy(update={"ai": settings.model_copy(deep=True)}))
        return target.relay.ai_settings(settings)

    def set_display(self, room_id: str | None, generation: int | None, settings: DisplaySettings) -> DisplaySettings:
        target = self.workflow(room_id, generation, active=True)
        room = self._record(room_id or self.active_room_id or "default")
        self.store.put(room.model_copy(update={"display": settings.model_copy(deep=True)}))
        return target.relay.display_settings(settings)

    def command(self, room_id: str | None, generation: int | None, command: Command) -> Visibility:
        target = self.workflow(room_id, generation, active=True)
        room = self._record(room_id or self.active_room_id or "default")
        self.store.put(room.model_copy(update={"visible": command.command == "show"}))
        return target.relay.command(command)

    def publication_mode(self, room_id: str | None, generation: int | None, mode: PublicationMode) -> PublicationMode:
        target = self.workflow(room_id, generation, active=True)
        room = self._record(room_id or self.active_room_id or "default")
        self.store.put(room.model_copy(update={"auto_publish": mode.auto_publish}))
        return target.relay.publication_mode(mode)

    async def patch(self, room_id: str | None, generation: int | None, caption_id: str, patch: CaptionPatch) -> Caption:
        async with self._changes:
            return await self.workflow(room_id, generation, active=True).patch_caption(caption_id, patch)

    async def formatted(self, room_id: str | None, generation: int | None, caption_id: str,
                        result: FormattedResult) -> Caption | SourceIgnored:
        async with self._changes:
            return await self.workflow(room_id, generation, active=True).formatted_result(caption_id, result)
