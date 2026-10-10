"""Decode the official Web viewer's messages; this is not a supported UD API.

The identifier suffix is a fragment index, NOT an input revision. Keep upstream
ordering and completion here; publication and human edits belong to CaptionRelay.
"""

from copy import deepcopy
from collections.abc import Iterable
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from .models import SourceEvent


class UdtalkProtocolError(ValueError):
    """Safe to log: never include the upstream payload or private URL."""


class Connected(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    timestamp: float = Field(ge=0, allow_inf_nan=False)
    name: str | None = Field(default=None, max_length=256)


class Fragment(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    utteranceIdentifier: str
    phase: Literal["created", "updated", "modified", "finalized", "direct", "removed", "image"]
    text: str = ""
    type: int = 0
    connected: Connected
    finalizedTimestamp: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    endOfUtterance: bool | None = None
    detectedName: str | None = Field(default=None, max_length=256)

    def clock(self) -> tuple[float, float]:
        return (self.finalizedTimestamp or 0, self.connected.timestamp)


class WebMessage(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    meta: str


class MessageHeader(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    utteranceIdentifier: str
    phase: str | None = None


def speaker_from_fragments(fragments: Iterable[Fragment]) -> str | None:
    ordered = sorted(fragments, key=lambda fragment: fragment.connected.timestamp, reverse=True)
    for fragment in ordered:
        if fragment.detectedName and fragment.detectedName.strip():
            return fragment.detectedName.strip()
    for fragment in ordered:
        if "name" in fragment.connected.model_fields_set:
            return (fragment.connected.name or "").strip() or None
    return None


@dataclass
class Utterance:
    fragments: dict[int, Fragment] = field(default_factory=lambda: dict[int, Fragment]())
    seen: set[str] = field(default_factory=lambda: set[str]())
    revision: int = 0
    content: tuple[str, bool, bool, str | None] | None = None


class UdtalkDecoder:
    def __init__(self, room: str) -> None:
        self._room = room
        self._connection_id = str(uuid4())
        self._utterances: dict[str, Utterance] = {}

    def decode(self, messages: list[WebMessage]) -> list[SourceEvent]:
        # Reject an invalid batch without partly advancing state or publishing.
        state: dict[str, Utterance] = {}
        changed: dict[str, None] = {}
        try:
            fragments: list[Fragment] = []
            for message in messages:
                header = MessageHeader.model_validate_json(message.meta)
                if header.utteranceIdentifier == "" and header.phase in (None, "removed"):
                    continue
                fragments.append(Fragment.model_validate_json(message.meta))
            for fragment in fragments:
                if fragment.phase == "removed" and fragment.utteranceIdentifier == "":
                    # The real app also emits an empty removal control record.
                    continue
                if fragment.phase == "image" or fragment.type == 1:
                    continue
                parts = fragment.utteranceIdentifier.split(":")
                if len(parts) > 2 or not parts[0] or (len(parts) == 2 and not parts[1].isdecimal()):
                    raise UdtalkProtocolError("UDTalk fragment identifier is invalid")
                root = parts[0]
                index = int(parts[1]) if len(parts) == 2 else 0
                if root not in state:
                    state[root] = deepcopy(self._utterances.get(root, Utterance()))
                utterance = state[root]
                fingerprint = sha256(fragment.model_dump_json().encode()).hexdigest()
                if fingerprint in utterance.seen:
                    continue
                utterance.seen.add(fingerprint)
                previous = utterance.fragments.get(index)
                if previous is not None:
                    # Equal clocks may carry the final flag; an older pair may not
                    # roll back a more recent recognition or upstream correction.
                    if fragment.connected.timestamp < previous.connected.timestamp:
                        continue
                    if (fragment.connected.timestamp == previous.connected.timestamp
                            and fragment.phase != "removed" and previous.phase != "removed"
                            and fragment.clock()[0] < previous.clock()[0]):
                        continue
                utterance.fragments[index] = fragment
                if fragment.phase == "finalized" and fragment.endOfUtterance is True:
                    for earlier_index, earlier in utterance.fragments.items():
                        if earlier_index < index and earlier.endOfUtterance is False:
                            earlier.endOfUtterance = True
                changed[root] = None
        except ValueError as error:
            if isinstance(error, UdtalkProtocolError):
                raise
            raise UdtalkProtocolError("UDTalk message format is invalid") from None

        events: list[SourceEvent] = []
        for root in changed:
            utterance = state[root]
            active = {index: fragment for index, fragment in utterance.fragments.items()
                      if fragment.phase != "removed" and not (
                          fragment.phase == "created" and fragment.type == -1 and fragment.text == "..."
                      )}
            if utterance.content is None and not any(fragment.text for fragment in active.values()):
                # Silence creates a type=-1 placeholder, then removes it. It is
                # bookkeeping, not recognized speech and must not create a row.
                continue
            ordered = sorted(active)
            text = "".join(active[index].text for index in ordered)
            # Cancelled positions are accounted for; only unseen positions are gaps.
            accounted_indices = active.keys() | {
                index for index, fragment in utterance.fragments.items() if fragment.phase == "removed"
            }
            complete = bool(ordered) and sum(
                index <= ordered[-1] for index in accounted_indices
            ) == ordered[-1] + 1
            final = complete and all(
                fragment.phase == "direct" or (
                    fragment.phase == "finalized" and fragment.endOfUtterance is True
                ) for fragment in active.values()
            )
            removed = all(fragment.phase == "removed" for fragment in utterance.fragments.values())
            speaker = speaker_from_fragments(active.values())
            content = (text, final, removed, speaker)
            if content == utterance.content:
                continue
            utterance.content = content
            utterance.revision += 1
            opaque_id = sha256(f"{self._connection_id}:{self._room}:{root}".encode()).hexdigest()
            events.append(SourceEvent(
                utterance_id=f"udtalk-{opaque_id}", revision=utterance.revision,
                text=text, is_final=final, speaker=speaker,
                removed=removed,
                source_event_id=f"udtalk-{opaque_id}-{utterance.revision}",
            ))
        self._utterances.update(state)
        return events
