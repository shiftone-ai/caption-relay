"""Opt-in reader for the observed official UDトーク Web viewer protocol."""

import asyncio
import logging
import re
from collections.abc import Callable
from html.parser import HTMLParser
from typing import Literal

import httpx2 as httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .models import Caption, Model, SourceEvent, SourceIgnored
from .udtalk import UdtalkDecoder, UdtalkProtocolError, WebMessage

LOGGER = logging.getLogger("uvicorn.error")
API = "https://app.udtalk.jp/"


class UdtalkStatus(Model):
    state: Literal["disabled", "connecting", "live", "retrying", "failed"] = "disabled"
    received_events: int = 0
    message: str = "UDトーク接続は設定されていません。"


class WebResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    status: int


class AuthResponse(WebResponse):
    requires: bool


class InitializeResponse(WebResponse):
    userid: int | str


class KeyResponse(WebResponse):
    key: str = Field(min_length=1)


class CurrentResponse(WebResponse):
    number: int = Field(ge=0)
    current: int = Field(ge=0)


class MessagesResponse(CurrentResponse):
    messages: list[list[WebMessage]] | None = None


class TokenParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.token: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "udtalk":
            value = dict(attrs).get("v-bind:token-txt")
            if value is not None:
                self.token = PageToken.model_validate_json(value).hash


class PageToken(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    hash: str = Field(min_length=1)


class UdtalkWebInput:
    def __init__(
        self, url: str | None, accept: Callable[[SourceEvent], Caption | SourceIgnored],
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.status = UdtalkStatus()
        self._url = url
        self._accept = accept
        self._transport = transport
        self._task: asyncio.Task[None] | None = None
        self._session: dict[str, str | int] = {}
        self._path = ""

    def start(self) -> None:
        if not self._url:
            return
        if re.fullmatch(r"https://live\.udtalk\.jp/[0-9a-z]{64}", self._url) is None:
            raise ValueError("CAPTION_RELAY_UDTALK_URL must be an official Web viewing link")
        self._path = self._url.rsplit("/", 1)[1]
        self.status = UdtalkStatus(state="connecting", message="UDトークへ接続しています。")
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _post(self, client: httpx.AsyncClient, route: str, body: dict[str, str | int]) -> httpx.Response:
        response = await client.post(API + route + self._path, json=body)
        response.raise_for_status()
        code = WebResponse.model_validate_json(response.content).status
        if code not in (1, 5):
            raise UdtalkProtocolError("UDTalk talk is unavailable or authorization expired")
        return response

    async def _connect(self, client: httpx.AsyncClient) -> CurrentResponse:
        assert self._url is not None
        # Resume a partially initialized reader after a temporary failure,
        # rather than creating another viewer participant on every attempt.
        if not self._session:
            page = await client.get(self._url)
            page.raise_for_status()
            parser = TokenParser()
            parser.feed(page.text)
            if parser.token is None:
                raise UdtalkProtocolError("UDTalk viewing page format is unsupported")
            auth = AuthResponse.model_validate_json((await self._post(
                client, "web/pull/checkAuth/", {"t": self._path},
            )).content)
            if auth.requires:
                raise UdtalkProtocolError("UDTalk passcode-protected talks are unsupported")
            initial = InitializeResponse.model_validate_json((await self._post(
                client, "web/push/initialize/", {"t": parser.token},
            )).content)
            self._session = {"t": parser.token, "u": initial.userid}
        if "k" not in self._session:
            key = KeyResponse.model_validate_json((await self._post(
                client, "web/pull/webTalk/", self._session,
            )).content)
            self._session["k"] = key.key
        await self._post(client, "web/push/signWebTalk/", self._session)
        return CurrentResponse.model_validate_json((await self._post(
            client, "web/pull/webTalkCurrent/", self._session,
        )).content)

    async def _run(self) -> None:
        decoder = UdtalkDecoder(self._path)
        cursor: CurrentResponse | None = None
        backoff = 1
        async with httpx.AsyncClient(transport=self._transport, timeout=15, follow_redirects=False) as client:
            try:
                while True:
                    try:
                        if cursor is None:
                            cursor = await self._connect(client)
                            LOGGER.info("UDTalk Web input connected; reading new speech only")
                        response = await self._post(client, "web/pull/webTalkMessage/", {
                            **self._session, "l": cursor.number, "c": cursor.current,
                        })
                        # No-message responses can omit cursors. Keep the last
                        # acknowledged cursor until a complete batch is accepted.
                        if WebResponse.model_validate_json(response.content).status == 1:
                            batch = MessagesResponse.model_validate_json(response.content)
                            if batch.number < cursor.number or batch.current < cursor.current:
                                raise UdtalkProtocolError("UDTalk cursor reset; restart with a new test talk")
                            if batch.messages is not None:
                                if len(batch.messages) != 1:
                                    raise UdtalkProtocolError("UDTalk message batch format is unsupported")
                                for event in decoder.decode(batch.messages[0]):
                                    self._accept(event)
                                    self.status.received_events += 1
                                cursor = batch
                        self.status.state = "live"
                        self.status.message = "UDトークの受信接続が動作しています。"
                        backoff = 1
                        await asyncio.sleep(1)
                    except (httpx.TransportError, httpx.HTTPStatusError) as error:
                        if isinstance(error, httpx.HTTPStatusError) and error.response.status_code not in (408, 429, 500, 502, 503, 504):
                            raise UdtalkProtocolError("UDTalk HTTP connection was rejected") from None
                        self.status.state = "retrying"
                        self.status.message = "UDトークとの通信を再試行しています。"
                        LOGGER.warning("UDTalk Web input interrupted; retrying with retained cursor")
                        await asyncio.sleep(backoff)
                        backoff = min(backoff * 2, 15)
            except (UdtalkProtocolError, ValidationError, ValueError) as error:
                self.status.state = "failed"
                self.status.message = "UDトークの受信を停止しました。公開状態と接続仕様を確認してください。"
                # Validation/HTTP exception strings may contain text, tokens or
                # private URLs. Log only our controlled protocol messages.
                reason = str(error) if isinstance(error, UdtalkProtocolError) else "UDTalk response format is invalid"
                LOGGER.error("UDTalk Web input stopped: %s", reason)
            finally:
                if "k" in self._session:
                    try:
                        await client.post(API + "web/push/awayWebTalk/" + self._path, json=self._session, timeout=2)
                    except httpx.HTTPError:
                        LOGGER.warning("UDTalk Web reader departure could not be confirmed")
