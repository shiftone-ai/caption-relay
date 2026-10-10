"""Experimental editor participant using the observed native Windows protocol.

This adapter is not a vendor-supported API. Never rewrite sharing permissions.
"""

import asyncio
import base64
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass, field
from hashlib import sha256
import json
import math
from time import time
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import httpx2 as httpx
from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter

from .models import ConnectionStatus, SourceEvent
from .udtalk import Fragment, UdtalkProtocolError, WebMessage, speaker_from_fragments

API = "https://app.udtalk.jp"
JSON_OBJECT = TypeAdapter(dict[str, JsonValue])


class EditorError(Exception):
    """Safe to display; never include private links or server response bodies."""


@dataclass(frozen=True)
class SharingInfo:
    talk_id: str
    entry_key: str
    expires_at: float

    def validate_permission(self) -> None:
        if self.expires_at <= time():
            raise EditorError("編集用リンクの期限が切れています。UDトークで発行し直してください。")


def decode_editor_url(url: str) -> SharingInfo:
    try:
        parsed = urlsplit(url.strip())
        if not (parsed.scheme == "udtalk" or (
            parsed.scheme == "https" and parsed.hostname in {"service.udtalk.jp", "udtalk.jp", "app.udtalk.jp"}
        )) or parsed.username or parsed.password:
            raise ValueError()
        tokens = [unquote(part.partition("=")[2]) for part in parsed.query.split("&")
                  if part.partition("=")[0] == "token"]
        if len(tokens) != 1:
            raise ValueError()
        encrypted = base64.b64decode(tokens[0], validate=True)
        decryptor = Cipher(algorithms.AES(b"udtalk".ljust(32, b"\0")), modes.CBC(bytes(16))).decryptor()
        padded = decryptor.update(encrypted) + decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        payload = JSON_OBJECT.validate_json(unpadder.update(padded) + unpadder.finalize())
        read_only = payload.get("readOnly")
        if read_only not in (0, "0", False):
            raise EditorError("閲覧用リンクでは訂正できません。編集を許可した参加用リンクを使ってください。")
        talk, key, expiry = payload.get("talkId"), payload.get("entryKey"), payload.get("sharingLimit")
        if not isinstance(talk, str) or not talk or not isinstance(key, str) or not key:
            raise ValueError()
        if not isinstance(expiry, (str, int, float)) or isinstance(expiry, bool):
            raise ValueError()
        expires_at = float(expiry)
        if not math.isfinite(expires_at):
            raise ValueError()
        info = SharingInfo(talk, key, expires_at)
        info.validate_permission()
        return info
    except (ValueError, TypeError, KeyError):
        raise EditorError("編集用リンクを読み取れません。UDトークの参加用リンクを確認してください。") from None


