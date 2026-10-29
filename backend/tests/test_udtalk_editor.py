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
from app.udtalk import WebMessage
from app.udtalk_editor import EditorError, UdtalkEditor, decode_editor_url
from app.workflow import CaptionWorkflow


def editor_url(*, wrapped=False, **overrides):
    info = {"talkId": "test-talk", "entryKey": "test-entry", "readOnly": "1", "editOnly": "1",
            "sharingLimit": time() + 3600, "userName": "試験専用", **overrides}
    padder = padding.PKCS7(128).padder()
    data = json.dumps(info).encode()
    data = padder.update(data) + padder.finalize()
    encryptor = Cipher(algorithms.AES(b"udtalk".ljust(32, b"\0")), modes.CBC(bytes(16))).encryptor()
    token = base64.b64encode(encryptor.update(data) + encryptor.finalize()).decode()
    if wrapped:
        token = "\r\n".join(token[index:index + 64] for index in range(0, len(token), 64))
    return "https://service.udtalk.jp/redirect.php?token=" + quote(token, safe="")


def speech(text="原文", *, root="speech:00", timestamp=1.0, sender="speaker"):
    return {"utteranceIdentifier": root, "phase": "finalized", "text": text, "type": 0,
            "endOfUtterance": True, "connected": {"timestamp": timestamp}, "timestamp": 1.0,
            "uniqueIdentifier": "speaker", "sendingUniqueIdentifier": sender, "localeIdentifier": "ja-JP"}


class NativeServer:
    def __init__(self, *, lock=True, update_on_lock=False, fail_edit=False, fail_edit_at=None):
        self.history = []
        self.requests = []
        self.lock = lock
        self.update_on_lock = update_on_lock
        self.fail_edit = fail_edit
        self.fail_edit_at = fail_edit_at
        self.edit_count = 0

    def handle(self, request):
        body = json.loads(request.content)
        self.requests.append((request.url.path, body))
        assert request.url.host == "app.udtalk.jp" and body["v"] == "0.0.1"
        route = request.url.path
        result = {"status": 1}
        if route == "/push/initialize/":
            result["users"] = {"id": 41}
        elif route == "/push/signTalk/":
            result["users"] = []
        elif route == "/pull/talkCurrent/":
            result.update(number=len(self.history), current=len(self.history))
        elif route == "/pull/talkMessage/":
            result.update(number=len(self.history), current=len(self.history), messages=[[
                {"meta": json.dumps(command)} for command in self.history[body["l"]:]
            ]], options=[[]])
        elif route == "/push/lockMessage/":
            if self.update_on_lock:
                identifier = body["lgid"].removesuffix("_test-talk")
                self.history.append(speech("別の編集者の訂正", root=identifier, timestamp=2.0, sender="other-editor"))
            result["result"] = self.lock
        elif route == "/push/unlockMessage/":
            result["result"] = True
        elif route == "/push/editMessage/":
            self.edit_count += 1
            if self.fail_edit or self.edit_count == self.fail_edit_at:
                return httpx.Response(503)
            command = json.loads(body["mt"])
            original = next((item for item in reversed(self.history)
                             if item["utteranceIdentifier"] == command["utteranceIdentifier"]), None)
            if original is None:
                return httpx.Response(200, json={"status": 5})
            assert command["uniqueIdentifier"] == "speaker" and command["timestamp"] == 1.0
            assert command["originalText"] == (original.get("originalText") or original["text"])
            assert command["sendingUniqueIdentifier"] != "speaker" and command["rid"] == "41"
            assert body["m"] == command["text"] and body["lgid"] == command["utteranceIdentifier"] + "_test-talk"
            assert set(body) == {"u", "t", "m", "l", "c", "lgid", "mt", "uuid", "bc", "v"}
            self.history.append(command)
            result.update(number=len(self.history), current=len(self.history))
        return httpx.Response(200, json=result)


async def wait_until(predicate):
    async with asyncio.timeout(4):
        while not predicate():
            await asyncio.sleep(0.01)


