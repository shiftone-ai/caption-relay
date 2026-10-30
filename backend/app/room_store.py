"""Persist connection bookmarks privately; captions and API keys are never stored."""

import os
import tempfile
from collections.abc import Mapping
from pathlib import Path

from .room_models import RoomFile, SavedRoom


class RoomStorageError(Exception):
    pass


def rooms_path(environment: Mapping[str, str]) -> Path:
    configured = environment.get("CAPTION_RELAY_ROOMS_PATH", "").strip()
    base = environment.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(configured).expanduser() if configured else Path(base).expanduser() / "caption-relay" / "rooms.json"


class RoomStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self.restored = path is not None and path.exists()
        self._rooms: dict[str, SavedRoom] = {"default": SavedRoom(id="default", name="独立配信")}
        if path is not None and path.exists():
            try:
                if path.stat().st_size > 4194304:
                    raise ValueError("room file too large")
                data = RoomFile.model_validate_json(path.read_bytes())
                self._rooms = {room.id: room for room in data.rooms}
                self._rooms.setdefault("default", SavedRoom(id="default", name="独立配信"))
            except (OSError, ValueError):
                raise RoomStorageError("ルームの接続履歴を読み込めません。保存ファイルを確認してください。") from None

    def all(self) -> list[SavedRoom]:
        return [room.model_copy(deep=True) for room in self._rooms.values()]

    def get(self, room_id: str) -> SavedRoom:
        return self._rooms[room_id].model_copy(deep=True)

    def put(self, room: SavedRoom) -> None:
        records = {**self._rooms, room.id: room.model_copy(deep=True)}
        self._write(records)

    def remove(self, room_id: str) -> None:
        records = dict(self._rooms)
        del records[room_id]
        self._write(records)

    def _write(self, records: dict[str, SavedRoom]) -> None:
        try:
            data = RoomFile(rooms=list(records.values()))
        except ValueError:
            raise RoomStorageError("登録できるルームは100件までです。") from None
        if self._path is not None:
            temporary: str | None = None
            try:
                self._path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self._path.parent, delete=False) as output:
                    temporary = output.name
                    output.write(data.model_dump_json(indent=2))
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, self._path)
            except OSError:
                raise RoomStorageError("ルームの接続履歴を保存できません。保存先と空き容量を確認してください。") from None
            finally:
                if temporary is not None:
                    try:
                        Path(temporary).unlink(missing_ok=True)
                    except OSError:
                        pass
        self._rooms = records
