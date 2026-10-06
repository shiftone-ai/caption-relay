from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_assignment=True)


AiModelId = Literal["gemini-3.1-flash-lite", "claude-haiku-4-5", "gpt-5.3-codex"]


class AiSettings(Model):
    strategy: Literal["off", "manual", "cost", "speed"] = "off"
    preferred_model: AiModelId = "gemini-3.1-flash-lite"
    candidates: list[AiModelId] = Field(default_factory=lambda: [
        "gemini-3.1-flash-lite", "claude-haiku-4-5", "gpt-5.3-codex",
    ], min_length=1, max_length=3)

    @model_validator(mode="after")
    def valid_candidates(self) -> "AiSettings":
        if len(set(self.candidates)) != len(self.candidates):
            raise ValueError("candidate models must be unique")
        if self.preferred_model not in self.candidates:
            raise ValueError("preferred model must be a candidate")
        return self


class AiModelOption(Model):
    id: AiModelId
    provider: Literal["gemini", "claude", "codex"]
    label: str
    input_usd_per_million: float
    output_usd_per_million: float
    pricing_url: str
    pricing_checked_on: str = "2026-10-05"
    measured_latency_ms: float | None = None
    latency_samples: int = 0


class AiRouting(Model):
    settings: AiSettings
    models: list[AiModelOption]
    selected_model: AiModelId | None
    reason: Literal["off", "manual", "cost", "speed", "unmeasured"]
    connected: Literal[False] = False


class AiRequest(Model):
    id: str = Field(min_length=1)
    model_id: AiModelId
    source_revision: int = Field(ge=1)


class AiResultInfo(Model):
    request_id: str = Field(min_length=1)
    model_id: AiModelId
    elapsed_ms: float = Field(ge=0, allow_inf_nan=False)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


class SourceEvent(Model):
    utterance_id: str = Field(min_length=1)
    revision: int = Field(ge=1)
    text: str
    is_final: bool = True
    source_event_id: str = Field(min_length=1)
    formatted_text: str | None = None
    removed: bool = False

    @model_validator(mode="after")
    def valid_removal(self) -> "SourceEvent":
        if self.removed and (self.text or self.formatted_text is not None or self.is_final):
            raise ValueError("removed input must be empty and non-final")
        return self

    @field_validator("formatted_text")
    @classmethod
    def nonblank_formatted_text(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("formatted text must not be blank")
        return value


class FormattedResult(Model):
    source_revision: int = Field(ge=1)
    text: str
    ai: AiResultInfo | None = None

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("formatted text must not be blank")
        return value


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
    received_at: AwareDatetime
    source_revision: int
    revision: int
    original: str
    text: str
    human_edited: bool = False
    published: bool
    publish_eligible: bool
    formatted_text: str | None = None
    source_final: bool = True
    public_text: str | None = None
    public_revision: int | None = None
    ai_request: AiRequest | None = None
    ai_result: AiResultInfo | None = None


class DisplaySettings(Model):
    background: str = Field(default="#0a0a0a", pattern=r"^#[0-9a-fA-F]{6}$")
    foreground: str = Field(default="#ffffff", pattern=r"^#[0-9a-fA-F]{6}$")
    font: Literal["sans", "serif", "mono"] = "sans"
    font_size: int = Field(default=64, ge=24, le=96)
    font_weight: Literal["normal", "bold"] = "bold"
    line_height: float = Field(default=1.5, ge=1.2, le=2.0)
    padding: int = Field(default=48, ge=0, le=160)
    position: Literal["top", "center", "bottom"] = "center"
    align: Literal["left", "center"] = "left"
    history_count: int = Field(default=1, ge=1, le=10)
    aspect: Literal["window", "16:9"] = "window"


class PublicationMode(Model):
    auto_publish: bool


class PublicCaption(Model):
    id: str
    revision: int
    text: str


class PublicSnapshot(Model):
    visible: bool
    captions: list[PublicCaption]
    display: DisplaySettings = Field(default_factory=DisplaySettings)


class Session(Model):
    name: Literal["demo"] = "demo"
    visible: bool
    count: int
    auto_publish: bool = True
    display: DisplaySettings = Field(default_factory=DisplaySettings)


class SourceIgnored(Model):
    status: Literal["duplicate", "stale"]


class Visibility(Model):
    visible: bool


class ConflictDetail(Model):
    message: Literal["revision conflict"] = "revision conflict"
    latest: Caption


class ConflictResponse(Model):
    detail: ConflictDetail
