from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
import os
from datetime import UTC, datetime
from pathlib import Path
from collections.abc import Mapping
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket
from urllib.parse import urlsplit
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx2 as httpx

from .models import (
    AiRouting, AiSettings, Caption, CaptionPatch, Command, ConflictDetail, ConflictResponse, PublicSnapshot,
    ConnectionSettings, ConnectionStatus, DictionaryError, DictionarySnapshot, DictionaryUpdate, DisplaySettings, FormattedResult, PublicationMode, Session, SourceEvent, SourceIgnored, Visibility,
)
from .dictionary import DictionaryConflict, DictionaryStorageError, WordDictionary, dictionary_path
from .relay import CaptionNotFound, CaptionRelay, InvalidCaptionOperation, RevisionConflict
from .udtalk_web import UdtalkStatus
from .udtalk_editor import EditorError
from .workflow import CaptionWorkflow
from .rooms import RoomConflict, RoomNotFound, Rooms
from .room_models import RoomCatalog, RoomDetails, RoomDraft, RoomReset, RoomStateError
from .room_scope import RoomScope, room_scope
from .room_store import RoomStorageError, RoomStore, rooms_path
from .zoom_input import ReceiverError
from .transcription.openai import Connector, openai_connect

BASE = Path(__file__).resolve().parents[2]
FRONTEND = BASE / "frontend" / "dist"


