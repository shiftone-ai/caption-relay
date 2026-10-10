from fastapi.testclient import TestClient

from app.main import create_app
import math
from pathlib import Path
import secrets
import struct
import pytest
import sys
from starlette.websockets import WebSocketDisconnect

from test_openai_transcription import ProviderSocket


def test_microphone_selection_does_not_connect_and_disables_udtalk_input():
    with TestClient(create_app(environment={})) as client:
        previous = client.get("/api/connection").json()["receiver_path"]
        selected = client.put("/api/connection", json={"mode": "host", "input_source": "microphone", "recognizer": "openai"})
        assert selected.status_code == 200
        assert selected.json()["input_source"] == "microphone"
        assert selected.json()["transcription"]["state"] == "stopped"
        assert selected.json()["recognizers"][0]["available"] is False
        assert client.post(previous + "&seq=1&uttrId=other", content="別の入力", headers={"content-type": "text/plain"}).status_code == 403
        assert client.post("/api/source/events", json={"utterance_id": "other", "revision": 1,
                                                     "text": "別の入力", "source_event_id": "other"}).status_code == 409
        assert client.get("/api/events").json() == []


def test_start_without_a_repository_key_fails_without_recording_or_other_input():
    with TestClient(create_app(environment={})) as client:
        client.put("/api/connection", json={"mode": "host", "input_source": "microphone"}).raise_for_status()
        with client.websocket_connect("/api/source/audio", headers={"origin": "http://testserver"}) as audio:
            audio.send_json({"type": "start", "sample_rate": 48000, "channels": 1, "format": "pcm16"})
            state = audio.receive_json()
            assert state["type"] == "status" and state["status"]["state"] == "failed"
            assert "キー" in state["status"]["message"]
        assert client.get("/api/connection").json()["transcription"]["state"] == "failed"
        assert client.get("/api/events").json() == []


def test_audio_reaches_the_provider_and_final_captions_reach_the_audience(tmp_path: Path):
    peers = []
    async def connector(key):
        peer = ProviderSocket()
        peers.append(peer)
        return peer
    env = {"CAPTION_RELAY_OPENAI_API_KEY": secrets.token_hex(16), "CAPTION_RELAY_STT_JPY_PER_USD": "200",
           "CAPTION_RELAY_STT_USAGE_PATH": str(tmp_path / "usage.json")}
    with TestClient(create_app(environment=env, audio_connector=connector)) as client:
        client.put("/api/connection", json={"mode": "host", "input_source": "microphone"}).raise_for_status()
        with client.websocket_connect("/api/source/audio", headers={"origin": "http://testserver"}) as audio:
            audio.send_json({"type": "start", "sample_rate": 48000, "channels": 1, "format": "pcm16"})
            assert audio.receive_json()["status"]["state"] == "preparing"
            assert audio.receive_json()["status"]["state"] == "live"
            for frame in range(3):
                samples = [round(12000 * math.sin(2 * math.pi * 220 * (frame * 4800 + sample) / 48000)) for sample in range(4800)]
                audio.send_bytes(struct.pack("!II", frame, frame * 4800) + struct.pack("<4800h", *samples))
            audio.send_text(' { "type": "stop" } ')
            state = audio.receive_json()["status"]
            assert state["state"] == "stopped"
        assert [caption["text"] for caption in client.get("/api/view").json()["captions"]] == ["認識結果"]
        assert len(peers) == 1 and peers[0].closed
        assert len(peers[0].audio) == 14400  # 300ms at 24kHz, not at the capture rate.
        assert client.get("/api/connection").json()["transcription"]["sent_seconds"] == 0.3


def test_untrusted_origin_is_rejected_before_any_recognition_connection():
    with TestClient(create_app(environment={})) as client:
        client.put("/api/connection", json={"input_source": "microphone"}).raise_for_status()
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/source/audio", headers={"origin": "https://example.invalid"}):
                pass
        assert client.get("/api/connection").json()["transcription"]["state"] == "stopped"


def test_a_gap_stops_audio_and_releases_the_lease_without_publishing(tmp_path: Path):
    peers = []
    async def connector(key):
        peer = ProviderSocket()
        peers.append(peer)
        return peer
    env = {"CAPTION_RELAY_OPENAI_API_KEY": secrets.token_hex(16), "CAPTION_RELAY_STT_JPY_PER_USD": "200",
           "CAPTION_RELAY_STT_USAGE_PATH": str(tmp_path / "usage.json")}
    with TestClient(create_app(environment=env, audio_connector=connector)) as client:
        client.put("/api/connection", json={"input_source": "microphone"}).raise_for_status()
        with client.websocket_connect("/api/source/audio", headers={"origin": "http://testserver"}) as audio:
            audio.send_json({"type": "start", "sample_rate": 48000, "channels": 1, "format": "pcm16"})
            audio.receive_json()
            audio.receive_json()
            audio.send_bytes(struct.pack("!II", 1, 4800) + bytes(9600))
            state = audio.receive_json()["status"]
            assert state["state"] == "failed" and "欠けた" in state["message"]
        assert client.get("/api/view").json()["captions"] == []
        assert len(peers) == 1 and peers[0].closed and not peers[0].audio
        client.put("/api/connection", json={"input_source": "udtalk"}).raise_for_status()


def test_switching_input_closes_recognition_and_rejects_a_second_microphone(tmp_path: Path):
    peers = []
    async def connector(key):
        peer = ProviderSocket()
        peers.append(peer)
        return peer
    env = {"CAPTION_RELAY_OPENAI_API_KEY": secrets.token_hex(16), "CAPTION_RELAY_STT_JPY_PER_USD": "200",
           "CAPTION_RELAY_STT_USAGE_PATH": str(tmp_path / "usage.json")}
    with TestClient(create_app(environment=env, audio_connector=connector)) as client:
        client.put("/api/connection", json={"input_source": "microphone"}).raise_for_status()
        with client.websocket_connect("/api/source/audio", headers={"origin": "http://testserver"}) as first:
            first.send_json({"type": "start", "sample_rate": 48000, "channels": 1, "format": "pcm16"})
            assert first.receive_json()["status"]["state"] == "preparing"
            assert first.receive_json()["status"]["state"] == "live"
            with client.websocket_connect("/api/source/audio", headers={"origin": "http://testserver"}) as second:
                second.send_json({"type": "start", "sample_rate": 48000, "channels": 1, "format": "pcm16"})
                assert second.receive_json()["status"]["state"] == "failed"
            response = client.put("/api/connection", json={"input_source": "udtalk"})
            response.raise_for_status()
            assert first.receive_json()["status"]["state"] == "stopped"
            assert response.json()["input_source"] == "udtalk"
        assert len(peers) == 1 and peers[0].closed


@pytest.mark.skipif(sys.platform != "darwin", reason="SpeechAnalyzer requires macOS")
def test_native_apple_availability_is_offered_with_the_same_microphone_input():
    from app.transcription.apple import apple_option
    expected = apple_option()
    with TestClient(create_app(environment={})) as client:
        selected = client.put("/api/connection", json={"input_source": "microphone", "recognizer": "apple"})
        selected.raise_for_status()
        option = next(item for item in selected.json()["recognizers"] if item["id"] == "apple")
        assert option["available"] is expected.available
        assert selected.json()["recognizer"] == "apple"
