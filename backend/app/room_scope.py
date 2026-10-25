"""Bind an operator request to a room and a caption generation."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Header


@dataclass(frozen=True)
class RoomScope:
    room_id: str | None
    generation: int | None


def room_scope(
    room_id: Annotated[str | None, Header(alias="X-Caption-Relay-Room", min_length=1, max_length=64)] = None,
    generation: Annotated[int | None, Header(alias="X-Caption-Relay-Generation", ge=0)] = None,
) -> RoomScope:
    return RoomScope(room_id, generation)
