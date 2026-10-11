"""PCM conversion and local WebRTC speech boundaries; no audio is saved."""

from typing import Protocol

import numpy as np
import soxr
from webrtcvad import Vad

from .openai import TranscriptionError


class VoiceDetector(Protocol):
    def is_speech(self, buf: bytes, sample_rate: int) -> bool: ...


class PCMStream:
    def __init__(self, rate: int, output_rate: int = 24000) -> None:
        if rate < 8000 or rate > 96000:
            raise TranscriptionError("このマイクの音声形式には対応していません。")
        self._converter = soxr.ResampleStream(rate, output_rate, 1, dtype="int16", quality="LQ")
        self._finished = False

    def push(self, audio: bytes, *, last: bool = False) -> bytes:
        if self._finished or len(audio) % 2:
            raise TranscriptionError("マイクの音声形式を確認できませんでした。")
        self._finished = last
        result = self._converter.resample_chunk(np.frombuffer(audio, dtype="<i2"), last=last)
        return result.astype("<i2", copy=False).tobytes()


class SpeechTurns:
    def __init__(self, detector: VoiceDetector | None = None) -> None:
        self._detector = detector if detector is not None else Vad(2)
        self._converter = PCMStream(24000, 16000)
        self._buffer = bytearray()
        self.samples = 0
        self.voiced = False
        self._silence = 0

    def push(self, audio: bytes) -> bool:
        self.samples += len(audio) // 2
        self._buffer.extend(self._converter.push(audio))
        while len(self._buffer) >= 640:  # 20ms, mono 16kHz, signed PCM16.
            frame = bytes(self._buffer[:640])
            del self._buffer[:640]
            if self._detector.is_speech(frame, 16000):
                self.voiced = True
                self._silence = 0
            else:
                self._silence += 1
        return self.voiced and (self._silence >= 40 or self.samples >= 24000 * 15)

    def reset(self) -> None:
        self.samples = 0
        self.voiced = False
        self._silence = 0

    def finish(self) -> bool:
        self._buffer.extend(self._converter.push(b"", last=True))
        while len(self._buffer) >= 640:
            frame = bytes(self._buffer[:640])
            del self._buffer[:640]
            self.voiced = self.voiced or self._detector.is_speech(frame, 16000)
        return self.voiced and self.samples >= 2400
