"""SpeechAnalyzer results and a supervised, local Swift child process."""

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import platform
import struct
import subprocess
import json

from pydantic import Field, model_validator

from ..models import Model, RecognizerOption, SourceEvent
from .openai import PACKET, TranscriptionError

HELPER = Path(__file__).resolve().parents[3] / ".cache" / "apple-speech-helper"


class AppleResult(Model):
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(ge=0, allow_inf_nan=False)
    text: str = Field(max_length=32768)
    is_final: bool
    finalized_through: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def ordered_range(self) -> "AppleResult":
        if self.end < self.start:
            raise ValueError("invalid audio range")
        return self


@dataclass
class Segment:
    key: str
    start: float
    end: float
    text: str
    revision: int = 0
    final: bool = False

    def event(self, *, removed: bool = False) -> SourceEvent:
        self.revision += 1
        return SourceEvent(utterance_id=self.key, revision=self.revision, text="" if removed else self.text,
                           is_final=False if removed else self.final, removed=removed,
                           source_event_id=f"{self.key}:{self.revision}")


class AppleTranscripts:
    def __init__(self, generation: str) -> None:
        self._prefix = f"mic:apple:{generation}"
        self._segments: dict[tuple[float, float], Segment] = {}
        self._number = 0

    def receive(self, packet: Mapping[str, object]) -> list[SourceEvent]:
        result = AppleResult.model_validate(packet)
        events: list[SourceEvent] = []
        key = (result.start, result.end)
        current = self._segments.get(key)
        # Progressive results extend one utterance before its authoritative final.
        # Update that utterance before applying the finalization boundary.
        if current is None:
            for prior_key, prior in list(self._segments.items()):
                if prior.start == result.start and not prior.final:
                    current = prior
                    del self._segments[prior_key]
                    current.end = result.end
                    self._segments[key] = current
                    break
        if current is not None and current.final:
            return events
        for prior_key, prior in list(self._segments.items()):
            if prior is not current and prior.start < result.end and result.start < prior.end:
                if prior.final:
                    raise TranscriptionError("確定した音声範囲が変更されたため認識を停止しました。")
                events.append(prior.event(removed=True))
                del self._segments[prior_key]
        for segment in self._segments.values():
            if segment is not current and not segment.final and segment.end <= result.finalized_through and segment.text.strip():
                segment.final = True
                events.append(segment.event())
        if current is None:
            if not result.text.strip():
                return events
            self._number += 1
            if self._number > 4096:
                raise TranscriptionError("認識結果が上限を超えたため停止しました。")
            current = Segment(f"{self._prefix}:{self._number}", result.start, result.end, "")
            self._segments[key] = current
        if not result.text.strip():
            events.append(current.event(removed=True))
            del self._segments[key]
            return events
        final = result.is_final or result.end <= result.finalized_through
        if result.text != current.text or final != current.final:
            current.text, current.final = result.text, final
            events.append(current.event())
        return events


@lru_cache(maxsize=2)
def _probe(modified: int) -> bool:
    try:
        result = subprocess.run([str(HELPER), "--probe"], capture_output=True, timeout=5, check=True)
        packet = PACKET.validate_json(result.stdout)
        return packet.get("available") is True and packet.get("japanese_installed") is True
    except (OSError, subprocess.SubprocessError, ValueError):
        return False


def apple_option() -> RecognizerOption:
    message = ""
    if platform.system() != "Darwin":
        message = "Appleの認識は対応するMacで利用できます。"
    elif not HELPER.is_file():
        message = "Appleの認識を使うにはMacの認識部品を準備してください。"
    elif not _probe(HELPER.stat().st_mtime_ns):
        message = "このMacの日本語モデルまたはOSがAppleの認識に対応していません。"
    return RecognizerOption(id="apple", label="Apple（接続先のMacで認識）", available=not message, message=message)


class AppleRecognizer:
    def __init__(self, generation: str, accept: Callable[[SourceEvent], object], *, keywords: list[str] | None = None) -> None:
        self._accept = accept
        self._transcripts = AppleTranscripts(generation)
        self._process: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task[None] | None = None
        self._closing = False
        self.failed = asyncio.Event()
        self.error = ""
        self._keywords = list(keywords or [])

    async def start(self) -> None:
        try:
            self._process = await asyncio.create_subprocess_exec(str(HELPER), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=262144)
            assert self._process.stdin is not None
            config = json.dumps({"keywords": self._keywords}, ensure_ascii=False).encode("utf-8")
            self._process.stdin.write(struct.pack("!I", len(config)) + config)
            await self._process.stdin.drain()
            assert self._process.stdout is not None
            async with asyncio.timeout(10):
                packet = PACKET.validate_json(await self._process.stdout.readline())
            if packet.get("type") != "ready":
                raise TranscriptionError("Appleの音声認識を準備できませんでした。")
            self._reader = asyncio.create_task(self._read())
        except (OSError, ValueError, TimeoutError, TranscriptionError):
            await self.cancel()
            raise TranscriptionError("Appleの音声認識を準備できませんでした。OSと日本語モデルを確認してください。") from None

    async def _read(self) -> None:
        assert self._process is not None and self._process.stdout is not None
        try:
            while raw := await self._process.stdout.readline():
                packet = PACKET.validate_json(raw)
                if packet.pop("type", None) != "result":
                    raise TranscriptionError("Appleの認識を続けられませんでした。")
                for event in self._transcripts.receive(packet):
                    self._accept(event)
            if not self._closing:
                raise TranscriptionError("Appleの認識が終了しました。未確定の字幕を保持しています。")
        except (OSError, ValueError, TranscriptionError) as error:
            self.error = str(error) if isinstance(error, TranscriptionError) else "Appleの認識結果を確認できませんでした。"
            self.failed.set()

    async def push_audio(self, audio: bytes) -> None:
        if self.failed.is_set() or self._process is None or self._process.stdin is None:
            raise TranscriptionError(self.error or "Appleの音声認識が停止しています。")
        self._process.stdin.write(struct.pack("!I", len(audio)) + audio)
        await self._process.stdin.drain()

    async def finish(self) -> None:
        if self._closing:
            return
        self._closing = True
        try:
            if self._process is not None:
                if self._process.stdin is not None:
                    self._process.stdin.close()
                async with asyncio.timeout(8):
                    if self._reader is not None:
                        await self._reader
                    code = await self._process.wait()
                if self.error or code:
                    raise TranscriptionError(self.error or "Appleの認識を終了できませんでした。")
        except TimeoutError:
            raise TranscriptionError("Appleの確定を待つ時間を超えました。未確定の字幕を保持しています。") from None
        finally:
            await self.cancel()

    async def cancel(self) -> None:
        self._closing = True
        if self._reader is not None:
            self._reader.cancel()
            await asyncio.gather(self._reader, return_exceptions=True)
            self._reader = None
        if self._process is not None and self._process.returncode is None:
            self._process.terminate()
            try:
                async with asyncio.timeout(2):
                    await self._process.wait()
            except TimeoutError:
                self._process.kill()
                await self._process.wait()
