from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
import os
from datetime import UTC, datetime
from pathlib import Path
from collections.abc import Mapping

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket
from urllib.parse import urlsplit
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import httpx2 as httpx

from .models import (
    AiRouting, AiSettings, Caption, CaptionPatch, Command, ConflictDetail, ConflictResponse, PublicSnapshot,
    ConnectionSettings, ConnectionStatus, DictionaryError, DictionarySnapshot, DictionaryUpdate, DisplaySettings, FormattedResult, PublicationMode, Session, SourceEvent, SourceIgnored, Visibility,
)
from .dictionary import DictionaryConflict, DictionaryStorageError, WordDictionary, dictionary_path
from .relay import CaptionNotFound, CaptionRelay, RevisionConflict
from .udtalk_web import UdtalkStatus
from .udtalk_editor import EditorError
from .workflow import CaptionWorkflow
from .zoom_input import ReceiverError
from .transcription.openai import Connector, openai_connect

BASE = Path(__file__).resolve().parents[2]
FRONTEND = BASE / "frontend" / "dist"


def create_app(relay: CaptionRelay | None = None, *, udtalk_url: str | None = None,
               environment: Mapping[str, str] | None = None,
               ai_transport: httpx.AsyncBaseTransport | None = None,
               editor_transport: httpx.AsyncBaseTransport | None = None, audio_connector: Connector = openai_connect,
               dictionary: WordDictionary | None = None) -> FastAPI:
    service = relay if relay is not None else CaptionRelay()
    workflow = CaptionWorkflow(service, udtalk_url, environment if environment is not None else os.environ,
                               ai_transport, editor_transport, audio_connector, dictionary)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncGenerator[None]:
        workflow.start()
        try:
            yield
        finally:
            await workflow.stop()

    application = FastAPI(title="Caption Relay", version="0.2.0", lifespan=lifespan)

    @application.exception_handler(EditorError)
    async def editor_error(_: Request, error: EditorError) -> PlainTextResponse:
        return PlainTextResponse(str(error), status_code=502)

    application.mount("/static", StaticFiles(directory=FRONTEND, check_dir=False), name="static")

    @application.get("/", response_class=FileResponse)
    async def index() -> FileResponse:
        return FileResponse(FRONTEND / "index.html")

    @application.get("/view/demo", response_class=FileResponse)
    async def view() -> FileResponse:
        return FileResponse(FRONTEND / "view.html")

    @application.get("/api/session", response_model=Session)
    async def session() -> Session:
        return service.session()

    @application.get("/api/events", response_model=list[Caption])
    async def events() -> list[Caption]:
        return service.captions()

    @application.post("/api/source/events", response_model=Caption | SourceIgnored)
    async def source_event(event: SourceEvent) -> Caption | SourceIgnored:
        if workflow.connections.input_source != "udtalk":
            raise HTTPException(409, "マイク以外の入力は停止しています。")
        return workflow.source_event(event)

    @application.get("/api/source/udtalk", response_model=UdtalkStatus)
    async def udtalk_status() -> UdtalkStatus:
        return workflow.connections.web.status.model_copy(deep=True)

    @application.get("/api/connection", response_model=ConnectionStatus)
    async def connection() -> ConnectionStatus:
        return workflow.connections.status()

    @application.put("/api/connection", response_model=ConnectionStatus)
    async def set_connection(settings: ConnectionSettings) -> ConnectionStatus:
        try:
            return await workflow.configure(settings)
        except EditorError as error:
            raise HTTPException(422, str(error)) from None

    @application.websocket("/api/source/audio")
    async def microphone_audio(socket: WebSocket) -> None:
        origin = socket.headers.get("origin")
        parsed = urlsplit(origin or "")
        if (parsed.scheme not in {"http", "https"} or parsed.netloc != socket.headers.get("host")
                or workflow.connections.mode != "host" or workflow.connections.input_source != "microphone"):
            await socket.close(code=1008)
            return
        await socket.accept()
        await workflow.connections.microphone.serve(socket, workflow.connections.recognizer)

    def authorize_receiver(signature: str) -> None:
        if not workflow.connections.receiver.authorized(signature):
            raise HTTPException(403, "invalid receiver token")
        if workflow.connections.mode != "host" or workflow.connections.input_source != "udtalk":
            raise HTTPException(409, "receiver is inactive")

    @application.get("/closedcaption/seq", response_class=PlainTextResponse)
    async def receiver_sequence(signature: str = "") -> str:
        authorize_receiver(signature)
        return str(workflow.connections.receiver.sequence)

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
            authorize_receiver(signature)
            workflow.connections.receive(seq, uttrId, lang, body.decode("utf-8"))
        except (UnicodeDecodeError, ReceiverError) as error:
            raise HTTPException(400, "invalid caption packet") from error
        return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "")

    @application.patch("/api/captions/{caption_id}", response_model=Caption, responses={409: {"model": ConflictResponse}})
    async def patch_caption(caption_id: str, patch: CaptionPatch) -> Caption:
        try:
            return await workflow.patch_caption(caption_id, patch)
        except CaptionNotFound as error:
            raise HTTPException(404, "caption not found") from error
        except RevisionConflict as error:
            detail = ConflictDetail(latest=error.latest)
            raise HTTPException(409, detail=detail.model_dump(mode="json")) from error

    @application.put("/api/captions/{caption_id}/formatted", response_model=Caption | SourceIgnored)
    async def formatted_result(caption_id: str, result: FormattedResult) -> Caption | SourceIgnored:
        try:
            return await workflow.formatted_result(caption_id, result)
        except CaptionNotFound as error:
            raise HTTPException(404, "caption not found") from error

    @application.post("/api/commands", response_model=Visibility)
    async def command(command: Command) -> Visibility:
        return service.command(command)

    @application.put("/api/publication-mode", response_model=PublicationMode)
    async def publication_mode(mode: PublicationMode) -> PublicationMode:
        return service.publication_mode(mode)

    @application.put("/api/display", response_model=DisplaySettings)
    async def display_settings(settings: DisplaySettings) -> DisplaySettings:
        return service.display_settings(settings)

    @application.get("/api/ai", response_model=AiRouting)
    async def ai_routing() -> AiRouting:
        return service.ai_routing()

    @application.put("/api/ai", response_model=AiRouting)
    async def ai_settings(settings: AiSettings) -> AiRouting:
        return service.ai_settings(settings)

    @application.get("/api/dictionary", response_model=DictionarySnapshot)
    async def get_dictionary() -> DictionarySnapshot:
        return workflow.dictionary.snapshot()

    @application.put("/api/dictionary", response_model=DictionarySnapshot,
                     responses={409: {"model": DictionaryError}, 503: {"model": DictionaryError}})
    async def set_dictionary(update: DictionaryUpdate) -> DictionarySnapshot:
        try:
            return workflow.dictionary.update(update)
        except DictionaryConflict as error:
            raise HTTPException(409, str(error)) from None
        except DictionaryStorageError as error:
            raise HTTPException(503, str(error)) from None

    @application.get("/api/view", response_model=PublicSnapshot)
    async def public_view() -> PublicSnapshot:
        return service.public_snapshot()

    @application.get("/api/view/events", response_class=StreamingResponse)
    async def public_events() -> StreamingResponse:
        async def stream() -> AsyncIterator[str]:
            async for snapshot in service.snapshots():
                yield f"event: snapshot\ndata: {snapshot.model_dump_json()}\n\n"
        return StreamingResponse(stream(), media_type="text/event-stream")

    return application


app = create_app(udtalk_url=os.environ.get("CAPTION_RELAY_UDTALK_URL"), dictionary=WordDictionary(dictionary_path(os.environ)))