def test_repeated_save_uses_one_native_write_even_with_concurrent_retries() -> None:
    async def verify() -> None:
        server = NativeServer()
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(server.handle))
        workflow.start()
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech())
            await wait_until(lambda: len(relay.captions()) == 1)
            caption = relay.captions()[0]
            patch = CaptionPatch(text="訂正", base_revision=caption.revision,
                                 base_source_revision=caption.source_revision, request_id="repeat-save")
            first, second = await asyncio.gather(workflow.patch_caption(caption.id, patch), workflow.patch_caption(caption.id, patch))
            assert first == second
            assert server.edit_count == 1
            assert [edit.text for edit in relay.caption(caption.id).edit_history] == ["原文", "訂正"]
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            assert caption.id not in workflow.connections.status().editable_caption_ids
            assert await workflow.patch_caption(caption.id, patch) == first
            latest = relay.caption(caption.id)
            with pytest.raises(EditorError, match="接続中のUDトーク"):
                await workflow.patch_caption(caption.id, CaptionPatch(text="新しい訂正", base_revision=latest.revision,
                    base_source_revision=latest.source_revision, request_id="uncached-after-reconnect"))
            assert server.edit_count == 1
        finally:
            await workflow.stop()
    asyncio.run(verify())


def test_native_sharing_url_preserves_edit_only_permission_and_sharing_metadata():
    limit = time() - 3600
    parsed = decode_editor_url(editor_url(wrapped=True, readOnly=1, editOnly=1, sharingLimit=limit))
    assert parsed.talk_id == "test-talk" and parsed.entry_key == "test-entry"
    assert parsed.sharing_limit == limit


@pytest.mark.parametrize("overrides", [{"readOnly": "1", "editOnly": "0"}, {"sharingLimit": "nan"}])
def test_url_rejects_read_only_permission_and_invalid_metadata(overrides):
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


@pytest.mark.parametrize("fail_at", [None, 2])
def test_fragmented_caption_updates_existing_records_and_keeps_partial_results_visible(fail_at):
    async def verify():
        server = NativeServer(fail_edit_at=fail_at)
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(server.handle))
        workflow.start()
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.extend([speech("原", root="speech:00"), speech("文", root="speech:01")])
            await wait_until(lambda: len(relay.captions()) == 1 and relay.captions()[0].source_final)
            caption = relay.captions()[0]
            patch = CaptionPatch(text="訂正後", base_revision=caption.revision, base_source_revision=caption.source_revision)
            if fail_at is not None:
                with pytest.raises(EditorError, match="一部の訂正"):
                    await workflow.patch_caption(caption.id, patch)
                assert relay.caption(caption.id).text == "訂正後文"
            else:
                saved = await workflow.patch_caption(caption.id, patch)
                assert saved.text == "訂正後"
                saved = await workflow.patch_caption(saved.id, CaptionPatch(text="原文", base_revision=saved.revision,
                                                                           base_source_revision=saved.source_revision))
                assert saved.text == "原文"
            latest = {item["utteranceIdentifier"]: item for item in server.history}
            assert set(latest) == {"speech:00", "speech:01"}
            assert "".join(latest[key]["text"] for key in sorted(latest)) == ("原文" if fail_at is None else "訂正後文")
            locks = [body["lgid"] for path, body in server.requests if path == "/push/lockMessage/"]
            unlocks = [body["lgid"] for path, body in server.requests if path == "/push/unlockMessage/"]
            assert set(locks) == {"speech:00_test-talk", "speech:01_test-talk"}
            assert sorted(locks) == sorted(unlocks)
        finally:
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
        relay.ai_settings(AiSettings(strategy="manual", preferred_model="gemini-3.5-flash-lite"))
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
        relay.ai_settings(AiSettings(strategy="manual", preferred_model="gemini-3.5-flash-lite"))
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


def test_reconnecting_same_talk_keeps_new_corrections_and_rejects_old_drafts():
    async def verify():
        server = NativeServer()
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(server.handle))
        settings = ConnectionSettings(mode="client", editor_url=editor_url())
        workflow.start()
        try:
            await workflow.configure(settings)
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech())
            await wait_until(lambda: len(relay.captions()) == 1)
            before = relay.captions()[0]
            await workflow.configure(settings)
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech("再接続後の訂正", root="speech", timestamp=2.0, sender="other-editor"))
            await wait_until(lambda: workflow.connections.status().received_events == 1)
            latest = relay.captions()[-1]
            assert latest.original == "再接続後の訂正"
            assert latest.human_edited
            assert before.id not in workflow.connections.status().editable_caption_ids
            with pytest.raises(EditorError):
                await workflow.patch_caption(before.id, CaptionPatch(text="古い下書き", base_revision=before.revision))
            assert not any(route == "/push/editMessage/" for route, _ in server.requests)
            assert relay.caption(before.id).text == "原文"
        finally:
            await workflow.stop()
    asyncio.run(verify())


