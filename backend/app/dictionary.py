"""A local terminology dictionary; snapshots belong to one recognition/AI request."""

import os
from collections.abc import Mapping
from pathlib import Path
import tempfile

from .models import DictionarySnapshot, DictionaryUpdate


def dictionary_path(environment: Mapping[str, str]) -> Path:
    configured = environment.get("CAPTION_RELAY_DICTIONARY_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    base = environment.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base).expanduser() / "caption-relay" / "dictionary.json"


class DictionaryConflict(Exception):
    pass


class DictionaryStorageError(Exception):
    pass


class WordDictionary:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._snapshot = DictionarySnapshot()
        if path is not None and path.exists():
            try:
                if path.stat().st_size > 262144:
                    raise ValueError("dictionary too large")
                self._snapshot = DictionarySnapshot.model_validate_json(path.read_bytes())
            except (OSError, ValueError):
                raise DictionaryStorageError("保存済みの辞書を読み込めません。辞書ファイルを確認してください。") from None

    def snapshot(self) -> DictionarySnapshot:
        return self._snapshot.model_copy(deep=True)

    def keywords(self) -> list[str]:
        return [entry.term for entry in self._snapshot.entries if entry.enabled]

    def update(self, update: DictionaryUpdate) -> DictionarySnapshot:
        if update.base_revision != self._snapshot.revision:
            raise DictionaryConflict("別の画面で辞書が更新されました。保存済みの辞書を読み直してください。")
        snapshot = DictionarySnapshot(entries=update.entries, revision=self._snapshot.revision + 1)
        if self._path is not None:
            temporary: str | None = None
            try:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self._path.parent, delete=False) as output:
                    temporary = output.name
                    output.write(snapshot.model_dump_json(indent=2))
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self._path)
            except OSError:
                raise DictionaryStorageError("辞書を保存できませんでした。保存先と空き容量を確認してください。") from None
            finally:
                if temporary is not None:
                    try:
                        Path(temporary).unlink(missing_ok=True)
                    except OSError:
                        pass
        self._snapshot = snapshot.model_copy(deep=True)
        return self.snapshot()
