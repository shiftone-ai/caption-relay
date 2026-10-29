from typing import Annotated, Literal
import unicodedata

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_assignment=True)


DICTIONARY_LIMITS = {"maxWordLength": 80, "maxVariants": 5, "maxEntries": 100, "maxTotalLength": 10000}


WordText = Annotated[str, Field(min_length=1, max_length=DICTIONARY_LIMITS["maxWordLength"], pattern=r"^[^\x00-\x1f\x7f<>]+$")]


class DictionaryWord(Model):
    term: WordText
    reading: str = Field(default="", max_length=DICTIONARY_LIMITS["maxWordLength"], pattern=r"^[^\x00-\x1f\x7f<>]*$")
    variants: list[WordText] = Field(default_factory=list, max_length=DICTIONARY_LIMITS["maxVariants"])
    enabled: bool = True

    @field_validator("term", "reading")
    @classmethod
    def trim_word(cls, value: str) -> str:
        value = unicodedata.normalize("NFC", value.strip())
        return value

    @model_validator(mode="after")
    def valid_word(self) -> "DictionaryWord":
        if not self.term or any(not value.strip() or value != value.strip() for value in self.variants):
            raise ValueError("辞書の表記を空欄にしたり、前後に空白を含めたりできません。")
        if len(set(self.variants)) != len(self.variants):
            raise ValueError("誤認識の表記が重複しています。")
        return self


class DictionarySettings(Model):
    entries: list[DictionaryWord] = Field(default_factory=lambda: list[DictionaryWord](), max_length=DICTIONARY_LIMITS["maxEntries"])

    @model_validator(mode="after")
    def unique_terms(self) -> "DictionarySettings":
        keys = [unicodedata.normalize("NFKC", entry.term).casefold() for entry in self.entries]
        if len(set(keys)) != len(keys):
            raise ValueError("同じ表記は一度だけ登録してください。")
        if sum(len(entry.term) + len(entry.reading) + sum(map(len, entry.variants)) for entry in self.entries) > DICTIONARY_LIMITS["maxTotalLength"]:
            raise ValueError(f"辞書は合計{DICTIONARY_LIMITS['maxTotalLength']:,}文字以内で登録してください。")
        return self


class DictionarySnapshot(DictionarySettings):
    revision: int = Field(default=0, ge=0)


class DictionaryUpdate(DictionarySettings):
    base_revision: int = Field(ge=0)


class DictionaryError(Model):
    detail: str


AiModelId = Literal["gemini-3.5-flash-lite", "claude-haiku-5-5", "gpt-6.1-sol", "gpt-6-luna"]


class AiSettings(Model):
    background: str = Field(default="", max_length=4000)
    strategy: Literal["off", "manual", "cost", "speed"] = "off"
    preferred_model: AiModelId = "gpt-6-luna"
    candidates: list[AiModelId] = Field(default_factory=lambda: [
        "gemini-3.5-flash-lite", "claude-haiku-5-5", "gpt-6.1-sol", "gpt-6-luna",
    ], min_length=1, max_length=4)

    @model_validator(mode="after")
    def valid_candidates(self) -> "AiSettings":
        if len(set(self.candidates)) != len(self.candidates):
            raise ValueError("candidate models must be unique")
        if self.preferred_model not in self.candidates:
            raise ValueError("preferred model must be a candidate")
        return self


class AiCorrectionContext(Model):
    background: str = Field(default="", max_length=4000)
    recent_utterances: list[str] = Field(default_factory=list, max_length=6)


class AiModelOption(Model):
    id: AiModelId
    provider: Literal["gemini", "claude", "openai"]
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
    request_id: str | None = Field(default=None, min_length=1, max_length=128)
    republish: bool = False

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("caption must not be blank")
        return value


class Command(Model):
    command: Literal["show", "hide"]


class CaptionEdit(Model):
    revision: int
    source_revision: int
    text: str
    saved_at: AwareDatetime
    kind: Literal["source", "ai", "manual"]


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
    publication_epoch: int = 0
    formatted_text: str | None = None
    source_final: bool = True
    public_text: str | None = None
    public_speaker: str | None = Field(default=None, max_length=256)
    public_revision: int | None = None
    ai_request: AiRequest | None = None
    ai_result: AiResultInfo | None = None
    ai_status: Literal["off", "queued", "running", "succeeded", "failed", "unavailable"] = "off"
    ai_error: str | None = None
    edit_history: list[CaptionEdit] = Field(default_factory=list[CaptionEdit])


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
