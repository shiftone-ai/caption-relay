"""Saved room settings and the credential-free home API."""

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .models import AiSettings, ConnectionSettings, DisplaySettings, InputSource, Model, RecognizerId


class RoomDraft(Model):
    name: str = Field(min_length=1, max_length=120)
    connection: ConnectionSettings = Field(default_factory=ConnectionSettings)
    ai: AiSettings = Field(default_factory=AiSettings)

    @field_validator("name")
    @classmethod
    def nonblank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("room name must not be blank")
        return value.strip()


class SavedRoom(RoomDraft):
    id: str = Field(pattern=r"^[a-z0-9-]{1,64}$")
    last_used_at: datetime | None = None
    generation: int = Field(default=0, ge=0)
    display: DisplaySettings = Field(default_factory=DisplaySettings)
    auto_publish: bool = True
    visible: bool = True


class RoomFile(Model):
    rooms: list[SavedRoom] = Field(max_length=100)

    @model_validator(mode="after")
    def unique_rooms(self) -> "RoomFile":
        if len({room.id for room in self.rooms}) != len(self.rooms):
            raise ValueError("room identifiers must be unique")
        return self


class RoomSummary(Model):
    id: str
    name: str
    last_used_at: datetime | None
    generation: int
    caption_count: int
    mode: str
    input_source: InputSource
    recognizer: RecognizerId
    background: str
    deletable: bool = False


class RoomDetails(RoomSummary):
    connection: ConnectionSettings
    ai: AiSettings


class RoomCatalog(Model):
    active_room_id: str | None
    rooms: list[RoomSummary]


class RoomReset(Model):
    generation: int = Field(ge=0)


RoomStateCode = Literal["room_reset", "room_inactive", "room_missing"]


class RoomStateError(Model):
    detail: str
    code: RoomStateCode | None = None
