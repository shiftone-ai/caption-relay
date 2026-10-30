import asyncio
import json
import stat
from pathlib import Path

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import AiSettings, ConnectionSettings, SourceEvent
from app.relay import CaptionRelay
from app.room_store import RoomStorageError, RoomStore
from app.rooms import Rooms
from app.workflow import CaptionWorkflow
from test_udtalk_editor import NativeServer, editor_url, speech, wait_until


def create_room(client, name, background=""):
    response = client.post("/api/rooms", json={"name": name, "ai": {"background": background}})
    response.raise_for_status()
    return response.json()


def scope(room):
    return {"X-Caption-Relay-Room": room["id"], "X-Caption-Relay-Generation": str(room["generation"])}


def receive(client, room, text, identifier="same"):
    response = client.post("/api/source/events", headers=scope(room), json={
        "utterance_id": identifier, "revision": 1, "text": text, "source_event_id": identifier + "-1",
    })
    response.raise_for_status()
    return response.json()


def test_room_name_and_background_use_unicode_character_limits_and_keep_saved_settings():
    name, background = "𠮷" * 120, "𠮷" * 4000
    with TestClient(create_app(environment={})) as client:
        room = create_room(client, name, background)
        for invalid_name, invalid_background in ((name + "𠮷", background), (name, background + "𠮷")):
            response = client.put(f"/api/rooms/{room['id']}", json={"name": invalid_name, "ai": {"background": invalid_background}})
            assert response.status_code == 422
        saved = client.get(f"/api/rooms/{room['id']}").json()
        assert saved["name"] == name and saved["background"] == background


def test_switching_rooms_preserves_each_caption_and_background_but_rejects_old_tab_writes():
    with TestClient(create_app(environment={})) as client:
        first = create_room(client, "作家へのインタビュー", "写真と布の展示")
        second = create_room(client, "別のトーク", "街の記録")
        client.post(f"/api/rooms/{first['id']}/connect").raise_for_status()
        old = receive(client, first, "最初のルームの字幕")
        first_receiver = client.get("/api/connection", headers=scope(first)).json()["receiver_path"]
        client.post(f"/api/rooms/{second['id']}/connect").raise_for_status()
        receive(client, second, "別ルームの字幕")
        assert client.get("/api/events", headers=scope(first)).json()[0]["text"] == "最初のルームの字幕"
        assert client.get("/api/events", headers=scope(second)).json()[0]["text"] == "別ルームの字幕"
        assert client.get("/api/ai", headers=scope(second)).json()["settings"]["background"] == "街の記録"
        assert client.patch(f"/api/captions/{old['id']}", headers=scope(first), json={
            "text": "間違ったルームへの保存", "base_revision": old["revision"],
        }).status_code == 409
        assert client.post(first_receiver + "&seq=1&uttrId=old", headers={"content-type": "text/plain"}, content="遅れた入力").status_code == 403
        assert client.post(f"/api/rooms/{first['id']}/reset", json={"generation": first["generation"]}).status_code == 409
        client.post(f"/api/rooms/{first['id']}/connect").raise_for_status()
        assert client.get("/api/ai", headers=scope(first)).json()["settings"]["background"] == "写真と布の展示"
        assert client.get("/api/view", params={"room_id": second["id"]}).json()["captions"][0]["text"] == "別ルームの字幕"
        assert client.get("/api/rooms").json()["rooms"][0]["id"] == first["id"]


