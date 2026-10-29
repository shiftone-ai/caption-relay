"""Run the local app with disposable data and no external integrations for browser tests."""

import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import uvicorn


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "backend"))
    with TemporaryDirectory(prefix="caption-relay-browser-") as temporary:
        state = Path(temporary)
        os.environ["CAPTION_RELAY_ROOMS_PATH"] = str(state / "rooms.json")
        os.environ["CAPTION_RELAY_DICTIONARY_PATH"] = str(state / "dictionary.json")
        os.environ.pop("CAPTION_RELAY_UDTALK_URL", None)
        from app.main import create_app

        application = create_app(environment={})
        uvicorn.run(application, host="127.0.0.1", port=24741, access_log=False, timeout_graceful_shutdown=5)


if __name__ == "__main__":
    main()