def test_inflight_receiver_body_cannot_cross_a_connection_change():
    async def verify():
        server = NativeServer()
        app = create_app(environment={}, editor_transport=httpx.MockTransport(server.handle))
        reached = asyncio.Event()
        release = asyncio.Event()

        async def body():
            reached.set()
            await release.wait()
            yield "古い接続の字幕".encode()

        async with app.router.lifespan_context(app), httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver",
        ) as client:
            path = (await client.get("/api/connection")).json()["receiver_path"]
            pending = asyncio.create_task(client.post(path + "&seq=1&uttrId=late", content=body(),
                                                     headers={"content-type": "text/plain"}))
            try:
                await reached.wait()
                assert (await client.put("/api/connection", json={"mode": "client", "editor_url": editor_url()})).status_code == 200
                assert (await client.put("/api/connection", json={"mode": "host"})).status_code == 200
                release.set()
                assert (await pending).status_code == 403
                assert (await client.get("/api/events")).json() == []
            finally:
                release.set()
                await pending
    asyncio.run(verify())


def test_ai_source_change_releases_editor_lock_with_yielding_transport():
    async def verify():
        server = NativeServer(update_on_lock=True)

        async def handle(request):
            await asyncio.sleep(0)
            return server.handle(request)

        ai = httpx.MockTransport(lambda _: httpx.Response(200, json={
            "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "AIの訂正"}]}}],
        }))
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {"GEMINI_API_KEY": "test-key"}, ai, httpx.MockTransport(handle))
        workflow.start()
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            relay.ai_settings(AiSettings(strategy="manual", preferred_model="gemini-3.5-flash-lite"))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech())
            await wait_until(lambda: bool(relay.captions()) and relay.captions()[0].human_edited)
            await wait_until(lambda: not workflow._tasks)
        finally:
            await workflow.stop()
        assert relay.captions()[0].text == "別の編集者の訂正"
        assert not any(route == "/push/editMessage/" for route, _ in server.requests)
        assert any(route == "/push/unlockMessage/" for route, _ in server.requests)
        notifications = [json.loads(body["mt"])["phase"] for route, body in server.requests if route == "/push/talkOption/"]
        assert "unlocked" in notifications
    asyncio.run(verify())


def test_unchanged_remote_save_protects_text_from_pending_ai():
    async def verify():
        server = NativeServer()
        release = asyncio.Event()

        async def ai_response(_):
            await release.wait()
            return httpx.Response(200, json={
                "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "AIの置換"}]}}],
            })

        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {"GEMINI_API_KEY": "test-key"}, httpx.MockTransport(ai_response),
                                   httpx.MockTransport(server.handle))
        workflow.start()
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            relay.ai_settings(AiSettings(strategy="manual", preferred_model="gemini-3.5-flash-lite"))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech())
            await wait_until(lambda: bool(relay.captions()) and relay.captions()[0].ai_status == "running")
            server.history.append(speech(root="speech", timestamp=2.0, sender="other-editor"))
            await wait_until(lambda: any(route == "/pull/talkMessage/" and body["l"] == 2 for route, body in server.requests))
            assert relay.captions()[0].human_edited
            release.set()
            await wait_until(lambda: not workflow._tasks)
            assert relay.captions()[0].text == "原文"
            assert not any(route == "/push/editMessage/" for route, _ in server.requests)
        finally:
            await workflow.stop()
    asyncio.run(verify())