def test_room_bookmarks_settings_and_private_links_survive_restart_without_saving_captions(tmp_path):
    path = tmp_path / "rooms.json"
    server = NativeServer()
    url = editor_url()
    with TestClient(create_app(environment={}, room_store=RoomStore(path), editor_transport=httpx.MockTransport(server.handle))) as client:
        room = create_room(client, "保存するトーク", "会場と作品の背景")
        client.post(f"/api/rooms/{room['id']}/connect").raise_for_status()
        receive(client, room, "保存しない字幕")
        client.put("/api/display", headers=scope(room), json={"font_size": 72}).raise_for_status()
        client.put("/api/connection", headers=scope(room), json={"mode": "client", "editor_url": url}).raise_for_status()
        assert url not in client.get("/api/rooms").text
        assert url not in client.get(f"/api/rooms/{room['id']}").text
        assert "会場と作品" not in client.get("/api/view", params={"room_id": room["id"]}).text
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert url in path.read_text()
    assert "保存しない字幕" not in path.read_text()
    with TestClient(create_app(environment={}, room_store=RoomStore(path), editor_transport=httpx.MockTransport(server.handle))) as client:
        assert client.get("/api/rooms").json()["active_room_id"] is None
        assert client.get(f"/api/rooms/{room['id']}").json()["background"] == "会場と作品の背景"
        client.post(f"/api/rooms/{room['id']}/connect").raise_for_status()
        assert client.get("/api/events", headers=scope(room)).json() == []
        assert client.get("/api/session", headers=scope(room)).json()["display"]["font_size"] == 72
        assert any(route == "/push/signTalk/" for route, _ in server.requests)


def test_reset_clears_only_current_captions_rejects_replays_and_keeps_settings():
    relay = CaptionRelay()
    with TestClient(create_app(relay, environment={})) as client:
        room = client.get("/api/rooms/default").json()
        before = receive(client, room, "リセット前")
        client.put("/api/ai", headers=scope(room), json={"background": "残す背景"}).raise_for_status()
        client.put("/api/display", headers=scope(room), json={"font_size": 64}).raise_for_status()
        result = client.post("/api/rooms/default/reset", json={"generation": 0})
        result.raise_for_status()
        after = result.json()
        assert after["caption_count"] == 0 and after["generation"] == 1
        assert after["background"] == "残す背景"
        assert client.get("/api/events", headers=scope(room)).status_code == 409
        assert client.get("/api/session", headers=scope(room)).json()["code"] == "room_reset"
        assert client.get("/api/view", params={"room_id": "default"}).json()["captions"] == []
        assert client.get("/api/session", headers=scope(after)).json()["display"]["font_size"] == 64
        assert receive(client, after, "古い発話の再送")["status"] == "stale"
        new = receive(client, after, "新しい発話", "new")
        assert new["revision"] > before["revision"]
        assert client.get("/api/events", headers=scope(after)).json()[0]["text"] == "新しい発話"
        assert relay.ai_context(new["id"]).recent_utterances == []
        assert relay.ai_context(new["id"]).background == "残す背景"
        assert client.post("/api/rooms/default/reset", json={"generation": 0}).status_code == 409


def test_operator_session_identifies_an_inactive_room_without_reconnecting_it() -> None:
    with TestClient(create_app(environment={})) as client:
        old = client.get("/api/rooms/default").json()
        current = create_room(client, "現在の接続", "")
        client.post(f"/api/rooms/{current['id']}/connect").raise_for_status()
        response = client.get("/api/session", headers=scope(old))
        assert response.status_code == 409
        assert response.json()["code"] == "room_inactive"
        assert client.get("/api/rooms").json()["active_room_id"] == current["id"]


def test_reset_cancels_inflight_ai_before_clearing():
    async def verify():
        started = asyncio.Event()
        cancelled = asyncio.Event()
        async def ai_response(_):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        workflow = CaptionWorkflow(CaptionRelay(), None, {"OPENAI_API_KEY": "test-key"}, httpx.MockTransport(ai_response))
        rooms = Rooms(workflow, lambda: CaptionWorkflow(CaptionRelay(), None, {}), RoomStore())
        workflow.relay.ai_settings(AiSettings(strategy="manual"))
        workflow.source_event(SourceEvent(utterance_id="old", revision=1, text="原文", source_event_id="one"))
        await asyncio.wait_for(started.wait(), 1)
        result = await rooms.reset("default", 0)
        assert cancelled.is_set() and workflow._tasks == {}
        assert result.caption_count == 0 and workflow.relay.captions() == []
        assert workflow.source_event(SourceEvent(utterance_id="old", revision=2, text="遅延入力", source_event_id="two")).status == "stale"
        await rooms.stop()
    asyncio.run(verify())


