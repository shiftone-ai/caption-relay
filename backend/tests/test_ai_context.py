import asyncio
import json

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.ai_provider import AiProvider
from app.main import create_app
from app.models import AiCorrectionContext, AiRequest, AiSettings, Caption, ConnectionSettings, SourceEvent
from app.relay import CaptionRelay
from app.workflow import CaptionWorkflow


def receive(relay, identifier, text, final=True):
    result = relay.source_event(SourceEvent(utterance_id=identifier, source_event_id=identifier,
                                            revision=1, text=text, is_final=final))
    assert isinstance(result, Caption)
    return result


def test_context_uses_prior_final_captions_and_clears_on_connection_change():
    relay = CaptionRelay()
    receive(relay, "old", "前の接続の字幕")
    relay.connection_mode("client")
    relay.ai_settings(AiSettings(background="写真と布の展示"))
    receive(relay, "previous", "光を通すところと通さないところ")
    receive(relay, "interim", "未確定", False)
    receive(relay, "current", "その気概を使いたかった")
    receive(relay, "future", "後から届いた字幕")
    context = relay.ai_context("current")
    assert context.background == "写真と布の展示"
    assert context.recent_utterances == ["光を通すところと通さないところ"]
    relay.ai_settings(AiSettings(background="別の背景"))
    assert context.background == "写真と布の展示"
    relay.connection_mode("host")
    receive(relay, "next", "次の接続")
    assert relay.ai_context("next").recent_utterances == []


def test_recent_context_is_bounded_without_cutting_sentences():
    relay = CaptionRelay()
    for number in range(10):
        receive(relay, str(number), str(number) * 550)
    receive(relay, "current", "校正対象")
    recent = relay.ai_context("current").recent_utterances
    assert recent == [str(number) * 550 for number in range(5, 10)]
    assert sum(map(len, recent)) <= 3000


def test_same_input_format_change_keeps_recent_context():
    async def verify():
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {})
        receive(relay, "previous", "同じ接続の字幕")
        await workflow.configure(ConnectionSettings(mode="host", zoom_text_format="speaker"))
        receive(relay, "current", "校正対象")
        assert relay.ai_context("current").recent_utterances == ["同じ接続の字幕"]
        await workflow.stop()
    asyncio.run(verify())


@pytest.mark.parametrize("model", ["gemini-3.5-flash-lite", "claude-haiku-5-5", "gpt-6-luna"])
def test_context_is_separate_from_the_target_for_each_provider(model):
    def handle(request):
        body = json.loads(request.content)
        if model.startswith("gemini"):
            data = body["contents"][0]["parts"][0]["text"]
            reply = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "その違いです。"}]}}]}
        elif model.startswith("claude"):
            data = body["messages"][0]["content"]
            reply = {"content": [{"type": "text", "text": "その違いです。"}], "stop_reason": "end_turn", "usage": {}}
        else:
            data = body["input"]
            reply = {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "その違いです。"}]}], "usage": {}}
        assert json.loads(data) == {"transcript": "その気概です。", "dictionary": [],
                                    "context": {"background": "布を使う展示", "recent_utterances": ["光を通す、通さない違い"]}}
        return httpx.Response(200, json=reply)

    async def verify():
        provider = AiProvider({"GEMINI_API_KEY": "test-key", "ANTHROPIC_API_KEY": "test-key", "OPENAI_API_KEY": "test-key"}, httpx.MockTransport(handle))
        result = await provider.correct(AiRequest(id="request", model_id=model, source_revision=1), "その気概です。",
                                        context=AiCorrectionContext(background="布を使う展示", recent_utterances=["光を通す、通さない違い"]))
        assert result.text == "その違いです。"
    asyncio.run(verify())


def test_workflow_captures_context_before_the_async_request_starts():
    async def verify():
        requests = []
        def handle(request):
            payload = json.loads(json.loads(request.content)["input"])
            requests.append(payload)
            return httpx.Response(200, json={"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": payload["transcript"]}]}], "usage": {}})
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {"OPENAI_API_KEY": "test-key"}, httpx.MockTransport(handle))
        receive(relay, "before", "直前の字幕")
        relay.ai_settings(AiSettings(strategy="manual", preferred_model="gpt-6-luna", background="保存前"))
        workflow.source_event(SourceEvent(utterance_id="current", source_event_id="current", revision=1, text="対象"))
        relay.ai_settings(AiSettings(strategy="manual", preferred_model="gpt-6-luna", background="保存後"))
        receive(relay, "future", "未来の字幕")
        try:
            for _ in range(100):
                if relay.caption("current").ai_status == "succeeded":
                    break
                await asyncio.sleep(.01)
            assert requests[0]["context"] == {"background": "保存前", "recent_utterances": ["直前の字幕"]}
        finally:
            await workflow.stop()
    asyncio.run(verify())


def test_background_roundtrip_limit_and_public_boundary():
    with TestClient(create_app(environment={})) as client:
        response = client.put("/api/ai", json={"background": "非公開の背景説明"})
        assert response.status_code == 200
        assert client.get("/api/ai").json()["settings"]["background"] == "非公開の背景説明"
        assert "背景説明" not in client.get("/api/view").text
        assert client.put("/api/ai", json={"background": "x" * 4001}).status_code == 422
