"""Owns connection lifetimes and the destination of saved corrections."""

import asyncio
from collections.abc import Awaitable, Callable

import httpx2 as httpx

from .models import Caption, ConnectionSettings, ConnectionStatus, SourceEvent, SourceIgnored
from .udtalk_editor import EditorError, UdtalkEditor, decode_editor_url
from .udtalk_web import UdtalkWebInput
from .zoom_input import ZoomInput


class Connections:
    def __init__(self, accept: Callable[[SourceEvent, bool], Caption | SourceIgnored], web_url: str | None,
                 editor_transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._accept = accept
        self._web_url = web_url
        self._editor_transport = editor_transport
        self.mode: str = "host"
        self.receiver = ZoomInput()
        self.web = UdtalkWebInput(web_url, lambda event: accept(event, False))
        self.editor: UdtalkEditor | None = None
        self._status = ConnectionStatus(receiver_path=self.receiver.path)
        self._changes = asyncio.Lock()
        self._running = False

    def start(self) -> None:
        self._running = True
        self.web.start()

    async def stop(self) -> None:
        await self.web.stop()
        if self.editor is not None:
            await self.editor.stop()
        self._running = False

    def status(self) -> ConnectionStatus:
        if self.editor is not None:
            result = self.editor.status.model_copy(deep=True)
            result.zoom_text_format = self.receiver.text_format
            return result
        result = self._status.model_copy(deep=True)
        result.received_events += self.web.status.received_events
        if self.receiver.sequence == 0 and self.web.status.state != "disabled":
            result.state = self.web.status.state
            result.message = "Web字幕の入力：" + self.web.status.message
        return result

    def _receive_editor(self, event: SourceEvent, edited: bool) -> None:
        self._accept(event, edited)

    async def configure(self, settings: ConnectionSettings, before_start: Callable[[], Awaitable[None]]) -> ConnectionStatus:
        # Decode before stopping the working input. Invalid links never change modes.
        info = None
        if settings.mode == "client":
            if not settings.editor_url:
                raise EditorError("UDトークで発行した編集用の参加リンクを入力してください。")
            info = decode_editor_url(settings.editor_url)
        elif settings.editor_url:
            raise EditorError("独立配信では編集用リンクを使いません。")
        async with self._changes:
            if self.mode == "host" and settings.mode == "host":
                self.receiver.text_format = settings.zoom_text_format
                self._status.zoom_text_format = settings.zoom_text_format
                return self.status()
            await self.web.stop()
            if self.editor is not None:
                await self.editor.stop()
                self.editor = None
            await before_start()
            self.mode = settings.mode
            self.receiver = ZoomInput(settings.zoom_text_format)
            if info is not None:
                self.editor = UdtalkEditor(info, self._receive_editor, self._editor_transport)
                self.editor.start()
            else:
                self._status = ConnectionStatus(receiver_path=self.receiver.path,
                                                zoom_text_format=settings.zoom_text_format)
                # A new instance prevents previous Web connection state from leaking across modes.
                self.web = UdtalkWebInput(self._web_url, lambda event: self._accept(event, False))
                if self._running:
                    self.web.start()
            return self.status()

    def receive(self, seq: int, utterance: str, language: str, text: str) -> None:
        if self.mode != "host":
            raise EditorError("独立配信に切り替えてから字幕を送信してください。")
        event = self.receiver.decode(seq, utterance, language, text)
        if event is not None:
            self._accept(event, False)
            self._status.received_events += 1
        self._status.state = "live"
        self._status.message = "UDトークから字幕を受信しています。訂正はこのアプリから配信します。"

    async def write(self, caption_id: str, text: str, validate: Callable[[], None]) -> None:
        async with self._changes:
            validate()
            if self.mode == "client":
                if self.editor is None:
                    raise EditorError("UDトークへの編集参加が設定されていません。")
                try:
                    await self.editor.edit(caption_id, text, validate)
                except httpx.HTTPError:
                    raise EditorError("UDトークへの反映を確認できませんでした。下書きを保持しています。") from None
                except ValueError:
                    raise EditorError("UDトークの応答を確認できませんでした。下書きを保持しています。") from None