@pytest.mark.parametrize("cancellations", [2, 3])
def test_repeated_save_cancellation_waits_for_lock_release(cancellations):
    async def verify():
        server = NativeServer()
        editing = asyncio.Event()
        unlocking = asyncio.Event()
        release = asyncio.Event()

        async def handle(request):
            if request.url.path == "/push/editMessage/":
                editing.set()
                await asyncio.Event().wait()
            if request.url.path == "/push/unlockMessage/":
                unlocking.set()
                await release.wait()
            return server.handle(request)

        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(handle))
        workflow.start()
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech())
            await wait_until(lambda: bool(relay.captions()))
            caption = relay.captions()[0]
            pending = asyncio.create_task(workflow.patch_caption(caption.id, CaptionPatch(text="訂正", base_revision=caption.revision)))
            await asyncio.wait_for(editing.wait(), 4)
            pending.cancel()
            await asyncio.wait_for(unlocking.wait(), 4)
            for _ in range(cancellations - 1):
                pending.cancel()
                await asyncio.sleep(0)
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert any(route == "/push/unlockMessage/" for route, _ in server.requests)
            assert relay.captions()[0].text == "原文"
        finally:
            release.set()
            await workflow.stop()
    asyncio.run(verify())


def test_fresh_remote_save_of_unchanged_native_text_updates_shared_choice():
    async def verify():
        server = NativeServer()
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(server.handle))
        workflow.start()
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech())
            await wait_until(lambda: bool(relay.captions()))
            server.history.append(speech("人が保存した本文", root="speech", timestamp=2.0, sender="other-editor"))
            await wait_until(lambda: relay.captions()[0].text == "人が保存した本文")
            server.history.append(speech("認識の更新", root="speech", timestamp=3.0))
            await wait_until(lambda: relay.captions()[0].original == "認識の更新")
            assert relay.captions()[0].text == "人が保存した本文"
            saved = speech("認識の更新", root="speech", timestamp=4.0, sender="other-editor")
            server.history.append(saved)
            await wait_until(lambda: any(route == "/pull/talkMessage/" and body["l"] == 4 for route, body in server.requests))
            assert relay.captions()[0].text == "認識の更新"
            revision = relay.captions()[0].source_revision
            server.history.append(saved)
            await wait_until(lambda: any(route == "/pull/talkMessage/" and body["l"] == 5 for route, body in server.requests))
            assert relay.captions()[0].source_revision == revision
        finally:
            await workflow.stop()
    asyncio.run(verify())


@pytest.mark.parametrize("single_batch", [False, True])
def test_human_save_followed_by_recognition_is_independent_of_poll_batch(single_batch):
    async def verify():
        relay = CaptionRelay()
        relay.connection_mode("client")
        def accept(event, edited):
            relay.source_event(event, remote_edit=edited)
        editor = UdtalkEditor(decode_editor_url(editor_url()), accept, httpx.MockTransport(NativeServer().handle))
        try:
            editor._receive([WebMessage(meta=json.dumps(speech()))])
            messages = [WebMessage(meta=json.dumps(command)) for command in [
                speech("人が保存した本文", root="speech", timestamp=2.0, sender="other-editor"),
                speech("後着の認識結果", root="speech", timestamp=3.0),
            ]]
            if single_batch:
                editor._receive(messages)
            else:
                for message in messages:
                    editor._receive([message])
            caption = relay.captions()[0]
            assert caption.text == "人が保存した本文"
            assert caption.original == "後着の認識結果"
            assert caption.human_edited
        finally:
            await editor.stop()
    asyncio.run(verify())


def test_invalid_editor_batch_does_not_partly_apply_a_human_save():
    async def verify():
        relay = CaptionRelay()
        def accept(event, edited):
            relay.source_event(event, remote_edit=edited)
        editor = UdtalkEditor(decode_editor_url(editor_url()), accept, httpx.MockTransport(NativeServer().handle))
        try:
            editor._receive([WebMessage(meta=json.dumps(speech()))])
            changed = WebMessage(meta=json.dumps(speech("訂正", root="speech", timestamp=2.0, sender="other-editor")))
            invalid = WebMessage(meta=json.dumps(speech(root="invalid:fragment")))
            with pytest.raises(EditorError):
                editor._receive([changed, invalid])
            assert relay.captions()[0].text == "原文"
            assert not relay.captions()[0].human_edited
            editor._receive([changed])
            assert relay.captions()[0].source_revision == 2
            assert relay.captions()[0].text == "訂正"
        finally:
            await editor.stop()
    asyncio.run(verify())


