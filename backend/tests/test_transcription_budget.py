from pathlib import Path

import pytest

from app.transcription.budget import TrialBudget
from app.transcription.openai import TranscriptionError


def test_cost_limit_survives_a_new_session_and_does_not_reset_usage(tmp_path: Path):
    path = tmp_path / "usage.json"
    first = TrialBudget(path, yen_per_usd=200)
    first.reserve(14_400_000)  # 10 minutes, USD 0.17, with a 2x cost allowance.
    second = TrialBudget(path, yen_per_usd=200)
    with pytest.raises(TranscriptionError, match="試験上限"):
        second.reserve(14_400_000)
    assert second.usage().sent_samples == 14_400_000
    assert second.usage().estimated_micro_yen == 68_000_000


def test_audio_time_limit_counts_silence_and_retries(tmp_path: Path):
    budget = TrialBudget(tmp_path / "usage.json", yen_per_usd=1)
    budget.reserve(28_800_000)
    with pytest.raises(TranscriptionError, match="試験上限"):
        budget.reserve(1)
    assert budget.usage().sent_samples == 28_800_000


def test_a_corrupt_ledger_cannot_start_a_fresh_trial(tmp_path: Path):
    path = tmp_path / "usage.json"
    path.write_text('{"sent_samples": -1}')
    with pytest.raises(TranscriptionError, match="確認できません"):
        TrialBudget(path, yen_per_usd=200).usage()


def test_an_empty_existing_ledger_cannot_reset_the_trial(tmp_path: Path):
    path = tmp_path / "usage.json"
    path.touch()
    with pytest.raises(TranscriptionError, match="保存できない"):
        TrialBudget(path, yen_per_usd=200).reserve(2400)