def test_reset_does_not_edit_native_history_and_keeps_receiving_new_utterances():
    async def verify():
        server = NativeServer()
        workflow = CaptionWorkflow(CaptionRelay(), None, {}, editor_transport=httpx.MockTransport(server.handle))
        rooms = Rooms(workflow, lambda: CaptionWorkflow(CaptionRelay(), None, {}), RoomStore())
        rooms.start()
        try:
            await rooms.configure(None, None, ConnectionSettings(mode="client", editor_url=editor_url()))
            await wait_until(lambda: workflow.connections.status().state == "live")
            server.history.append(speech("リセット前の字幕"))
            await wait_until(lambda: len(workflow.relay.captions()) == 1)
            before = list(server.history)
            await rooms.reset("default", 0)
            assert server.history == before
            assert not any(route == "/push/editMessage/" for route, _ in server.requests)
            server.history.append(speech("リセット後の字幕", root="new"))
            await wait_until(lambda: len(workflow.relay.captions()) == 1)
            assert workflow.relay.captions()[0].text == "リセット後の字幕"
        finally:
            await rooms.stop()
    asyncio.run(verify())


def test_storage_failure_preserves_captions_and_reset_generation(tmp_path, monkeypatch):
    path = tmp_path / "rooms.json"
    with TestClient(create_app(environment={}, room_store=RoomStore(path))) as client:
        room = create_room(client, "保存失敗の確認")
        client.post(f"/api/rooms/{room['id']}/connect").raise_for_status()
        receive(client, room, "失敗しても残す字幕")
        before = path.read_bytes()
        def fail_replace(*_):
            raise OSError("storage unavailable")
        monkeypatch.setattr("app.room_store.os.replace", fail_replace)
        assert client.post(f"/api/rooms/{room['id']}/reset", json={"generation": 0}).status_code == 503
        assert client.get(f"/api/rooms/{room['id']}").json()["generation"] == 0
        assert client.get("/api/events", headers=scope(room)).json()[0]["text"] == "失敗しても残す字幕"
        assert path.read_bytes() == before


def test_leave_disconnects_current_room_and_stale_leave_cannot_disconnect_another():
    with TestClient(create_app(environment={})) as client:
        first = create_room(client, "一つ目")
        second = create_room(client, "二つ目")
        client.post(f"/api/rooms/{first['id']}/connect").raise_for_status()
        client.post(f"/api/rooms/{second['id']}/connect").raise_for_status()
        assert client.post(f"/api/rooms/{first['id']}/leave", json={"generation": 0}).status_code == 409
        assert client.get("/api/rooms").json()["active_room_id"] == second["id"]
        assert client.post(f"/api/rooms/{second['id']}/leave", json={"generation": 0}).json()["active_room_id"] is None
        assert client.post("/api/source/events", headers=scope(second), json={
            "utterance_id": "after-leave", "revision": 1, "text": "終了後の入力", "source_event_id": "after-leave",
        }).status_code == 409


def test_invalid_or_read_only_bookmarks_do_not_disconnect_the_current_room():
    with TestClient(create_app(environment={})) as client:
        before = client.get("/api/connection").json()
        for url in ("https://example.invalid/", editor_url(editOnly="0", readOnly="1")):
            result = client.post("/api/rooms", json={"name": "無効なリンク", "connection": {"mode": "client", "editor_url": url}})
            assert result.status_code == 422
            assert client.get("/api/connection").json() == before
        assert client.post("/api/rooms", json={"name": "   "}).status_code == 422
        assert client.get("/api/rooms/missing").status_code == 404


def test_corrupt_saved_rooms_are_not_overwritten(tmp_path):
    path = tmp_path / "rooms.json"
    path.write_text('{"rooms": "broken"}')
    with pytest.raises(RoomStorageError):
        RoomStore(path)
    assert json.loads(path.read_text()) == {"rooms": "broken"}


@pytest.mark.parametrize("use_default", [True, False])
def test_reconnecting_after_restart_restores_hidden_state_for_builtin_and_saved_rooms(tmp_path, use_default):
    path = tmp_path / "rooms.json"
    with TestClient(create_app(environment={}, room_store=RoomStore(path))) as client:
        room = client.get("/api/rooms/default").json() if use_default else create_room(client, "非表示で保存")
        client.post(f"/api/rooms/{room['id']}/connect").raise_for_status()
        client.post("/api/commands", headers=scope(room), json={"command": "hide"}).raise_for_status()
    with TestClient(create_app(environment={}, room_store=RoomStore(path))) as client:
        client.post(f"/api/rooms/{room['id']}/connect").raise_for_status()
        assert client.get("/api/session", headers=scope(room)).json()["visible"] is False
        receive(client, room, "再起動後の非公開字幕")
        public = client.get("/api/view", params={"room_id": room["id"]}).json()
        assert public["visible"] is False
        assert public["captions"] == []