def test_cancelling_a_lock_response_still_releases_a_granted_lock():
    async def verify():
        server = NativeServer()
        granted = asyncio.Event()
        release_response = asyncio.Event()
        held = set()

        async def handle(request):
            response = server.handle(request)
            body = json.loads(request.content)
            if request.url.path == "/push/lockMessage/":
                held.add(body["lgid"])
                granted.set()
                await release_response.wait()
            elif request.url.path == "/push/unlockMessage/":
                held.discard(body["lgid"])
            return response

        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(handle))
        workflow.start()
        pending = None
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech())
            await wait_until(lambda: bool(relay.captions()))
            caption = relay.captions()[0]
            pending = asyncio.create_task(workflow.patch_caption(caption.id, CaptionPatch(text="訂正後", base_revision=caption.revision)))
            await asyncio.wait_for(granted.wait(), 4)
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(pending, 4)
            assert held == set()
            assert any(route == "/push/unlockMessage/" for route, _ in server.requests)
        finally:
            release_response.set()
            if pending is not None and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            await workflow.stop()
    asyncio.run(verify())


def test_lost_edit_response_is_reconciled_by_the_next_poll():
    async def verify():
        server = NativeServer()
        lost = False

        async def handle(request):
            nonlocal lost
            response = server.handle(request)
            if request.url.path == "/push/editMessage/" and not lost:
                lost = True
                raise httpx.ReadError("The service applied the edit, but its response was lost", request=request)
            return response

        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {}, editor_transport=httpx.MockTransport(handle))
        workflow.start()
        try:
            await workflow.configure(ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.extend([speech("原", root="speech:00"), speech("文", root="speech:01")])
            await wait_until(lambda: len(relay.captions()) == 1 and relay.captions()[0].source_final)
            caption = relay.captions()[0]
            with pytest.raises(EditorError):
                await workflow.patch_caption(caption.id, CaptionPatch(text="訂正後", base_revision=caption.revision,
                                                                      base_source_revision=caption.source_revision))
            await wait_until(lambda: any(route == "/pull/talkMessage/" and body["l"] == len(server.history)
                                        for route, body in server.requests))
            latest = {item["utteranceIdentifier"]: item for item in server.history}
            remote_text = "".join(latest[key]["text"] for key in sorted(latest))
            assert remote_text == "訂正後文"
            assert relay.caption(caption.id).text == remote_text
            assert relay.caption(caption.id).source_revision > caption.source_revision
        finally:
            await workflow.stop()
    asyncio.run(verify())


def test_unchanged_manual_save_reaches_a_peer_before_its_ai_can_overwrite():
    async def verify():
        server = NativeServer()
        release_ai = asyncio.Event()

        async def ai_response(_):
            await release_ai.wait()
            return httpx.Response(200, json={
                "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "別の参加者のAI訂正"}]}}],
            })

        first = CaptionWorkflow(CaptionRelay(), None, {}, editor_transport=httpx.MockTransport(server.handle))
        second = CaptionWorkflow(CaptionRelay(), None, {"GEMINI_API_KEY": "test-key"}, httpx.MockTransport(ai_response),
                                 httpx.MockTransport(server.handle))
        first.start()
        second.start()
        try:
            settings = ConnectionSettings(mode="client", editor_url=editor_url())
            await first.configure(settings)
            await second.configure(settings)
            await wait_until(lambda: first.connections.status().state == second.connections.status().state == "live")
            second.relay.ai_settings(AiSettings(strategy="manual", preferred_model="gemini-3.5-flash-lite"))
            server.history.append(speech())
            await wait_until(lambda: bool(first.relay.captions()) and bool(second.relay.captions())
                             and second.relay.captions()[0].ai_status == "running")
            caption = first.relay.captions()[0]
            saved = await first.patch_caption(caption.id, CaptionPatch(text=caption.text, base_revision=caption.revision,
                                                                     base_source_revision=caption.source_revision))
            release_ai.set()
            await wait_until(lambda: not second._tasks)
            assert saved.human_edited
            assert second.relay.captions()[0].human_edited
            assert second.relay.captions()[0].text == "原文"
            edits = [body for route, body in server.requests if route == "/push/editMessage/"]
            assert len(edits) == 1 and edits[0]["m"] == "原文"
        finally:
            release_ai.set()
            await first.stop()
            await second.stop()
    asyncio.run(verify())
