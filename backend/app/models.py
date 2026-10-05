from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_assignment=True)


class SourceEvent(Model):
    utterance_id: str = Field(min_length=1)
    revision: int = Field(ge=1)
    text: str
    is_final: bool = True
    source_event_id: str = Field(min_length=1)


class CaptionPatch(Model):
    text: str
    base_revision: int = Field(ge=1)

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("caption must not be blank")
        return value


class Command(Model):
    command: Literal["show", "hide"]


class Caption(Model):
    id: str
    utterance_id: str
    source_revision: int
    revision: int
    original: str
    text: str
    human_edited: bool = False
    published: bool
    publish_eligible: bool


class PublicCaption(Model):
    id: str
    revision: int
    text: str


class PublicSnapshot(Model):
    visible: bool
    captions: list[PublicCaption]


class Session(Model):
    name: Literal["demo"] = "demo"
    visible: bool
    count: int


class SourceIgnored(Model):
    status: Literal["duplicate", "stale"]


class Visibility(Model):
    visible: bool


class ConflictDetail(Model):
    message: Literal["revision conflict"] = "revision conflict"
    latest: Caption


class ConflictResponse(Model):
    detail: ConflictDetail
