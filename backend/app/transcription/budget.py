"""Persist only trial usage, reserving a conservative cost before audio leaves."""

import fcntl
import math
import os
from pathlib import Path

from pydantic import Field

from ..models import Model
from .openai import TranscriptionError


class TrialUsage(Model):
    sent_samples: int = Field(default=0, ge=0)
    estimated_micro_yen: int = Field(default=0, ge=0)


class TrialBudget:
    # The approved trial is cumulative, with 10 yen reserved for closing/rounding.
    MAX_SAMPLES = 24_000 * 20 * 60
    MAX_MICRO_YEN = 90_000_000

    def __init__(self, path: Path, *, yen_per_usd: float) -> None:
        if not math.isfinite(yen_per_usd) or yen_per_usd <= 0:
            raise TranscriptionError("試験費用の円換算を設定してください。")
        self._path = path
        self._yen_per_usd = yen_per_usd

    def usage(self) -> TrialUsage:
        try:
            if not self._path.exists():
                return TrialUsage()
            return TrialUsage.model_validate_json(self._path.read_bytes())
        except (OSError, ValueError):
            raise TranscriptionError("試験使用量を確認できません。設定を確認してください。") from None

    def reserve(self, samples: int) -> None:
        if samples <= 0:
            raise TranscriptionError("送信音声の長さを確認できませんでした。")
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            created = False
            try:
                fd = os.open(self._path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                created = True
            except FileExistsError:
                fd = os.open(self._path, os.O_RDWR | os.O_NOFOLLOW)
            with os.fdopen(fd, "r+", encoding="utf-8") as ledger:
                fcntl.flock(ledger, fcntl.LOCK_EX | fcntl.LOCK_NB)
                raw = ledger.read()
                usage = TrialUsage() if created else TrialUsage.model_validate_json(raw)
                # Includes a 2x allowance; conversion must already cover tax/region fees.
                cost = math.ceil(samples / (24_000 * 60) * 0.017 * self._yen_per_usd * 2 * 1_000_000)
                updated = TrialUsage(sent_samples=usage.sent_samples + samples,
                                     estimated_micro_yen=usage.estimated_micro_yen + cost)
                if updated.sent_samples > self.MAX_SAMPLES or updated.estimated_micro_yen > self.MAX_MICRO_YEN:
                    raise TranscriptionError("試験上限に達したため認識を停止しました。")
                ledger.seek(0)
                ledger.write(updated.model_dump_json())
                ledger.truncate()
                ledger.flush()
                os.fsync(ledger.fileno())
        except (OSError, ValueError):
            raise TranscriptionError("試験使用量を保存できないため認識を停止しました。") from None
