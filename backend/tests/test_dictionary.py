import asyncio
import json
from pathlib import Path

import httpx2 as httpx
import pytest
from fastapi.testclient import TestClient

from app.dictionary import DictionaryStorageError, WordDictionary, dictionary_path
from app.main import create_app
from app.models import AiSettings, DictionaryUpdate, SourceEvent
from app.relay import CaptionRelay
from app.workflow import CaptionWorkflow
from test_openai_transcription import ProviderSocket


def update(term="Caption Relay", revision=0):
    return DictionaryUpdate(base_revision=revision, entries=[{
        "term": term, "reading": "きゃぷしょんりれー", "variants": ["キャプションリレー"], "enabled": True,
    }])


def test_dictionary_path_accepts_empty_example_values_and_explicit_data_directory(tmp_path: Path):
    assert dictionary_path({"CAPTION_RELAY_DICTIONARY_PATH": ""}) == dictionary_path({})
    assert dictionary_path({"XDG_DATA_HOME": str(tmp_path)}) == tmp_path / "caption-relay" / "dictionary.json"
    assert dictionary_path({"CAPTION_RELAY_DICTIONARY_PATH": str(tmp_path / "custom.json")}) == tmp_path / "custom.json"


def test_dictionary_survives_restart_and_rejects_stale_saves_without_exposing_words(tmp_path: Path):
    path = tmp_path / "dictionary.json"
    with TestClient(create_app(environment={}, dictionary=WordDictionary(path))) as client:
        assert client.get("/api/dictionary").json() == {"entries": [], "revision": 0}
        response = client.put("/api/dictionary", json=update().model_dump())
        assert response.status_code == 200 and response.json()["revision"] == 1
        assert client.put("/api/dictionary", json=update("別の単語").model_dump()).status_code == 409
        assert "Caption Relay" not in client.get("/api/view").text
        assert "dictionary" not in client.get("/api/view").json()
    with TestClient(create_app(environment={}, dictionary=WordDictionary(path))) as client:
        saved = client.get("/api/dictionary").json()
        assert saved["revision"] == 1 and saved["entries"][0]["term"] == "Caption Relay"
        assert client.put("/api/dictionary", json={"base_revision": 1, "entries": []}).json()["revision"] == 2
    assert WordDictionary(path).snapshot().entries == []
    assert path.stat().st_mode & 0o077 == 0


@pytest.mark.parametrize("entries", [
    [{"term": "   "}], [{"term": "line\nbreak"}], [{"term": "<term>"}], [{"term": "x" * 81}],
    [{"term": "ABC"}, {"term": "ＡＢＣ"}], [{"term": "term", "enabled": "true"}],
    [{"term": "Straße"}, {"term": "STRASSE"}], [{"term": "ΟΣ"}, {"term": "ος"}], [{"term": "Ꭰ"}, {"term": "ꭰ"}],
    [{"term": "term", "variants": ["a", "a"]}], [{"term": "term", "variants": [" "]}],
    [{"term": "term", "variants": [str(i) for i in range(6)]}],
    [{"term": str(i)} for i in range(101)],
])
def test_dictionary_rejects_invalid_or_ambiguous_registration(entries):
    with TestClient(create_app(environment={})) as client:
        response = client.put("/api/dictionary", json={"base_revision": 0, "entries": entries})
        assert response.status_code == 422
        assert client.get("/api/dictionary").json()["entries"] == []


def test_dictionary_counts_supplementary_characters_and_keeps_saved_words_on_rejection():
    text = "𠮷" * 80
    with TestClient(create_app(environment={})) as client:
        response = client.put("/api/dictionary", json={"base_revision": 0, "entries": [{"term": text, "reading": text}]})
        assert response.status_code == 200
        assert response.json()["entries"][0]["term"] == text
        response = client.put("/api/dictionary", json={"base_revision": 1, "entries": [{"term": text + "𠮷"}]})
        assert response.status_code == 422
        assert client.get("/api/dictionary").json()["entries"][0]["term"] == text


def test_failed_atomic_save_preserves_memory_and_file(tmp_path: Path, monkeypatch):
    path = tmp_path / "words" / "dictionary.json"
    dictionary = WordDictionary(path)
    dictionary.update(update())
    previous = path.read_bytes()
    def failed_replace(*args):
        raise OSError("private storage error")
    monkeypatch.setattr("app.dictionary.os.replace", failed_replace)
    with pytest.raises(DictionaryStorageError, match="保存できません") as error:
        dictionary.update(update("変更後", 1))
    assert "private" not in str(error.value)
    assert dictionary.snapshot().entries[0].term == "Caption Relay"
    assert dictionary.snapshot().revision == 1 and path.read_bytes() == previous
    snapshot = dictionary.snapshot()
    snapshot.entries[0].term = "外から変更"
    assert dictionary.keywords() == ["Caption Relay"]
    assert list(path.parent.iterdir()) == [path]
    with TestClient(create_app(environment={}, dictionary=dictionary)) as client:
        response = client.put("/api/dictionary", json=update("変更後", 1).model_dump())
        assert response.status_code == 503 and "private" not in response.text


