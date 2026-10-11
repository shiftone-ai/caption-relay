"""Normalize OpenAI Realtime transcription without changing publication rules."""

from dataclasses import dataclass
from collections.abc import Mapping
from typing import TYPE_CHECKING, Protocol
from collections.abc import Awaitable, Callable
import asyncio
import base64
import json

from pydantic import TypeAdapter
from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

if TYPE_CHECKING:
    from .audio import VoiceDetector
    from .budget import TrialBudget

from ..models import SourceEvent


class TranscriptionError(Exception):
    """A safe, user-facing message; never include provider payloads or credentials."""


@dataclass
class Turn:
    number: int
    text: str = ""
    revision: int = 0
    final: bool = False
    dirty: bool = False


class OpenAITranscripts:
    def __init__(self, generation: str) -> None:
        self._prefix = f"mic:openai:{generation}"
        self._turns: dict[str, Turn] = {}
        self._seen: set[str] = set()

    def receive(self, packet: Mapping[str, object]) -> list[SourceEvent]:
        kind = packet.get("type")
        if kind == "input_audio_buffer.committed":
            previous = packet.get("previous_item_id")
            if isinstance(previous, str):
                self._turns.setdefault(previous, Turn(len(self._turns) + 1))
            identity = packet.get("item_id")
            if isinstance(identity, str):
                self._turns.setdefault(identity, Turn(len(self._turns) + 1))
            return []
        if not isinstance(kind, str) or kind not in {"conversation.item.input_audio_transcription.delta",
                        "conversation.item.input_audio_transcription.completed"}:
            return []
        identity = packet.get("item_id")
        text = packet.get("transcript" if kind.endswith("completed") else "delta")
        if not isinstance(identity, str) or not identity or not isinstance(text, str):
            raise TranscriptionError("認識結果の形式を確認できませんでした。")
        event_id = packet.get("event_id")
        if isinstance(event_id, str):
            if event_id in self._seen:
                return []
            self._seen.add(event_id)
        turn = self._turns.setdefault(identity, Turn(len(self._turns) + 1))
        if turn.final:
            return []
        final = kind.endswith("completed")
        updated = text if final else turn.text + text
        if not updated.strip():
            if final:
                raise TranscriptionError("空の認識結果が返りました。未確定の字幕を保持しています。")
            return []
        if len(updated) > 32768 or len(self._turns) > 4096 or len(self._seen) > 100000:
            raise TranscriptionError("認識結果が上限を超えたため停止しました。")
        if updated == turn.text and not final:
            return []
        turn.text, turn.final = updated, final
        turn.dirty = True
        events: list[SourceEvent] = []
        # Reserve order at commit, but never create empty caption rows.
        for pending in self._turns.values():
            if not pending.text.strip():
                break
            if pending.dirty:
                pending.revision += 1
                pending.dirty = False
                caption_id = f"{self._prefix}:{pending.number}"
                events.append(SourceEvent(utterance_id=caption_id, revision=pending.revision,
                                          text=pending.text, is_final=pending.final,
                                          source_event_id=f"{caption_id}:{pending.revision}"))
        return events


class RealtimeSocket(Protocol):
    async def send(self, message: str) -> None: ...
    async def recv(self) -> str | bytes: ...
    async def close(self) -> None: ...


Connector = Callable[[str], Awaitable[RealtimeSocket]]
PACKET = TypeAdapter(dict[str, object])


async def openai_connect(key: str) -> RealtimeSocket:
    # Realtime transcription endpoint, also used by OpenAI's connect_transcription helper.
    return await connect("wss://api.openai.com/v1/realtime?intent=transcription",
                         additional_headers={"Authorization": f"Bearer {key}"},
                         max_size=262144, max_queue=16, open_timeout=10, close_timeout=2)