class NativeResponse(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    status: int
    number: int | None = Field(default=None, ge=0)
    current: int | None = Field(default=None, ge=0)
    users: dict[str, JsonValue] | None = None
    messages: list[list[WebMessage]] | None = None
    options: list[list[WebMessage]] | None = None
    result: bool | None = None


@dataclass
class NativeUtterance:
    fragments: dict[int, dict[str, JsonValue]] = field(default_factory=lambda: {})
    revision: int = 0
    content: tuple[str, bool, bool, str | None] | None = None


class UdtalkEditor:
    def __init__(self, info: SharingInfo, accept: Callable[[SourceEvent, bool], None],
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.info = info
        self.status = ConnectionStatus(mode="client", state="connecting", editor_configured=True,
                                       message="UDトークへ編集参加しています。")
        self._accept = accept
        self._client = httpx.AsyncClient(transport=transport, timeout=15, follow_redirects=False)
        self._task: asyncio.Task[None] | None = None
        self._io = asyncio.Lock()
        self._user: str | None = None
        self._device = str(uuid4())
        self._cursor: tuple[int, int] | None = None
        self._push_cursor: tuple[int, int] = (-1, -1)
        self._utterances: dict[str, NativeUtterance] = {}
        self._roots: dict[str, str] = {}

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self._user is not None:
            try:
                await self._client.post(API + "/push/awayTalk/",
                    json={"u": self._user, "t": self.info.talk_id, "v": "0.0.1"}, timeout=2)
            except httpx.HTTPError:
                pass
        await self._client.aclose()

    async def _post(self, route: str, body: dict[str, JsonValue], allowed: tuple[int, ...] = (1,)) -> NativeResponse:
        self.info.validate_permission()
        response = await self._client.post(API + route, json={**body, "v": "0.0.1"})
        response.raise_for_status()
        result = NativeResponse.model_validate_json(response.content)
        if result.status not in allowed:
            raise EditorError("UDトークが要求を受け付けませんでした。公開状態と編集権を確認してください。")
        return result

    def _session(self) -> dict[str, JsonValue]:
        return {"u": self._user, "t": self.info.talk_id, "k": self.info.entry_key}

    async def _notify(self, phase: str, root: str = "", result: bool = True, token: str = "") -> None:
        command: dict[str, JsonValue] = {"phase": phase, "uniqueIdentifier": self._device,
            "utteranceIdentifier": root, "result": result, "token": token, "timestamp": time(),
            "name": "Caption Relay", "editCount": 0}
        await self._post("/push/talkOption/", {"u": self._user, "t": self.info.talk_id,
            "target": "0", "type": "1", "s": "1", "mt": json.dumps(command, ensure_ascii=False)})

    async def _connect(self) -> None:
        if self._user is None:
            initialized = await self._post("/push/initialize/", {"u": "0", "n": "Caption Relay"})
            user = initialized.users.get("id") if initialized.users else None
            if not isinstance(user, (int, str)) or isinstance(user, bool) or not str(user):
                raise EditorError("UDトークの参加応答を読み取れませんでした。")
            self._user = str(user)
        await self._post("/push/signTalk/", self._session(), (1, 13))
        current = await self._post("/pull/talkCurrent/", {"t": self.info.talk_id, "k": self.info.entry_key})
        if current.number is None or current.current is None:
            raise EditorError("UDトークの受信位置を読み取れませんでした。")
        self._cursor = (current.number, current.current)
        await self._notify("connecting")

    def _receive(self, messages: list[WebMessage]) -> None:
        # Stage all metadata and derived state before invoking the application.
        state = deepcopy(self._utterances)
        accepted: list[tuple[SourceEvent, bool, str]] = []
        for message in messages:
            command = JSON_OBJECT.validate_json(message.meta)
            if command.get("phase") not in {"created", "updated", "modified", "finalized", "direct", "removed", "image"}:
                continue
            if not command.get("utteranceIdentifier"):
                continue
            fragment = Fragment.model_validate(command)
            if fragment.phase == "image" or fragment.type == 1 or command.get("sendingUniqueIdentifier") == self._device:
                continue
            parts = fragment.utteranceIdentifier.split(":")
            if len(parts) > 2 or not parts[0] or (len(parts) == 2 and not parts[1].isdecimal()):
                raise EditorError("UDトークの発話IDを読み取れませんでした。")
            root, index = parts[0], int(parts[1]) if len(parts) == 2 else 0
            if index > 4096:
                raise EditorError("UDトークの断片数が多すぎるため、受信を停止しました。")
            utterance = state.setdefault(root, NativeUtterance())
            previous = utterance.fragments.get(index)
            if previous == command:
                continue
            if previous:
                prior = Fragment.model_validate(previous)
                if fragment.connected.timestamp < prior.connected.timestamp or (
                    fragment.connected.timestamp == prior.connected.timestamp and fragment.clock() < prior.clock()
                ):
                    continue
            sender = command.get("sendingUniqueIdentifier")
            remote_edit = isinstance(sender, str) and sender != command.get("uniqueIdentifier")
            if remote_edit and len(parts) == 1:
                utterance.fragments.clear()
            utterance.fragments[index] = command
            if fragment.phase == "finalized" and fragment.endOfUtterance:
                for earlier_index, earlier in utterance.fragments.items():
                    if earlier_index < index:
                        earlier["endOfUtterance"] = True
            # Keep human saves and later recognition in their original order;
            # a poll batch must have the same effect as separate polls.
            event = self._decode_utterance(root, utterance, remote_edit)
            if event is not None:
                accepted.append((event, remote_edit, root))
        self._utterances = state
        for event, remote_edit, root in accepted:
            self._roots[event.utterance_id] = root
            self._accept(event, remote_edit)
            self.status.received_events += 1
        editable: list[str] = []
        for caption_id, root in self._roots.items():
            content = self._utterances[root].content
            if content is not None and content[1]:
                editable.append(caption_id)
        self.status.editable_caption_ids = editable

    def _decode_utterance(self, root: str, utterance: NativeUtterance, remote_edit: bool) -> SourceEvent | None:
        active = {i: value for i, value in utterance.fragments.items() if value.get("phase") != "removed"
                  and not (value.get("phase") == "created" and value.get("text") == "..." and value.get("type") == -1)}
        if utterance.content is None and not any(value.get("text") for value in active.values()):
            return None
        text = "".join(str(active[i].get("text", "")) for i in sorted(active))
        complete = bool(active) and set(range(max(active) + 1)) <= utterance.fragments.keys()
        final = complete and all(value.get("phase") == "direct" or (
            value.get("phase") == "finalized" and value.get("endOfUtterance") is True
        ) for value in active.values())
        removed = all(value.get("phase") == "removed" for value in utterance.fragments.values())
        speaker = speaker_from_fragments(Fragment.model_validate(command) for command in active.values())
        content = (text, final, removed, speaker)
        if content == utterance.content and not remote_edit:
            return None
        utterance.content = content
        utterance.revision += 1
        caption_id = "editor-" + sha256(f"{self._device}:{self.info.talk_id}:{root}".encode()).hexdigest()
        return SourceEvent(utterance_id=caption_id, revision=utterance.revision, text=text,
            is_final=final, removed=removed, speaker=speaker, source_event_id=f"{caption_id}-{utterance.revision}")

    async def _poll(self) -> None:
        if self._cursor is None:
            raise EditorError("UDトークへの接続が完了していません。")
        result = await self._post("/pull/talkMessage/", {
            **self._session(), "l": self._cursor[0], "c": self._cursor[1],
        }, (1, 5))
        if result.status == 5:
            return
        if result.number is None or result.current is None or result.messages is None or len(result.messages) != 1:
            raise EditorError("UDトークの受信形式を読み取れませんでした。")
        if result.number < self._cursor[0] or result.current < self._cursor[1]:
            raise EditorError("UDトークの受信位置が変わりました。接続し直してください。")
        self._receive(result.messages[0])
        self._cursor = (result.number, result.current)

    async def _run(self) -> None:
        delay = 1
        try:
            while True:
                try:
                    async with self._io:
                        if self._cursor is None:
                            await self._connect()
                        await self._poll()
                    self.status.state = "live"
                    self.status.message = "編集参加の通信が応答しています。純正画面への反映は実機確認が必要です。"
                    delay = 1
                    await asyncio.sleep(1)
                except (httpx.TransportError, httpx.HTTPStatusError) as error:
                    if isinstance(error, httpx.HTTPStatusError) and error.response.status_code not in (408, 429, 500, 502, 503, 504):
                        raise EditorError("UDトークへの編集参加が拒否されました。公開状態と編集権を確認してください。") from None
                    self.status.state = "retrying"
                    self.status.message = "UDトークとの通信を再試行しています。障害時は独立配信を使えます。"
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 15)
        except (EditorError, ValueError, UdtalkProtocolError) as error:
            self.status.state = "failed"
            self.status.message = str(error) if isinstance(error, EditorError) else "UDトークの受信形式を読み取れませんでした。"

    async def edit(self, caption_id: str, text: str, validate: Callable[[], None]) -> None:
        async with self._io:
            if self.status.state != "live" or caption_id not in self._roots:
                raise EditorError("接続中のUDトークから受信した確定字幕だけを反映できます。")
            await self._poll()
            validate()
            root = self._roots[caption_id]
            utterance = self._utterances[root]
            if not utterance.content or not utterance.content[1]:
                raise EditorError("UDトークの発話が確定してから訂正してください。")
            token = str(uuid4())
            lock_body: dict[str, JsonValue] = {"u": self._user, "t": self.info.talk_id, "lgid": root + "_" + self.info.talk_id}
            locked = await self._post("/push/lockMessage/", {**lock_body, "token": token})
            if locked.result is not True:
                await self._notify("locked", root, False, token)
                raise EditorError("別の編集者が編集中です。下書きを保持しています。")
            try:
                await self._notify("locked", root, True, token)
                await self._poll()
                validate()
                utterance = self._utterances[root]
                command = deepcopy(utterance.fragments[min(utterance.fragments)])
                edit_count = command.get("editCount")
                if not isinstance(edit_count, (str, int)) or isinstance(edit_count, bool):
                    edit_count = 0
                command.update(utteranceIdentifier=root, text=text, phase="finalized", endOfUtterance=True,
                    sendingUniqueIdentifier=self._device, rid=self._user, editCount=int(edit_count) + 1)
                # Keep original identity and locale, but do not resend stale reading/translation output.
                command["originalText"] = command.get("originalText") or (utterance.content[0] if utterance.content else "")
                command["extendResult"] = None
                for key in ("sharingTalkId", "sharingUserId", "_udtalkInitialHistory"):
                    command.pop(key, None)
                edited = await self._post("/push/editMessage/", {"u": self._user, "t": self.info.talk_id,
                    "m": text, "l": self._push_cursor[0], "c": self._push_cursor[1],
                    "lgid": root + "_" + self.info.talk_id, "mt": json.dumps(command, ensure_ascii=False),
                    "uuid": str(uuid4()), "bc": "1"})
                if edited.number is not None and edited.current is not None:
                    self._push_cursor = (edited.number, edited.current)
            finally:
                # Wait for cleanup even if another cancellation arrives while
                # the save is already unwinding. Shutdown must not close the
                # client before the unlock request and notification finish.
                cleanup = asyncio.create_task(self._release_lock(lock_body, root))
                cancelled = False
                while not cleanup.done():
                    try:
                        await asyncio.shield(cleanup)
                    except asyncio.CancelledError:
                        cancelled = True
                cleanup.result()
                if cancelled:
                    raise asyncio.CancelledError()

    async def _release_lock(self, lock_body: dict[str, JsonValue], root: str) -> None:
        unlock_token = str(uuid4())
        try:
            async with asyncio.timeout(5):
                unlocked = await self._post("/push/unlockMessage/", {**lock_body, "token": unlock_token})
                await self._notify("unlocked", root, unlocked.result is True, unlock_token)
                if unlocked.result is not True:
                    self.status.message = "編集ロックの解除を確認できませんでした。UDトーク側を確認してください。"
        except (TimeoutError, httpx.HTTPError, EditorError, ValueError):
            self.status.message = "編集ロックの解除を確認できませんでした。UDトーク側を確認してください。"
