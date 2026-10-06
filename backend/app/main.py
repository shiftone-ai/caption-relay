from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .models import (
    AiRouting, AiSettings, Caption, CaptionPatch, Command, ConflictDetail, ConflictResponse, PublicSnapshot,
    DisplaySettings, FormattedResult, PublicationMode, Session, SourceEvent, SourceIgnored, Visibility,
)
from .relay import CaptionNotFound, CaptionRelay, RevisionConflict

BASE = Path(__file__).resolve().parents[2]
FRONTEND = BASE / "frontend" / "dist"


def create_app(relay: CaptionRelay | None = None) -> FastAPI:
    service = relay if relay is not None else CaptionRelay()
    application = FastAPI(title="Caption Relay", version="0.2.0")
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
        return service.source_event(event)

    @application.patch("/api/captions/{caption_id}", response_model=Caption, responses={409: {"model": ConflictResponse}})
    async def patch_caption(caption_id: str, patch: CaptionPatch) -> Caption:
        try:
            return service.patch_caption(caption_id, patch)
        except CaptionNotFound as error:
            raise HTTPException(404, "caption not found") from error
        except RevisionConflict as error:
            detail = ConflictDetail(latest=error.latest)
            raise HTTPException(409, detail=detail.model_dump(mode="json")) from error

    @application.put("/api/captions/{caption_id}/formatted", response_model=Caption | SourceIgnored)
    async def formatted_result(caption_id: str, result: FormattedResult) -> Caption | SourceIgnored:
        try:
            return service.formatted_result(caption_id, result)
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


app = create_app()
