import json
import subprocess
import sys
import shutil
import struct

import pytest

from app.transcription.apple import HELPER


@pytest.mark.skipif(sys.platform != "darwin", reason="SpeechAnalyzer requires macOS")
def test_native_helper_probes_without_microphone_or_api_keys():
    if not HELPER.exists():
        if not shutil.which("xcrun"):
            pytest.skip("The macOS 26 SDK is unavailable")
        sdk = subprocess.run(["xcrun", "--sdk", "macosx", "--show-sdk-version"], capture_output=True)
        if sdk.returncode or int(sdk.stdout.split(b".")[0]) < 26:
            pytest.skip("The macOS 26 SDK is unavailable")
        pytest.fail("Build the native helper before running macOS checks")
    result = subprocess.run([str(HELPER), "--probe"], capture_output=True, timeout=10, check=True)
    response = json.loads(result.stdout)
    assert isinstance(response["available"], bool)
    assert isinstance(response["japanese_installed"], bool)
    assert result.stderr == b""


@pytest.mark.skipif(sys.platform != "darwin", reason="SpeechAnalyzer requires macOS")
def test_native_helper_accepts_dictionary_context_without_a_microphone():
    if not HELPER.exists():
        pytest.skip("Build the native helper first")
    probe = subprocess.run([str(HELPER), "--probe"], capture_output=True, timeout=10, check=True)
    if not json.loads(probe.stdout)["japanese_installed"]:
        pytest.skip("The Japanese model is unavailable")
    config = json.dumps({"keywords": ["Caption Relay", "星見台科学館"]}, ensure_ascii=False).encode()
    silence = b"\x00\x00" * 2400
    data = struct.pack("!I", len(config)) + config + (struct.pack("!I", len(silence)) + silence) * 5
    response = subprocess.run([str(HELPER)], input=data, capture_output=True, timeout=20, check=True)
    packets = [json.loads(line) for line in response.stdout.splitlines()]
    assert packets[0]["type"] == "ready"
    assert all(packet["type"] in {"ready", "result"} for packet in packets)
    assert response.stderr == b""
