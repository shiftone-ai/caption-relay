from fastapi.testclient import TestClient

from app.main import create_app
from app.zoom_input import ZoomInput


def test_speaker_format_is_opt_in_and_preserves_slashes_in_text():
    plain = ZoomInput()
    event = plain.decode(1, "plain", "ja-JP", "資料 / 会場の案内です。")
    assert event is not None and event.text == "資料 / 会場の案内です。" and event.speaker is None
    named = ZoomInput("speaker")
    for seq, body, name, text, removed in [
        (1, "司会 / 資料 / 会場の案内です。", "司会", "資料 / 会場の案内です。", False),
        (2, "[Edited] 司会 / 会場を案内します。", "司会", "会場を案内します。", False),
        (3, "/ 名前のない字幕", None, "名前のない字幕", False),
        (4, "形式を含まない字幕", None, "形式を含まない字幕", False),
        (5, "[Edited] 司会 / ", "司会", "", True),
        (6, "[Edited] / ", None, "", True),
    ]:
        event = named.decode(seq, "speech", "ja-JP", body)
        assert event is not None
        assert (event.speaker, event.text, event.removed) == (name, text, removed)
    assert named.decode(6, "speech", "ja-JP", "[Edited] / ") is None


def test_named_zoom_reception_configuration_and_publication():
    with TestClient(create_app(environment={})) as client:
        before = client.get("/api/connection").json()
        path = before["receiver_path"]
        response = client.put("/api/connection", json={"mode": "host", "zoom_text_format": "speaker"})
        assert response.status_code == 200
        assert response.json()["receiver_path"] == path
        assert client.get("/api/connection").json()["zoom_text_format"] == "speaker"
        for seq, body in [(1, "司会 / ご案内です。"), (2, "[Edited] 登壇者 / ご案内です。")]:
            assert client.post(path + f"&seq={seq}&uttrId=speech", content=body,
                               headers={"content-type": "text/plain"}).status_code == 200
        caption = client.get("/api/events").json()[0]
        assert caption["speaker"] == "登壇者" and caption["original"] == "ご案内です。"
        public = client.get("/api/view").json()["captions"][0]
        assert public["speaker"] == "登壇者" and public["text"] == "ご案内です。"
        assert client.patch("/api/captions/" + caption["id"], json={"text": "訂正した本文", "base_revision": caption["revision"]}).status_code == 200
        assert client.get("/api/view").json()["captions"][0]["speaker"] == "登壇者"
        switched = client.put("/api/connection", json={"mode": "host", "zoom_text_format": "plain"}).json()
        assert switched["receiver_path"] == path and switched["received_events"] == 2
        assert client.post(path + "&seq=3&uttrId=other", content="資料 / 説明",
                           headers={"content-type": "text/plain"}).status_code == 200
        assert client.get("/api/view").json()["captions"][-1]["text"] == "資料 / 説明"
        assert client.get("/api/view").json()["captions"][-1]["speaker"] is None


