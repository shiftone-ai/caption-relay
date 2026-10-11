"""Selects a model and records routing plans and provider availability."""

from collections import deque
from statistics import median
from uuid import uuid4

from .models import AiModelId, AiModelOption, AiRequest, AiResultInfo, AiRouting, AiSettings


MODELS = (
    AiModelOption(id="gemini-3.1-flash-lite", provider="gemini", label="Gemini 3.1 Flash-Lite",
                  input_usd_per_million=0.25, output_usd_per_million=1.5,
                  pricing_url="https://ai.google.dev/gemini-api/docs/pricing"),
    AiModelOption(id="claude-haiku-4-5", provider="claude", label="Claude Haiku 4.5",
                  input_usd_per_million=1.0, output_usd_per_million=5.0,
                  pricing_url="https://platform.claude.com/docs/en/about-claude/pricing"),
    AiModelOption(id="gpt-5.3-codex", provider="codex", label="Codex · GPT-5.3-Codex",
                  input_usd_per_million=1.75, output_usd_per_million=14.0,
                  pricing_url="https://developers.openai.com/api/docs/pricing"),
    AiModelOption(id="gpt-5.4-mini-2026-03-17", provider="openai", label="GPT-5.4 Mini",
                  input_usd_per_million=0.75, output_usd_per_million=4.5,
                  pricing_url="https://developers.openai.com/api/docs/models/gpt-5.4-mini",
                  pricing_checked_on="2026-10-11"),
)


class AiRouter:
    def __init__(self) -> None:
        self._settings = AiSettings()
        self._latencies: dict[AiModelId, deque[float]] = {}
        self._available: set[AiModelId] = set()

    def set_available(self, models: set[AiModelId]) -> None:
        self._available = set(models)

    def snapshot(self) -> AiRouting:
        models = [model.model_copy(deep=True) for model in MODELS]
        for model in models:
            model.configured = model.id in self._available
            samples = self._latencies.get(model.id)
            if samples:
                model.measured_latency_ms = median(samples)
                model.latency_samples = len(samples)
        candidates = [model for model in models if model.id in self._settings.candidates]
        configured = [model for model in candidates if model.configured]
        if configured:
            candidates = configured
        strategy = self._settings.strategy
        selected = self._settings.preferred_model
        reason = strategy
        if strategy == "off":
            return AiRouting(settings=self._settings.model_copy(deep=True), models=models,
                             selected_model=None, reason="off")
        if strategy == "cost":
            # Reference workload: 200 input / 100 output tokens, without caching or tools.
            selected = min(candidates, key=lambda model: (
                200 * model.input_usd_per_million + 100 * model.output_usd_per_million,
                model.id,
            )).id
        elif strategy == "speed":
            measured = [model for model in candidates if model.measured_latency_ms is not None]
            if measured:
                selected = min(measured, key=lambda model: (model.measured_latency_ms or 0, model.id)).id
            else:
                if selected not in {model.id for model in candidates}:
                    selected = candidates[0].id
                reason = "unmeasured"
        return AiRouting(settings=self._settings.model_copy(deep=True), models=models,
                         selected_model=selected, reason=reason, connected=selected in self._available)

    def configure(self, settings: AiSettings) -> AiRouting:
        self._settings = settings.model_copy(deep=True)
        return self.snapshot()

    def plan(self, source_revision: int) -> AiRequest | None:
        model = self.snapshot().selected_model
        return None if model is None else AiRequest(id=str(uuid4()), model_id=model, source_revision=source_revision)

    def record(self, result: AiResultInfo) -> None:
        samples = self._latencies.setdefault(result.model_id, deque(maxlen=20))
        samples.append(result.elapsed_ms)