def test_delete_room_removes_bookmark_and_captions_durably_and_frees_capacity(tmp_path: Path) -> None:
    from app.room_models import SavedRoom
    path = tmp_path / "rooms.json"
    store = RoomStore(path)
    for index in range(99):
        store.put(SavedRoom(id=f"saved-{index}", name=f"ルーム{index}"))
    with TestClient(create_app(environment={}, room_store=store)) as client:
        room = client.get("/api/rooms/saved-0").json()
        client.post("/api/rooms/saved-0/connect").raise_for_status()
        receive(client, room, "削除する字幕")
        client.post("/api/rooms/saved-0/leave", json={"generation": 0}).raise_for_status()
        assert client.post("/api/rooms", json={"name": "上限"}).status_code == 503
        deleted = client.delete("/api/rooms/saved-0", params={"generation": 0})
        assert deleted.status_code == 200
        assert len(deleted.json()["rooms"]) == 99
        assert client.get("/api/events", headers=scope(room)).status_code == 404
        assert client.get("/api/view", params={"room_id": room["id"]}).status_code == 404
        create_room(client, "空いた枠を使う")
    with TestClient(create_app(environment={}, room_store=RoomStore(path))) as client:
        assert client.get("/api/rooms/saved-0").status_code == 404
        assert len(client.get("/api/rooms").json()["rooms"]) == 100


def test_delete_rejects_default_active_and_stale_generation_without_losing_data() -> None:
    with TestClient(create_app(environment={})) as client:
        assert client.delete("/api/rooms/default", params={"generation": 0}).status_code == 409
        room = create_room(client, "保護するルーム")
        client.post(f"/api/rooms/{room['id']}/connect").raise_for_status()
        receive(client, room, "残す字幕")
        assert client.delete(f"/api/rooms/{room['id']}", params={"generation": 0}).status_code == 409
        client.post(f"/api/rooms/{room['id']}/reset", json={"generation": 0}).raise_for_status()
        client.post(f"/api/rooms/{room['id']}/leave", json={"generation": 1}).raise_for_status()
        assert client.delete(f"/api/rooms/{room['id']}", params={"generation": 0}).status_code == 409
        assert client.get(f"/api/rooms/{room['id']}").status_code == 200


def test_failed_delete_preserves_memory_and_saved_bookmark(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "rooms.json"
    with TestClient(create_app(environment={}, room_store=RoomStore(path))) as client:
        room = create_room(client, "保存に失敗しても残す")
        before = path.read_bytes()
        def fail_replace(*_args: object) -> None:
            raise OSError("storage unavailable")
        monkeypatch.setattr("app.room_store.os.replace", fail_replace)
        assert client.delete(f"/api/rooms/{room['id']}", params={"generation": 0}).status_code == 503
        assert client.get(f"/api/rooms/{room['id']}").status_code == 200
        assert path.read_bytes() == before


def test_delete_clears_and_closes_existing_audience_subscription() -> None:
    from app.room_models import RoomDraft
    async def verify() -> None:
        initial = CaptionWorkflow(CaptionRelay(), None, {})
        rooms = Rooms(initial, lambda: CaptionWorkflow(CaptionRelay(), None, {}), RoomStore())
        room = await rooms.save_room(RoomDraft(name="購読の終了"))
        await rooms.connect(room.id)
        target = rooms.workflow(room.id)
        target.source_event(SourceEvent(utterance_id="one", revision=1, text="削除前の字幕", source_event_id="one"))
        stream = target.relay.snapshots()
        assert (await anext(stream)).captions[0].text == "削除前の字幕"
        await rooms.leave(room.id, room.generation)
        await rooms.delete(room.id, room.generation)
        assert (await asyncio.wait_for(anext(stream), 1)).captions == []
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(anext(stream), 1)
        await rooms.stop()
    asyncio.run(verify())
