"""Synthetic server responses exercise the adapter; they are not live UD proof."""

import asyncio
import base64
import json
from time import time
from urllib.parse import quote

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import AiSettings, CaptionPatch, ConnectionSettings
from app.relay import CaptionRelay, RevisionConflict
from app.udtalk_editor import EditorError, decode_editor_url
from app.workflow import CaptionWorkflow


def editor_url(**overrides):
    info = {"talkId": "test-talk", "entryKey": "test-entry", "readOnly": "0", "editOnly": "1",
            "sharingLimit": time() + 3600, "userName": "試験専用", **overrides}
    padder = padding.PKCS7(128).padder()
    data = json.dumps(info).encode()
    data = padder.update(data) + padder.finalize()
    encryptor = Cipher(algorithms.AES(b"udtalk".ljust(32, b"\0")), modes.CBC(bytes(16))).encryptor()
    token = base64.b64encode(encryptor.update(data) + encryptor.finalize()).decode()
    return "https://service.udtalk.jp/redirect.php?token=" + quote(token, safe="")


def speech(text="原文", *, root="speech:00", timestamp=1.0, sender="speaker"):
    return {"utteranceIdentifier": root, "phase": "finalized", "text": text, "type": 0,
            "endOfUtterance": True, "connected": {"timestamp": timestamp}, "timestamp": 1.0,
            "uniqueIdentifier": "speaker", "sendingUniqueIdentifier": sender, "localeIdentifier": "ja-JP"}


class NativeServer:
    def __init__(self, *, lock=True, update_on_lock=False, fail_edit=False):
        self.history = []
        self.requests = []
        self.lock = lock
        self.update_on_lock = update_on_lock
        self.fail_edit = fail_edit

    def handle(self, request):
        body = json.loads(request.content)
        self.requests.append((request.url.path, body))
        assert request.url.host == "app.udtalk.jp" and body["v"] == "0.0.1"
        route = request.url.path
        result = {"status": 1}
        if route == "/push/initialize/":
            result["users"] = {"id": 41}
        elif route == "/pull/talkCurrent/":
            result.update(number=len(self.history), current=len(self.history))
        elif route == "/pull/talkMessage/":
            result.update(number=len(self.history), current=len(self.history), messages=[[
                {"meta": json.dumps(command)} for command in self.history[body["l"]:]
            ]], options=[[]])
        elif route == "/push/lockMessage/":
            assert body["lgid"] == "speech_test-talk"
            if self.update_on_lock:
                self.history.append(speech("別の編集者の訂正", root="speech", timestamp=2.0, sender="other-editor"))
            result["result"] = self.lock
        elif route == "/push/unlockMessage/":
            result["result"] = True
        elif route == "/push/editMessage/":
            if self.fail_edit:
                return httpx.Response(503)
            command = json.loads(body["mt"])
            assert command["uniqueIdentifier"] == "speaker" and command["timestamp"] == 1.0
            assert command["utteranceIdentifier"] == "speech" and command["originalText"] == "原文"
            assert command["sendingUniqueIdentifier"] != "speaker" and command["rid"] == "41"
            assert body["m"] == command["text"] and body["lgid"] == "speech_test-talk"
            assert set(body) == {"u", "t", "m", "l", "c", "lgid", "mt", "uuid", "bc", "v"}
            self.history.append(command)
            result.update(number=len(self.history), current=len(self.history))
        return httpx.Response(200, json=result)


async def wait_until(predicate):
    async with asyncio.timeout(4):
        while not predicate():
            await asyncio.sleep(0.01)


@pytest.mark.parametrize("overrides", [{"readOnly": "1"}, {"sharingLimit": time() - 3600}, {"sharingLimit": "nan"}])
def test_url_respects_permission_and_expiry(overrides):
    with pytest.raises(EditorError):
        decode_editor_url(editor_url(**overrides))
    parsed = decode_editor_url(editor_url())
    assert parsed.talk_id == "test-talk" and parsed.entry_key == "test-entry"


