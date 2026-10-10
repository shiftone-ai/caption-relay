import json
import subprocess
import sys
import shutil

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
