"""Authenticated loopback entry point owned by the desktop application's stdin."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from http.cookies import SimpleCookie, CookieError
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
from urllib.parse import parse_qs

import uvicorn
from starlette.responses import FileResponse, PlainTextResponse, RedirectResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from fastapi import FastAPI
from pydantic import field_validator

from .models import Model

COOKIE = "caption-relay-desktop"


class DesktopStartup(Model):
    environment: dict[str, str]
    data_dir: str

    @field_validator("environment")
    @classmethod
    def credential_names(cls, value: dict[str, str]) -> dict[str, str]:
        allowed = {"OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "CAPTION_RELAY_OPENAI_API_KEY", "CAPTION_RELAY_STT_JPY_PER_USD"}
        if set(value) - allowed:
            raise ValueError("Invalid desktop credential")
        return value


class DesktopBoundary:
    def __init__(self, app: ASGIApp, token: str, port: int) -> None:
        self.app = app
        self.token = token
        self.authority = f"127.0.0.1:{port}"
        self.origin = f"http://{self.authority}"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin1"): value.decode("latin1") for key, value in scope["headers"]}
        path = scope["path"]
        origin = headers.get("origin")
        allowed = headers.get("host") == self.authority and origin in {None, self.origin}
        if allowed and scope["type"] == "http" and path == "/_desktop/start":
            supplied = parse_qs(scope["query_string"].decode("ascii", errors="replace")).get("token", [""])[0]
            if secrets.compare_digest(supplied.encode("utf-8"), self.token.encode("ascii")):
                response = RedirectResponse("/", status_code=303)
                response.set_cookie(COOKIE, self.token, httponly=True, samesite="strict")
                response.headers["Cache-Control"] = "no-store"
                response.headers["Referrer-Policy"] = "no-referrer"
                await response(scope, receive, send)
                return
        cookie = SimpleCookie()
        try:
            cookie.load(headers.get("cookie", ""))
        except CookieError:
            pass
        credential = cookie[COOKIE].value if COOKIE in cookie else ""
        authenticated = secrets.compare_digest(credential.encode("utf-8"), self.token.encode("ascii"))
        # UD Talk already authenticates this narrowly scoped receiver with its own signature.
        receiver = path in {"/closedcaption", "/closedcaption/seq"}
        if not allowed or not (authenticated or receiver):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await PlainTextResponse("Forbidden", status_code=403)(scope, receive, send)
            return
        if scope["type"] == "http" and path == "/desktop/settings":
            from .main import FRONTEND
            await FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store"})(scope, receive, send)
            return
        await self.app(scope, receive, send)


def serve() -> None:
    # No arguments or environment variables containing keys are exposed to process listings.
    startup = DesktopStartup.model_validate_json(sys.stdin.readline(65537))
    for key, value in startup.environment.items():
        os.environ[key] = value
    state = Path(startup.data_dir)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.environ["CAPTION_RELAY_ROOMS_PATH"] = str(state / "rooms.json")
    os.environ["CAPTION_RELAY_DICTIONARY_PATH"] = str(state / "dictionary.json")
    # Retain the existing trial ledger even when the app has its own settings directory.
    os.environ["CAPTION_RELAY_FRONTEND_PATH"] = str(Path(__file__).resolve().parent / "desktop-assets")
    os.environ["CAPTION_RELAY_APPLE_HELPER"] = str(Path(__file__).resolve().parents[1] / "apple-speech-helper")
    from .main import app

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    token = secrets.token_urlsafe(32)
    boundary = DesktopBoundary(app, token, port)
    config = uvicorn.Config(boundary, access_log=False, log_level="warning", ws_max_size=262144,
                            ws_max_queue=8, timeout_graceful_shutdown=5)
    server = uvicorn.Server(config)
    lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def ready(application: FastAPI) -> AsyncGenerator[None]:
        async with lifespan(application):
            print(json.dumps({"port": port, "token": token}), flush=True)
            yield

    app.router.lifespan_context = ready

    def watch_parent() -> None:
        # Closing the pipe, including a crashed parent, always stops the server.
        sys.stdin.read()
        server.should_exit = True

    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()


if __name__ == "__main__":
    serve()