@pytest.mark.parametrize("lock,update,fail", [(True, False, False), (False, False, False), (True, True, False), (True, False, True)])
def test_native_editor_participation_save_denial_race_and_failure(lock, update, fail):
    async def verify():
        server = NativeServer(lock=lock, update_on_lock=update, fail_edit=fail)
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(server.handle))
        workflow.start()
        await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
        await wait_until(lambda: workflow.connections.status().state == "live")
        server.history.append(speech())
        await wait_until(lambda: len(relay.captions()) == 1)
        caption = relay.captions()[0]
        patch = CaptionPatch(text="訂正した字幕", base_revision=caption.revision, base_source_revision=caption.source_revision)
        if update:
            with pytest.raises(RevisionConflict):
                await workflow.patch_caption(caption.id, patch)
        elif not lock or fail:
            with pytest.raises(EditorError):
                await workflow.patch_caption(caption.id, patch)
        else:
            saved = await workflow.patch_caption(caption.id, patch)
            assert saved.human_edited and saved.text == "訂正した字幕"
        edits = [body for path, body in server.requests if path == "/push/editMessage/"]
        assert bool(edits) == (lock and not update)
        assert relay.caption(caption.id).text == ("別の編集者の訂正" if update else "原文" if not lock or fail else "訂正した字幕")
        assert relay.public_snapshot().visible is False and relay.public_snapshot().captions == []
        if lock:
            assert any(path == "/push/unlockMessage/" for path, _ in server.requests)
        status = workflow.connections.status().model_dump_json()
        assert "test-entry" not in status and "token=" not in status
        old_signature = workflow.connections.receiver.token
        await workflow.configure(ConnectionSettings(mode="host"))
        assert len(relay.captions()) == 1
        assert relay.public_snapshot().captions == []
        assert workflow.connections.receiver.token != old_signature
        assert any(path == "/push/awayTalk/" for path, _ in server.requests)
        await workflow.stop()
    asyncio.run(verify())


def test_client_ai_writes_through_the_editor_and_never_publishes_to_local_audience():
    async def verify():
        server = NativeServer()
        relay = CaptionRelay()
        ai = httpx.MockTransport(lambda _: httpx.Response(200, json={
            "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "AIが訂正した字幕"}]}}],
        }))
        workflow = CaptionWorkflow(relay, None, {"GEMINI_API_KEY": "test-key"}, ai,
                                   httpx.MockTransport(server.handle))
        workflow.start()
        await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
        relay.ai_settings(AiSettings(strategy="manual"))
        await wait_until(lambda: workflow.connections.status().state == "live")
        server.history.append(speech())
        await wait_until(lambda: bool(relay.captions()) and relay.captions()[0].ai_status == "succeeded")
        caption = relay.captions()[0]
        assert caption.text == "AIが訂正した字幕" and not caption.human_edited
        assert any(path == "/push/editMessage/" and body["m"] == caption.text for path, body in server.requests)
        assert caption.published is False and caption.publish_eligible is False
        await workflow.configure(ConnectionSettings(mode="host"))
        assert relay.public_snapshot().captions == []
        await workflow.stop()
    asyncio.run(verify())


def test_mode_switch_cancels_inflight_ai_without_writing_to_the_previous_talk():
    async def verify():
        server = NativeServer()
        release = asyncio.Event()
        async def handle_ai(_):
            await release.wait()
            return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "遅い結果"}]}}]})
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {"GEMINI_API_KEY": "test-key"}, httpx.MockTransport(handle_ai),
                                   httpx.MockTransport(server.handle))
        workflow.start()
        await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
        relay.ai_settings(AiSettings(strategy="manual"))
        await wait_until(lambda: workflow.connections.status().state == "live")
        server.history.append(speech())
        await wait_until(lambda: bool(relay.captions()) and relay.captions()[0].ai_status == "running")
        await workflow.configure(ConnectionSettings(mode="host"))
        release.set()
        assert relay.captions()[0].text == "原文" and relay.captions()[0].ai_status == "failed"
        assert workflow._tasks == {}
        assert not any(path == "/push/editMessage/" for path, _ in server.requests)
        await workflow.stop()
    asyncio.run(verify())


def test_api_mode_switch_rejects_late_receiver_and_does_not_leak_editor_url():
    server = NativeServer()
    with TestClient(create_app(environment={}, editor_transport=httpx.MockTransport(server.handle))) as client:
        path = client.get("/api/connection").json()["receiver_path"]
        response = client.put("/api/connection", json={"mode": "client", "editor_url": editor_url()})
        assert response.status_code == 200
        assert response.json()["client_verified"] is False
        assert response.json()["receiver_path"] is None
        assert "test-entry" not in response.text
        assert client.post(path + "&seq=1&uttrId=late", content="古い接続の字幕", headers={"content-type": "text/plain"}).status_code == 403
        assert client.get("/api/events").json() == []
        assert client.put("/api/connection", json={"mode": "host"}).status_code == 200
