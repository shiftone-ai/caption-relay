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
    configured: bool = False


class AiRouting(Model):
    settings: AiSettings
    models: list[AiModelOption]
    selected_model: AiModelId | None
    reason: Literal["off", "manual", "cost", "speed", "unmeasured"]
    connected: bool = False


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
    speaker: str | None = Field(default=None, max_length=256)
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
    base_source_revision: int | None = Field(default=None, ge=1)

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
    speaker: str | None = Field(default=None, max_length=256)
    human_edited: bool = False
    published: bool
    publish_eligible: bool
    formatted_text: str | None = None
    source_final: bool = True
    public_text: str | None = None
    public_speaker: str | None = Field(default=None, max_length=256)
    public_revision: int | None = None
    ai_request: AiRequest | None = None
    ai_result: AiResultInfo | None = None
    ai_status: Literal["off", "queued", "running", "succeeded", "failed", "unavailable"] = "off"
    ai_error: str | None = None


RecognizerId = Literal["openai", "apple"]
InputSource = Literal["udtalk", "microphone"]


class RecognizerOption(Model):
    id: RecognizerId
    label: str
    available: bool
    message: str


class TranscriptionStatus(Model):
    state: Literal["stopped", "preparing", "live", "retrying", "failed"] = "stopped"
    message: str = "マイクの認識は停止しています。"
    sent_seconds: float = 0.0
    estimated_yen: float = 0.0


class ConnectionSettings(Model):
    mode: Literal["host", "client"] = "host"
    editor_url: str | None = Field(default=None, max_length=16384)
    zoom_text_format: Literal["plain", "speaker"] = "plain"
    input_source: InputSource = "udtalk"
    recognizer: RecognizerId = "openai"


class ConnectionStatus(Model):
    mode: Literal["host", "client"] = "host"
    state: Literal["waiting", "connecting", "live", "retrying", "failed"] = "waiting"
    message: str = "UDトークからの字幕を待っています。"
    receiver_path: str | None = None
    received_events: int = 0
    zoom_text_format: Literal["plain", "speaker"] = "plain"
    editor_configured: bool = False
    editable_caption_ids: list[str] = Field(default_factory=lambda: list[str]())
    client_verified: Literal[False] = False
    input_source: InputSource = "udtalk"
    recognizer: RecognizerId = "openai"
    transcription: TranscriptionStatus = Field(default_factory=TranscriptionStatus)
    recognizers: list[RecognizerOption] = Field(default_factory=list[RecognizerOption])


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
    display_mode: Literal["scroll", "recent"] = "scroll"
    history_count: int = Field(default=1, ge=1, le=10)
    aspect: Literal["window", "16:9"] = "window"
    speaker_display: Literal["hidden", "inline", "above"] = "above"


class PublicationMode(Model):
    auto_publish: bool


class PublicCaption(Model):
    id: str
    revision: int
    text: str
    speaker: str | None = Field(default=None, max_length=256)


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
