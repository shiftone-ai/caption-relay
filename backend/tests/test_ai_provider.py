import asyncio
import json

import httpx2 as httpx
import pytest

from app.ai_provider import AiFailure, AiProvider, AiUnavailable
from app.models import AiRequest
from app.relay import CaptionRelay
from app.workflow import CaptionWorkflow
from app.models import SourceEvent, AiSettings, CaptionPatch


@pytest.mark.parametrize("model,environment,reply,host", [
    ("gemini-3.5-flash-lite", {"GEMINI_API_KEY": "test-key"}, {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "本文です。"}]}}], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5}}, "generativelanguage.googleapis.com"),
    ("claude-haiku-5-5", {"ANTHROPIC_API_KEY": "test-key"}, {"content": [{"type": "text", "text": "本文です。"}], "stop_reason": "end_turn", "usage": {"input_tokens": 10, "output_tokens": 5}}, "api.anthropic.com"),
    ("gpt-6.1-sol", {"OPENAI_API_KEY": "test-key"}, {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "本文です。"}]}], "usage": {"input_tokens": 10, "output_tokens": 5}}, "api.openai.com"),
    ("gpt-6-luna", {"OPENAI_API_KEY": "test-key"}, {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "本文です。"}]}], "usage": {"input_tokens": 10, "output_tokens": 5}}, "api.openai.com"),
])
def test_provider_uses_real_protocol_and_parses_only_completed_text(model, environment, reply, host):
    def handle(request):
        assert request.url.host == host
        assert "test-key" not in str(request.url)
        expected_header = "x-goog-api-key" if host == "generativelanguage.googleapis.com" else "x-api-key" if host == "api.anthropic.com" else "authorization"
        assert request.headers[expected_header] == ("Bearer test-key" if host == "api.openai.com" else "test-key")
        body = json.loads(request.content)
        assert "えー、本文です。" in str(body)
        if host == "api.openai.com":
            assert body["model"] == model
            assert body["store"] is False
            assert body["reasoning"] == {"effort": "medium" if model == "gpt-6-luna" else "low"}
        return httpx.Response(200, json=reply)
    async def verify():
        provider = AiProvider(environment, httpx.MockTransport(handle))
        result = await provider.correct(AiRequest(id="request", model_id=model, source_revision=1), "えー、本文です。")
        assert result.text == "本文です。"
        assert result.ai.input_tokens == 10 and result.ai.output_tokens == 5
        assert result.ai.elapsed_ms >= 0
    asyncio.run(verify())


def test_provider_enforces_a_total_deadline_and_hides_upstream_error_payloads():
    async def verify():
        async def delayed(_):
            await asyncio.sleep(1)
            return httpx.Response(200, json={})
        plan = AiRequest(id="request", model_id="gemini-3.5-flash-lite", source_revision=1)
        provider = AiProvider({"GEMINI_API_KEY": "test-key", "CAPTION_RELAY_AI_TIMEOUT_SECONDS": "0.01"},
                              httpx.MockTransport(delayed))
        with pytest.raises(AiFailure, match="時間内"):
            await provider.correct(plan, "字幕")
        provider = AiProvider({"GEMINI_API_KEY": "test-key"},
                              httpx.MockTransport(lambda _: httpx.Response(403, text="private upstream response test-key")))
        with pytest.raises(AiFailure) as failed:
            await provider.correct(plan, "字幕")
        assert "test-key" not in str(failed.value) and "private" not in str(failed.value)
    asyncio.run(verify())


def test_provider_missing_key_error_and_incomplete_response_do_not_fabricate_correction():
    async def verify():
        plan = AiRequest(id="request", model_id="gemini-3.5-flash-lite", source_revision=1)
        with pytest.raises(AiUnavailable):
            await AiProvider({}).correct(plan, "字幕")
        provider = AiProvider({"GEMINI_API_KEY": "test-key"}, httpx.MockTransport(lambda _: httpx.Response(200, json={"candidates": [{"finishReason": "MAX_TOKENS"}]})))
        with pytest.raises(AiFailure):
            await provider.correct(plan, "字幕")
    asyncio.run(verify())


def test_async_ai_result_preserves_new_source_and_human_save():
    async def verify():
        gate = asyncio.Event()
        requests = 0
        async def handle(_):
            nonlocal requests
            requests += 1
            await gate.wait()
            return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "AIの訂正"}]}}]})
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {"GEMINI_API_KEY": "test-key"}, httpx.MockTransport(handle))
        relay.ai_settings(AiSettings(strategy="manual", preferred_model="gemini-3.5-flash-lite"))
        first = workflow.source_event(SourceEvent(utterance_id="speech", revision=1, text="旧原文", source_event_id="one"))
        await asyncio.sleep(0)
        workflow.source_event(SourceEvent(utterance_id="speech", revision=2, text="新原文", source_event_id="two"))
        latest = relay.caption("speech")
        await workflow.patch_caption("speech", CaptionPatch(text="人の訂正", base_revision=latest.revision))
        gate.set()
        async with asyncio.timeout(2):
            while workflow._tasks:
                await asyncio.sleep(0.01)
        assert relay.caption("speech").text == "人の訂正"
        assert relay.caption("speech").original == "新原文"
        assert relay.caption("speech").formatted_text == "AIの訂正"
        assert first.source_revision == 1 and requests >= 1
        await workflow.stop()
    asyncio.run(verify())
