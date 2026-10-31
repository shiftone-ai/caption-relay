from fastapi.testclient import TestClient
import pytest
from starlette.websockets import WebSocketDisconnect

from app.desktop import DesktopBoundary
from app.main import create_app


def test_desktop_login_keeps_operator_api_private_and_preserves_real_caption_flow() -> None:
    with TestClient(DesktopBoundary(create_app(), "test-session", 24751), base_url="http://127.0.0.1:24751") as client:
        assert client.get("/api/session").status_code == 403
        assert client.get("/_desktop/start?token=wrong").status_code == 403
        login = client.get("/_desktop/start?token=test-session", follow_redirects=False)
        assert login.status_code == 303
        assert login.headers["location"] == "/"
        assert "HttpOnly" in login.headers["set-cookie"]
        assert "SameSite=strict" in login.headers["set-cookie"]
        event = client.post("/api/source/events", json={"utterance_id": "desktop", "text": "動作確認です。", "is_final": True,
                                                         "revision": 1, "source_event_id": "desktop-1"})
        assert event.status_code == 200
        assert client.get("/api/view").json()["captions"][0]["text"] == "動作確認です。"
        assert client.get("/desktop/settings").status_code == 200
        assert client.get("/api/session", headers={"Host": "other.test:24751"}).status_code == 403
        assert client.post("/api/commands", headers={"Origin": "https://other.test"}, json={"command": "hide"}).status_code == 403


def test_desktop_receiver_retains_its_own_authentication_and_websocket_requires_session() -> None:
    with TestClient(DesktopBoundary(create_app(), "test-session", 24751), base_url="http://127.0.0.1:24751") as client:
        # It reaches the real receiver, which rejects a missing signature.
        assert client.get("/closedcaption/seq").text == '{"detail":"invalid receiver token"}'
        assert client.get("/closedcaption/other").status_code == 403
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/api/source/audio", headers={"Origin": "http://127.0.0.1:24751"}):
                pass
        assert error.value.code == 1008