def create_app(relay: CaptionRelay | None = None, *, udtalk_url: str | None = None,
               environment: Mapping[str, str] | None = None,
               ai_transport: httpx.AsyncBaseTransport | None = None,
               editor_transport: httpx.AsyncBaseTransport | None = None, audio_connector: Connector = openai_connect,
               dictionary: WordDictionary | None = None, room_store: RoomStore | None = None) -> FastAPI:
    service = relay if relay is not None else CaptionRelay()
    workflow = CaptionWorkflow(service, udtalk_url, environment if environment is not None else os.environ,
                               ai_transport, editor_transport, audio_connector, dictionary)
    def new_workflow() -> CaptionWorkflow:
        return CaptionWorkflow(CaptionRelay(), None, environment if environment is not None else os.environ,
                               ai_transport, editor_transport, audio_connector, workflow.dictionary)
    rooms = Rooms(workflow, new_workflow, room_store if room_store is not None else RoomStore())

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        rooms.start()
        try:
            yield
        finally:
            await rooms.stop()

    application = FastAPI(title="Caption Relay", version="0.2.0", lifespan=lifespan,
                          responses={409: {"model": RoomStateError}, 404: {"model": RoomStateError}})

    @application.exception_handler(RoomNotFound)
    async def room_not_found(_: Request, error: RoomNotFound) -> JSONResponse:
        return JSONResponse({"detail": str(error), "code": "room_missing"}, status_code=404)

    @application.exception_handler(RoomConflict)
    async def room_conflict(_: Request, error: RoomConflict) -> JSONResponse:
        return JSONResponse({"detail": str(error), "code": error.code}, status_code=409)

    @application.exception_handler(InvalidCaptionOperation)
    async def invalid_caption_operation(_: Request, error: InvalidCaptionOperation) -> JSONResponse:
        return JSONResponse({"detail": str(error)}, status_code=409)

    @application.exception_handler(RoomStorageError)
    async def room_storage_error(_: Request, error: RoomStorageError) -> JSONResponse:
        return JSONResponse({"detail": str(error)}, status_code=503)

    @application.exception_handler(EditorError)
    async def editor_error(_: Request, error: EditorError) -> PlainTextResponse:
        return PlainTextResponse(str(error), status_code=502)

    application.mount("/static", StaticFiles(directory=FRONTEND, check_dir=False), name="static")

    @application.get("/", response_class=FileResponse)
    async def index() -> FileResponse:
        return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})

    @application.get("/rooms/{room_id}", response_class=FileResponse)
    async def room_index(room_id: str) -> FileResponse:
        return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})

    @application.get("/api/rooms", response_model=RoomCatalog)
    async def room_catalog() -> RoomCatalog:
        return rooms.catalog()

    @application.post("/api/rooms", response_model=RoomDetails, status_code=201)
    async def add_room(draft: RoomDraft) -> RoomDetails:
        try:
            return await rooms.save_room(draft)
        except EditorError as error:
            raise HTTPException(422, str(error)) from None

    @application.get("/api/rooms/{room_id}", response_model=RoomDetails)
    async def room_details(room_id: str) -> RoomDetails:
        return rooms.details(room_id)

    @application.put("/api/rooms/{room_id}", response_model=RoomDetails)
    async def update_room(room_id: str, draft: RoomDraft) -> RoomDetails:
        try:
            return await rooms.save_room(draft, room_id)
        except EditorError as error:
            raise HTTPException(422, str(error)) from None

    @application.delete("/api/rooms/{room_id}", response_model=RoomCatalog)
    async def delete_room(room_id: str, generation: Annotated[int, Query(ge=0)]) -> RoomCatalog:
        return await rooms.delete(room_id, generation)

    @application.post("/api/rooms/{room_id}/connect", response_model=RoomDetails)
    async def connect_room(room_id: str) -> RoomDetails:
        try:
            return await rooms.connect(room_id)
        except EditorError as error:
            raise HTTPException(422, str(error)) from None

    @application.post("/api/rooms/{room_id}/leave", response_model=RoomCatalog)
    async def leave_room(room_id: str, operation: RoomReset) -> RoomCatalog:
        return await rooms.leave(room_id, operation.generation)

    @application.post("/api/rooms/{room_id}/reset", response_model=RoomDetails)
    async def reset_room(room_id: str, operation: RoomReset) -> RoomDetails:
        return await rooms.reset(room_id, operation.generation)

    @application.get("/view/demo", response_class=FileResponse)
    async def view() -> FileResponse:
        return FileResponse(FRONTEND / "view.html", headers={"Cache-Control": "no-cache"})

    @application.get("/api/session", response_model=Session)
    async def session(scope: Annotated[RoomScope, Depends(room_scope)]) -> Session:
        return rooms.workflow(scope.room_id, scope.generation, active=scope.room_id is not None).relay.session()

    @application.get("/api/events", response_model=list[Caption])
    async def events(scope: Annotated[RoomScope, Depends(room_scope)]) -> list[Caption]:
        return rooms.workflow(scope.room_id, scope.generation).relay.captions()

    @application.post("/api/source/events", response_model=Caption | SourceIgnored)
    async def source_event(event: SourceEvent, scope: Annotated[RoomScope, Depends(room_scope)]) -> Caption | SourceIgnored:
        target = rooms.workflow(scope.room_id, scope.generation, active=True)
        if target.connections.input_source != "udtalk":
            raise HTTPException(409, "マイク以外の入力は停止しています。")
        return target.source_event(event)

    @application.get("/api/source/udtalk", response_model=UdtalkStatus)
    async def udtalk_status(scope: Annotated[RoomScope, Depends(room_scope)]) -> UdtalkStatus:
        return rooms.workflow(scope.room_id, scope.generation).connections.web.status.model_copy(deep=True)

    @application.get("/api/connection", response_model=ConnectionStatus)
    async def connection(scope: Annotated[RoomScope, Depends(room_scope)]) -> ConnectionStatus:
        return rooms.workflow(scope.room_id, scope.generation).connections.status()

    @application.put("/api/connection", response_model=ConnectionStatus)
    async def set_connection(settings: ConnectionSettings, scope: Annotated[RoomScope, Depends(room_scope)]) -> ConnectionStatus:
        try:
            return await rooms.configure(scope.room_id, scope.generation, settings)
        except EditorError as error:
            raise HTTPException(422, str(error)) from None

    @application.websocket("/api/source/audio")
    async def microphone_audio(socket: WebSocket, room_id: str | None = None, generation: int | None = None) -> None:
        try:
            target = rooms.workflow(room_id, generation, active=True)
        except (RoomConflict, RoomNotFound):
            await socket.close(code=1008)
            return
        origin = socket.headers.get("origin")
        parsed = urlsplit(origin or "")
        if (parsed.scheme not in {"http", "https"} or parsed.netloc != socket.headers.get("host")
                or target.connections.mode != "host" or target.connections.input_source != "microphone"):
            await socket.close(code=1008)
            return
        await socket.accept()
        await target.connections.microphone.serve(socket, target.connections.recognizer)

    def authorize_receiver(signature: str) -> CaptionWorkflow:
        target = rooms.workflow(active=True)
        if not target.connections.receiver.authorized(signature):
            raise HTTPException(403, "invalid receiver token")
        if target.connections.mode != "host" or target.connections.input_source != "udtalk":
            raise HTTPException(409, "receiver is inactive")
        return target

    @application.get("/closedcaption/seq", response_class=PlainTextResponse)
    async def receiver_sequence(signature: str = "") -> str:
        target = authorize_receiver(signature)
        return str(target.connections.receiver.sequence)

    @application.post("/closedcaption", response_class=PlainTextResponse)
    async def receive_caption(request: Request, seq: int = Query(ge=1), uttrId: str = Query(min_length=1, max_length=256),
                              signature: str = "", lang: str = "ja-JP") -> str:
        authorize_receiver(signature)
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "text/plain":
            raise HTTPException(415, "UTF-8 plain text required")
        body = bytearray()
        async for part in request.stream():
            body.extend(part)
            if len(body) > 65536:
                raise HTTPException(413, "caption too large")
        try:
            # Reading a streamed body can span a connection change.
            target = authorize_receiver(signature)
            target.connections.receive(seq, uttrId, lang, body.decode("utf-8"))
        except (UnicodeDecodeError, ReceiverError) as error:
            raise HTTPException(400, "invalid caption packet") from error
        return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "")

    @application.patch("/api/captions/{caption_id}", response_model=Caption, responses={409: {"model": ConflictResponse}})
    async def patch_caption(caption_id: str, patch: CaptionPatch, scope: Annotated[RoomScope, Depends(room_scope)]) -> Caption:
        try:
            return await rooms.patch(scope.room_id, scope.generation, caption_id, patch)
        except CaptionNotFound as error:
            raise HTTPException(404, "caption not found") from error
        except RevisionConflict as error:
            detail = ConflictDetail(latest=error.latest)
            raise HTTPException(409, detail=detail.model_dump(mode="json")) from error

    @application.put("/api/captions/{caption_id}/formatted", response_model=Caption | SourceIgnored)
    async def formatted_result(caption_id: str, result: FormattedResult, scope: Annotated[RoomScope, Depends(room_scope)]) -> Caption | SourceIgnored:
        try:
            return await rooms.formatted(scope.room_id, scope.generation, caption_id, result)
        except CaptionNotFound as error:
            raise HTTPException(404, "caption not found") from error

    @application.post("/api/commands", response_model=Visibility)
    async def command(command: Command, scope: Annotated[RoomScope, Depends(room_scope)]) -> Visibility:
        return rooms.command(scope.room_id, scope.generation, command)

    @application.put("/api/publication-mode", response_model=PublicationMode)
    async def publication_mode(mode: PublicationMode, scope: Annotated[RoomScope, Depends(room_scope)]) -> PublicationMode:
        return rooms.publication_mode(scope.room_id, scope.generation, mode)

    @application.put("/api/display", response_model=DisplaySettings)
    async def display_settings(settings: DisplaySettings, scope: Annotated[RoomScope, Depends(room_scope)]) -> DisplaySettings:
        return rooms.set_display(scope.room_id, scope.generation, settings)

    @application.get("/api/ai", response_model=AiRouting)
    async def ai_routing(scope: Annotated[RoomScope, Depends(room_scope)]) -> AiRouting:
        return rooms.workflow(scope.room_id, scope.generation).relay.ai_routing()

    @application.put("/api/ai", response_model=AiRouting)
    async def ai_settings(settings: AiSettings, scope: Annotated[RoomScope, Depends(room_scope)]) -> AiRouting:
        return rooms.set_ai(scope.room_id, scope.generation, settings)

    @application.get("/api/dictionary", response_model=DictionarySnapshot)
    async def get_dictionary(scope: Annotated[RoomScope, Depends(room_scope)]) -> DictionarySnapshot:
        return rooms.workflow(scope.room_id, scope.generation).dictionary.snapshot()

    @application.put("/api/dictionary", response_model=DictionarySnapshot,
                     responses={409: {"model": DictionaryError}, 503: {"model": DictionaryError}})
    async def set_dictionary(update: DictionaryUpdate, scope: Annotated[RoomScope, Depends(room_scope)]) -> DictionarySnapshot:
        try:
            return rooms.workflow(scope.room_id, scope.generation, active=True).dictionary.update(update)
        except DictionaryConflict as error:
            raise HTTPException(409, str(error)) from None
        except DictionaryStorageError as error:
            raise HTTPException(503, str(error)) from None

    @application.get("/api/view", response_model=PublicSnapshot)
    async def public_view(room_id: str | None = None) -> PublicSnapshot:
        return rooms.workflow(room_id).relay.public_snapshot()

    @application.get("/api/view/events", response_class=StreamingResponse)
    async def public_events(room_id: str | None = None) -> StreamingResponse:
        target = rooms.workflow(room_id)
        async def stream() -> AsyncIterator[str]:
            async for snapshot in target.relay.snapshots():
                yield f"event: snapshot\ndata: {snapshot.model_dump_json()}\n\n"
        return StreamingResponse(stream(), media_type="text/event-stream")

    return application


app = create_app(udtalk_url=os.environ.get("CAPTION_RELAY_UDTALK_URL"), dictionary=WordDictionary(dictionary_path(os.environ)),
                 room_store=RoomStore(rooms_path(os.environ)))
