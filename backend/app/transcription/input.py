"""One browser microphone lease, shared by recognition providers."""

import asyncio
import anyio
from collections.abc import Callable, Mapping
from pathlib import Path
import struct
from uuid import uuid4

from fastapi import WebSocket
from pydantic import Field
from starlette.websockets import WebSocketDisconnect
from websockets.exceptions import WebSocketException
from typing import Literal

from ..models import Model, RecognizerId, RecognizerOption, SourceEvent, TranscriptionStatus
from .audio import PCMStream
from .budget import TrialBudget
from .openai import Connector, OpenAIRecognizer, TranscriptionError, openai_connect
from .apple import AppleRecognizer, apple_option


class AudioStart(Model):
    type: Literal["start"]
    recognizer: RecognizerId
    sample_rate: int = Field(ge=8000, le=96000)
    channels: Literal[1]
    format: Literal["pcm16"]


class AudioStop(Model):
    type: Literal["stop"]


class MicrophoneInput:
    def __init__(self, environment: Mapping[str, str], accept: Callable[[SourceEvent], object],
                 connector: Connector = openai_connect, *, allowed: Callable[[RecognizerId], bool] = lambda _: True) -> None:
        self._environment = environment
        self._accept = accept
        self._connector = connector
        self._allowed = allowed
        self.status = TranscriptionStatus()
        self._active = False
        self._stop = asyncio.Event()
        self._closed = asyncio.Event()
        self._closed.set()

    def _budget(self) -> TrialBudget:
        try:
            rate = float(self._environment.get("CAPTION_RELAY_STT_JPY_PER_USD", "0"))
        except ValueError:
            raise TranscriptionError("試験費用の円換算を設定してください。") from None
        path = self._environment.get("CAPTION_RELAY_STT_USAGE_PATH")
        return TrialBudget(Path(path) if path else Path.home() / ".cache" / "caption-relay" / "transcription-usage.json",
                           yen_per_usd=rate)

    def options(self) -> list[RecognizerOption]:
        reason = ""
        if not self._environment.get("CAPTION_RELAY_OPENAI_API_KEY"):
            reason = "このリポジトリ用のOpenAIキーが設定されていません。"
        else:
            try:
                usage = self._budget().usage()
                if usage.sent_samples >= TrialBudget.MAX_SAMPLES or usage.estimated_micro_yen >= TrialBudget.MAX_MICRO_YEN:
                    reason = "試験上限に達しています。"
            except TranscriptionError as error:
                reason = str(error)
        return [RecognizerOption(id="openai", label="OpenAI", available=not reason, message=reason), apple_option()]

    async def stop(self) -> None:
        self._stop.set()
        if self._active:
            async with asyncio.timeout(15):
                await self._closed.wait()

    async def serve(self, browser: WebSocket, provider: RecognizerId) -> None:
        if self._active or not self._allowed(provider):
            await browser.send_json({"type": "status", "status": TranscriptionStatus(state="failed",
                message="別のマイクが使用中です。停止してから開始してください。").model_dump()})
            await browser.close(code=1008)
            return
        self._active = True
        self._stop = asyncio.Event()
        self._closed.clear()
        recognizer: OpenAIRecognizer | AppleRecognizer | None = None
        receive: asyncio.Task[Mapping[str, object]] | None = None
        stopping: asyncio.Task[bool] | None = None
        failed: asyncio.Task[bool] | None = None
        async def receive_message() -> Mapping[str, object]:
            return await browser.receive()
        try:
            async with asyncio.timeout(10):
                first = await browser.receive_text()
            if len(first) > 4096:
                raise TranscriptionError("マイクの設定が長すぎます。")
            config = AudioStart.model_validate_json(first)
            if config.recognizer != provider:
                raise TranscriptionError("音声認識の選択が変更されました。接続設定を確認してから開始してください。")
            option = next(item for item in self.options() if item.id == provider)
            if not option.available:
                raise TranscriptionError(option.message)
            budget = self._budget() if provider == "openai" else None
            self.status = TranscriptionStatus(state="preparing", message="音声認識へ接続しています。")
            await self._notify(browser)
            if budget is not None:
                recognizer = OpenAIRecognizer(self._environment["CAPTION_RELAY_OPENAI_API_KEY"], uuid4().hex,
                                               self._accept, budget, connector=self._connector)
            else:
                recognizer = AppleRecognizer(uuid4().hex, self._accept)
            await recognizer.start()
            if self._stop.is_set():
                return
            converter = PCMStream(config.sample_rate)
            self.status.state = "live"
            self.status.message = "マイクの音声を認識しています。"
            await self._notify(browser)
            sequence, offset = 0, 0
            stopping = asyncio.create_task(self._stop.wait())
            failed = asyncio.create_task(recognizer.failed.wait())
            async with asyncio.timeout(20 * 60):
                while True:
                    receive = asyncio.create_task(receive_message())
                    tasks: list[asyncio.Task[object]] = [receive, stopping, failed]
                    ready, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    if failed in ready:
                        raise TranscriptionError(recognizer.error)
                    if stopping in ready:
                        break
                    message = receive.result()
                    if message.get("type") == "websocket.disconnect":
                        return
                    audio = message.get("bytes")
                    if isinstance(audio, bytes):
                        if len(audio) < 10 or len(audio) > config.sample_rate // 5 * 2 + 8 or (len(audio) - 8) % 2:
                            raise TranscriptionError("マイクの音声形式を確認できませんでした。")
                        seq, sample_offset = struct.unpack("!II", audio[:8])
                        if seq != sequence or sample_offset != offset:
                            raise TranscriptionError("音声の一部が欠けたため停止しました。字幕を確認してから再開してください。")
                        sequence += 1
                        offset += (len(audio) - 8) // 2
                        converted = converter.push(audio[8:])
                        if converted:
                            async with asyncio.timeout(3):
                                await recognizer.push_audio(converted)
                        if budget is not None:
                            usage = budget.usage()
                            self.status.sent_seconds = usage.sent_samples / 24000
                            self.status.estimated_yen = usage.estimated_micro_yen / 1_000_000
                    elif isinstance(message.get("text"), str):
                        AudioStop.model_validate_json(str(message["text"]))
                        break
                    else:
                        raise TranscriptionError("マイクの操作を確認できませんでした。")
            remainder = converter.push(b"", last=True)
            if remainder:
                await recognizer.push_audio(remainder)
            await recognizer.finish()
            if budget is not None:
                usage = budget.usage()
                self.status.sent_seconds = usage.sent_samples / 24000
                self.status.estimated_yen = usage.estimated_micro_yen / 1_000_000
            self.status.state = "stopped"
            self.status.message = "マイクの認識を停止しました。"
            await self._notify(browser)
        except WebSocketDisconnect:
            self.status.state = "stopped"
            self.status.message = "マイクの接続が終了しました。未確定の字幕を保持しています。"
        except (TranscriptionError, OSError, WebSocketException, ValueError, TimeoutError) as error:
            self.status.state = "failed"
            self.status.message = str(error) if isinstance(error, TranscriptionError) else "音声認識を停止しました。マイク・通信・設定を確認してください。"
            try:
                await self._notify(browser)
            except (WebSocketDisconnect, RuntimeError, OSError):
                pass
        finally:
            # ASGI cancels disconnected sockets; teardown must still close the
            # paid connection/child and release the lease before reconfiguration.
            with anyio.CancelScope(shield=True):
                try:
                    cleanup: list[asyncio.Task[object]] = [task for task in [receive, stopping, failed] if task is not None]
                    for task in cleanup:
                        task.cancel()
                    await asyncio.gather(*cleanup, return_exceptions=True)
                    if recognizer is not None:
                        await recognizer.cancel()
                    if self.status.state in {"preparing", "live"}:
                        self.status.state = "stopped"
                        self.status.message = "マイクの接続が終了しました。未確定の字幕を保持しています。"
                    try:
                        await browser.close()
                    except (WebSocketDisconnect, RuntimeError, OSError):
                        pass
                finally:
                    self._active = False
                    self._closed.set()

    async def _notify(self, browser: WebSocket) -> None:
        await browser.send_json({"type": "status", "status": self.status.model_dump()})
