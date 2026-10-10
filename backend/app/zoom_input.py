"""UDトーク's observed Zoom sender: UTF-8, seq, uttrId and [Edited]."""

from dataclasses import dataclass
from hashlib import sha256
from secrets import compare_digest, token_urlsafe
from typing import Literal

from .models import SourceEvent


class ReceiverError(ValueError):
    pass


@dataclass
class Packet:
    sequence: int
    fingerprint: str
    event: SourceEvent


class ZoomInput:
    def __init__(self, text_format: Literal["plain", "speaker"] = "plain") -> None:
        self.text_format: Literal["plain", "speaker"] = text_format
        self.token = token_urlsafe(32)
        self.sequence = 0
        self._packets: dict[int, Packet] = {}
        self._revisions: dict[str, int] = {}
        self._last_sequences: dict[str, int] = {}

    @property
    def path(self) -> str:
        return f"/closedcaption?signature={self.token}"

    def authorized(self, signature: str) -> bool:
        return compare_digest(signature, self.token)

    def decode(self, sequence: int, utterance_id: str, language: str, body: str) -> SourceEvent | None:
        if not utterance_id or len(utterance_id) > 256 or len(language) > 32 or len(body) > 32768:
            raise ReceiverError("字幕の形式を確認してください。")
        fingerprint = sha256(f"{utterance_id}\0{language}\0{body}".encode()).hexdigest()
        prior = self._packets.get(sequence)
        if prior:
            if prior.fingerprint != fingerprint:
                raise ReceiverError("同じ送信番号に異なる字幕が届きました。")
            return None
        edited = body.startswith("[Edited] ")
        text = body[len("[Edited] "):] if edited else body
        speaker = None
        # The sender has no separate speaker field. Only split its known format
        # when the operator explicitly confirms that name sending is enabled.
        if self.text_format == "speaker":
            if text.startswith("/ "):
                text = text[2:]
            elif " / " in text:
                name, _, text = text.partition(" / ")
                speaker = name.strip() or None
                if speaker is not None and len(speaker) > 256:
                    raise ReceiverError("発話者名の長さを確認してください。")
        text = text.strip()
        opaque_id = sha256(f"{self.token}:{language}:{utterance_id}".encode()).hexdigest()
        caption_id = f"zoom-{opaque_id}"
        if sequence <= self._last_sequences.get(caption_id, 0):
            return None
        revision = self._revisions.get(caption_id, 0) + 1
        event = SourceEvent(utterance_id=caption_id, revision=revision, text=text, speaker=speaker,
            is_final=bool(text), removed=not text and edited,
            source_event_id=f"{caption_id}-{sequence}")
        if not text and not edited:
            raise ReceiverError("字幕が空欄です。")
        self.sequence = max(self.sequence, sequence)
        self._revisions[caption_id] = revision
        self._last_sequences[caption_id] = sequence
        self._packets[sequence] = Packet(sequence, fingerprint, event)
        # Retries beyond this window are still ignored using the high-water mark.
        if len(self._packets) > 128:
            del self._packets[min(self._packets)]
        return event