def test_corrupt_dictionary_is_reported_without_overwriting_it(tmp_path: Path):
    path = tmp_path / "words.json"
    path.write_text("invalid", encoding="utf-8")
    with pytest.raises(DictionaryStorageError, match="読み込めません"):
        WordDictionary(path)
    assert path.read_text() == "invalid"


def test_dictionary_contract_models_conflicts_and_storage_errors():
    schema = create_app(environment={}).openapi()
    responses = schema["paths"]["/api/dictionary"]["put"]["responses"]
    for status in ("409", "503"):
        assert responses[status]["content"]["application/json"]["schema"]["$ref"] == "#/components/schemas/DictionaryError"
    assert schema["components"]["schemas"]["DictionaryError"]["properties"]["detail"]["type"] == "string"


def test_queued_ai_uses_the_dictionary_at_reception_and_excludes_disabled_words():
    async def verify():
        dictionary = WordDictionary()
        dictionary.update(DictionaryUpdate(base_revision=0, entries=[{"term": "保存前の表記"}, {"term": "無効語", "enabled": False}]))
        requests = []
        def handle(request):
            body = json.loads(request.content)
            requests.append(body)
            return httpx.Response(200, json={"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "校正済み。"}]}], "usage": {"input_tokens": 10, "output_tokens": 5}})
        relay = CaptionRelay()
        workflow = CaptionWorkflow(relay, None, {"OPENAI_API_KEY": "test-key"}, httpx.MockTransport(handle), dictionary=dictionary)
        relay.ai_settings(AiSettings(strategy="manual", preferred_model="gpt-6-luna"))
        workflow.source_event(SourceEvent(utterance_id="old", revision=1, text="元の字幕", source_event_id="old"))
        # Update before the queued coroutine first runs.
        dictionary.update(update("変更後の表記", 1))
        workflow.source_event(SourceEvent(utterance_id="new", revision=1, text="次の字幕", source_event_id="new"))
        async with asyncio.timeout(2):
            while workflow._tasks:
                await asyncio.sleep(0.01)
        first, second = [json.loads(body["input"]) for body in requests]
        assert first["transcript"] == "元の字幕" and first["dictionary"][0]["term"] == "保存前の表記"
        assert len(first["dictionary"]) == 1
        assert second["dictionary"][0]["term"] == "変更後の表記"
        assert relay.caption("old").original == "元の字幕"
        assert "保存前の表記" not in requests[0]["instructions"]
        assert "無条件で置換しません" in requests[0]["instructions"]
        await workflow.stop()
    asyncio.run(verify())


def test_microphone_takes_enabled_keywords_at_each_start(tmp_path: Path):
    peers = []
    async def connector(key):
        peer = ProviderSocket()
        peers.append(peer)
        return peer
    dictionary = WordDictionary()
    dictionary.update(DictionaryUpdate(base_revision=0, entries=[{"term": "開始時の単語"}, {"term": "無効語", "enabled": False}]))
    env = {"CAPTION_RELAY_OPENAI_API_KEY": "test-key", "CAPTION_RELAY_STT_JPY_PER_USD": "200",
           "CAPTION_RELAY_STT_USAGE_PATH": str(tmp_path / "usage.json")}
    with TestClient(create_app(environment=env, audio_connector=connector, dictionary=dictionary)) as client:
        client.put("/api/connection", json={"input_source": "microphone", "recognizer": "openai"}).raise_for_status()
        for index in range(2):
            with client.websocket_connect("/api/source/audio", headers={"origin": "http://testserver"}) as audio:
                audio.send_json({"type": "start", "recognizer": "openai", "sample_rate": 48000, "channels": 1, "format": "pcm16"})
                assert audio.receive_json()["status"]["state"] == "preparing"
                assert audio.receive_json()["status"]["state"] == "live"
                keywords = peers[index].sent[0]["session"]["audio"]["input"]["transcription"]["keywords"]
                assert keywords == (["開始時の単語"] if index == 0 else ["次の単語"])
                if index == 0:
                    client.put("/api/dictionary", json=update("次の単語", 1).model_dump()).raise_for_status()
                    assert peers[index].sent[0]["session"]["audio"]["input"]["transcription"]["keywords"] == ["開始時の単語"]
                audio.send_json({"type": "stop"})
                assert audio.receive_json()["status"]["state"] == "stopped"
            assert peers[index].closed
