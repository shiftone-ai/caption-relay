"""Connection transitions use synthetic external services, never live credentials."""

import asyncio

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import AiSettings, ConnectionSettings, SourceEvent
from app.relay import CaptionRelay
from app.udtalk_editor import UdtalkEditor, decode_editor_url
from app.udtalk_web import UdtalkWebInput
from app.workflow import CaptionWorkflow
from test_udtalk_editor import NativeServer, editor_url, wait_until
from test_udtalk_web import URL, ViewerServer


def test_client_status_preserves_zoom_format_when_returning_to_host():
    server = NativeServer()
    with TestClient(create_app(environment={}, editor_transport=httpx.MockTransport(server.handle))) as client:
        client.put("/api/connection", json={"mode": "host", "zoom_text_format": "speaker"}).raise_for_status()
        response = client.put("/api/connection", json={
            "mode": "client", "editor_url": editor_url(), "zoom_text_format": "speaker",
        })
        response.raise_for_status()
        assert response.json()["zoom_text_format"] == "speaker"
        status = client.get("/api/connection").json()
        assert status["zoom_text_format"] == "speaker"
        host = client.put("/api/connection", json={
            "mode": "host", "zoom_text_format": status["zoom_text_format"],
        }).json()
        client.post(host["receiver_path"] + "&seq=1&uttrId=speech", content="登壇者 / 本文",
                    headers={"content-type": "text/plain"}).raise_for_status()
        caption = client.get("/api/events").json()[0]
        assert caption["speaker"] == "登壇者" and caption["original"] == "本文"


def test_switching_to_client_disables_the_previous_live_web_input():
    async def verify():
        relay = CaptionRelay()
        server = NativeServer()
        workflow = CaptionWorkflow(relay, URL, {}, editor_transport=httpx.MockTransport(server.handle))
        viewer = ViewerServer()
        workflow.connections.web = UdtalkWebInput(URL, workflow.source_event, httpx.MockTransport(viewer.handle))
        workflow.start()
        try:
            await wait_until(lambda: workflow.connections.web.status.received_events == 1)
            assert workflow.connections.web.status.state == "live"
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            assert viewer.departed
            assert workflow.connections.web.status.state == "disabled"
            assert workflow.connections.web.status.received_events == 0
        finally:
            await workflow.stop()
    asyncio.run(verify())


@pytest.mark.parametrize("shutdown", [False, True])
def test_transition_does_not_schedule_ai_for_input_received_while_cancelling(shutdown):
    async def verify():
        started = asyncio.Event()
        cancelling = asyncio.Event()
        release = asyncio.Event()
        requests = 0

        async def handle(_):
            nonlocal requests
            requests += 1
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelling.set()
                await release.wait()
                raise

        relay = CaptionRelay()
        server = NativeServer()
        workflow = CaptionWorkflow(relay, None, {"GEMINI_API_KEY": "test-key"}, httpx.MockTransport(handle),
                                   httpx.MockTransport(server.handle))
        relay.ai_settings(AiSettings(strategy="manual"))
        workflow.source_event(SourceEvent(utterance_id="before", revision=1, text="元の字幕", source_event_id="before-1"))
        await asyncio.wait_for(started.wait(), 1)
        transition = asyncio.create_task(workflow.stop() if shutdown else workflow.configure(
            ConnectionSettings(mode="client", editor_url=editor_url())))
        try:
            await asyncio.wait_for(cancelling.wait(), 1)
            workflow.source_event(SourceEvent(utterance_id="during", revision=1, text="切替中の字幕", source_event_id="during-1"))
            await asyncio.sleep(0)
            assert requests == 1
            assert relay.caption("during").ai_status == "failed"
        finally:
            release.set()
            await transition
            if not shutdown:
                await workflow.stop()
        assert workflow._tasks == {}
        assert relay.caption("during").formatted_text is None
    asyncio.run(verify())


def test_shutdown_keeps_ai_paused_while_the_editor_departure_is_pending():
    async def verify():
        server = NativeServer()
        departing = asyncio.Event()
        release = asyncio.Event()
        ai_requests = 0

        async def editor_handle(request):
            if request.url.path == "/push/awayTalk/":
                departing.set()
                await release.wait()
            return server.handle(request)

        def ai_handle(_):
            nonlocal ai_requests
            ai_requests += 1
            return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "訂正文"}]}}]})

        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {"GEMINI_API_KEY": "test-key"}, httpx.MockTransport(ai_handle),
                                   httpx.MockTransport(editor_handle))
        await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
        await wait_until(lambda: workflow.connections.status().state == "live")
        relay.ai_settings(AiSettings(strategy="manual"))
        stopping = asyncio.create_task(workflow.stop())
        try:
            await asyncio.wait_for(departing.wait(), 1)
            workflow.source_event(SourceEvent(utterance_id="closing", revision=1, text="終了中の字幕", source_event_id="closing-1"))
            await asyncio.sleep(0)
            assert ai_requests == 0
            assert relay.caption("closing").ai_status == "failed"
        finally:
            release.set()
            await stopping
        assert workflow._tasks == {}
    asyncio.run(verify())


@pytest.mark.parametrize("status", [401, 403, 404])
def test_editor_permanent_http_rejection_stops_without_retry_or_private_message(status):
    async def verify():
        requests = 0

        def handle(_):
            nonlocal requests
            requests += 1
            return httpx.Response(status, text="private upstream rejection")

        editor = UdtalkEditor(decode_editor_url(editor_url()), lambda *_: None, httpx.MockTransport(handle))
        editor.start()
        try:
            await asyncio.wait_for(editor._task, 0.2)
            assert editor.status.state == "failed"
            assert requests == 1
            assert "private" not in editor.status.model_dump_json()
        finally:
            await editor.stop()
    asyncio.run(verify())


def test_editor_transient_http_failure_still_retries():
    async def verify():
        server = NativeServer()
        requests = 0

        def handle(request):
            nonlocal requests
            if request.url.path == "/push/initialize/":
                requests += 1
                if requests == 1:
                    return httpx.Response(503)
            return server.handle(request)

        editor = UdtalkEditor(decode_editor_url(editor_url()), lambda *_: None, httpx.MockTransport(handle))
        editor.start()
        try:
            await wait_until(lambda: editor.status.state == "retrying")
            await wait_until(lambda: editor.status.state == "live")
            assert requests == 2
        finally:
            await editor.stop()
    asyncio.run(verify())