class OpenAIRecognizer:
    def __init__(self, key: str, generation: str, accept: Callable[[SourceEvent], object], budget: "TrialBudget",
                 *, connector: Connector = openai_connect, detector: "VoiceDetector | None" = None) -> None:
        from .audio import SpeechTurns
        self._key, self._connector, self._budget = key, connector, budget
        self._accept = accept
        self._transcripts = OpenAITranscripts(generation)
        self._turns = SpeechTurns(detector)
        self._socket: RealtimeSocket | None = None
        self._reader: asyncio.Task[None] | None = None
        self._pending = 0
        self._completed: set[str] = set()
        self._done = asyncio.Event()
        self._done.set()
        self.failed = asyncio.Event()
        self.error = ""
        self._closing = False

    async def start(self) -> None:
        try:
            async with asyncio.timeout(10):
                self._socket = await self._connector(self._key)
                await self._send({"type": "session.update", "session": {"type": "transcription", "audio": {"input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "transcription": {"model": "gpt-live-transcribe", "languages": ["ja"], "delay": "low"},
                    "turn_detection": None,
                }}}})
                for _ in range(32):
                    packet = await self._receive()
                    if packet.get("type") == "session.updated":
                        self._reader = asyncio.create_task(self._read())
                        return
            raise TranscriptionError("音声認識の設定を確認できませんでした。")
        except (OSError, WebSocketException, TimeoutError, ValueError):
            await self.cancel()
            raise TranscriptionError("OpenAIへ接続できませんでした。キーと利用枠を確認してください。") from None
        except TranscriptionError:
            await self.cancel()
            raise

    async def _send(self, packet: dict[str, object]) -> None:
        if self._socket is None:
            raise TranscriptionError("音声認識の接続が終了しています。")
        await self._socket.send(json.dumps(packet, ensure_ascii=False))

    async def _receive(self) -> dict[str, object]:
        assert self._socket is not None
        packet = PACKET.validate_json(await self._socket.recv())
        if packet.get("type") in {"error", "conversation.item.input_audio_transcription.failed"}:
            raise TranscriptionError("OpenAIの認識を続けられませんでした。キー・利用枠・音声設定を確認してください。")
        return packet

    async def _read(self) -> None:
        try:
            while not self._closing:
                packet = await self._receive()
                for event in self._transcripts.receive(packet):
                    self._accept(event)
                identity = packet.get("item_id")
                if packet.get("type") == "conversation.item.input_audio_transcription.completed" and isinstance(identity, str):
                    if identity not in self._completed:
                        self._completed.add(identity)
                        self._pending = max(0, self._pending - 1)
                        if self._pending == 0:
                            self._done.set()
        except (OSError, WebSocketException, ValueError, TranscriptionError) as error:
            if not self._closing:
                self.error = str(error) if isinstance(error, TranscriptionError) else "接続が切れました。未確定の字幕を保持しています。"
                self.failed.set()
                self._done.set()

    async def _commit(self) -> None:
        self._pending += 1
        self._done.clear()
        await self._send({"type": "input_audio_buffer.commit"})
        self._turns.reset()

    async def push_audio(self, audio: bytes) -> None:
        if self._closing or self.failed.is_set():
            raise TranscriptionError(self.error or "音声認識の接続が終了しています。")
        if not audio or len(audio) % 2:
            raise TranscriptionError("送信音声の形式を確認できませんでした。")
        self._budget.reserve(len(audio) // 2)
        await self._send({"type": "input_audio_buffer.append", "audio": base64.b64encode(audio).decode("ascii")})
        if self._turns.push(audio):
            await self._commit()
        elif not self._turns.voiced and self._turns.samples >= 48000:
            await self._send({"type": "input_audio_buffer.clear"})
            self._turns.reset()

    async def finish(self) -> None:
        if self._closing:
            return
        try:
            if not self.failed.is_set() and self._turns.finish():
                await self._commit()
            async with asyncio.timeout(5):
                await self._done.wait()
            if self.error:
                raise TranscriptionError(self.error)
        except TimeoutError:
            raise TranscriptionError("確定結果を待つ時間を超えました。未確定の字幕を保持しています。") from None
        finally:
            await self.cancel()

    async def cancel(self) -> None:
        self._closing = True
        if self._reader is not None:
            self._reader.cancel()
            await asyncio.gather(self._reader, return_exceptions=True)
            self._reader = None
        if self._socket is not None:
            await self._socket.close()
            self._socket = None