def test_zoom_receive_retry_edit_cancel_and_manual_protection():
    with TestClient(create_app(environment={})) as client:
        path = client.get("/api/connection").json()["receiver_path"]
        signature = path.split("signature=")[1]
        seq_path = "/closedcaption/seq?signature=" + signature
        assert client.get(seq_path).text == "0"
        first_path = path + "&seq=1&lang=ja-JP&uttrId=speech"
        first = client.post(first_path, content="えー、本日はありがとうございます。\n", headers={"content-type": "text/plain"})
        assert first.status_code == 200 and "T" in first.text
        assert client.post(first_path, content="えー、本日はありがとうございます。\n", headers={"content-type": "text/plain"}).status_code == 200
        assert len(client.get("/api/events").json()) == 1
        assert client.post(first_path, content="異なる再送", headers={"content-type": "text/plain"}).status_code == 400
        assert client.post(path + "&seq=2&lang=ja-JP&uttrId=speech", content="[Edited] 本日はありがとうございます。", headers={"content-type": "text/plain"}).status_code == 200
        caption = client.get("/api/events").json()[0]
        assert caption["source_revision"] == 2
        assert client.get("/api/view").json()["captions"][0]["text"] == "本日はありがとうございます。"
        assert client.patch("/api/captions/" + caption["id"], json={"text": "人が保存した字幕", "base_revision": caption["revision"]}).status_code == 200
        assert client.post(path + "&seq=3&lang=ja-JP&uttrId=speech", content="[Edited] ", headers={"content-type": "text/plain"}).status_code == 200
        assert client.get(seq_path).text == "3"
        assert client.get("/api/events").json()[0]["original"] == ""
        assert client.get("/api/view").json()["captions"][0]["text"] == "人が保存した字幕"
        assert client.post(path + "&seq=4&lang=ja-JP&uttrId=other", content="別の発話", headers={"content-type": "text/plain"}).status_code == 200
        assert client.post(path + "&seq=5&lang=ja-JP&uttrId=other", content="[Edited] ", headers={"content-type": "text/plain"}).status_code == 200
        assert len(client.get("/api/view").json()["captions"]) == 1
        assert signature not in client.get("/api/view").text


def test_receiver_requires_token_utf8_and_plain_text_without_advancing_sequence():
    with TestClient(create_app(environment={})) as client:
        path = client.get("/api/connection").json()["receiver_path"]
        assert client.get("/closedcaption/seq").status_code == 403
        assert client.post("/closedcaption?seq=1&uttrId=a", content="字幕", headers={"content-type": "text/plain"}).status_code == 403
        assert client.post(path + "&seq=1&uttrId=a", content=b"\xff", headers={"content-type": "text/plain"}).status_code == 400
        assert client.post(path + "&seq=1&uttrId=a", json={"text": "字幕"}).status_code == 415
        assert client.post(path + "&seq=1&uttrId=a", content="a" * 65537, headers={"content-type": "text/plain"}).status_code == 413
        assert client.get("/api/events").json() == []


def test_invalid_editor_link_keeps_existing_receiver_and_history():
    with TestClient(create_app(environment={})) as client:
        before = client.get("/api/connection").json()
        response = client.put("/api/connection", json={"mode": "client", "editor_url": "https://live.udtalk.jp/" + "a" * 64})
        assert response.status_code == 422
        assert "live.udtalk" not in response.text
        assert client.get("/api/connection").json() == before


def test_out_of_order_new_speech_is_kept_but_older_correction_cannot_roll_back():
    with TestClient(create_app(environment={})) as client:
        path = client.get("/api/connection").json()["receiver_path"]
        for seq, utterance, text in [(2, "newer", "新しい字幕"), (1, "older", "遅れて届いた字幕"), (3, "newer", "[Edited] 最新の訂正"), (2, "other", "同じ番号で違う字幕")]:
            response = client.post(path + f"&seq={seq}&uttrId={utterance}", content=text, headers={"content-type": "text/plain"})
            assert response.status_code == (400 if utterance == "other" else 200)
        captions = client.get("/api/events").json()
        assert len(captions) == 2
        assert captions[0]["text"] == "最新の訂正"


def test_delayed_unseen_speech_is_kept_outside_the_retry_cache_window():
    with TestClient(create_app(environment={})) as client:
        path = client.get("/api/connection").json()["receiver_path"]
        for seq, utterance, text in [(200, "newer", "新しい字幕"), (1, "older", "遅れて届いた字幕"),
                                     (2, "newer", "[Edited] 古い訂正")]:
            response = client.post(path + f"&seq={seq}&uttrId={utterance}", content=text,
                                   headers={"content-type": "text/plain"})
            assert response.status_code == 200
        captions = client.get("/api/events").json()
        assert [caption["text"] for caption in captions] == ["新しい字幕", "遅れて届いた字幕"]
