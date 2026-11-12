import numpy as np
import pytest

from app.audio.decode import (
    AudioTooLong,
    UndecodableAudio,
    UnsupportedAudioType,
    decode_audio,
    detect_format,
)
from tests.conftest import sine, wav_bytes


@pytest.mark.parametrize(
    ("head", "expected"),
    [
        (b"RIFF\x24\x00\x00\x00WAVEfmt ", "wav"),
        (b"fLaC\x00\x00\x00\x22", "flac"),
        (b"OggS\x00\x02\x00\x00", "ogg"),
        (b"ID3\x04\x00\x00\x00\x00", "mp3"),
        (b"\xff\xfb\x90\x64\x00\x00", "mp3"),  # MPEG-1 Layer III frame header
        (b"\xff\xe3\x18\xc4\x00\x00", "mp3"),  # MPEG-2.5 frame header (sync bits only)
        (b"RIFF\x24\x00\x00\x00AVI LIST", None),  # RIFF but not WAVE
        (b"\xff\xd8\xff\xe0JFIF", None),  # JPEG: 0xFF then 0xD8 has no sync bits
        (b"%PDF-1.7", None),
        (b"", None),
        (b"\xff", None),
    ],
)
def test_detect_format(head: bytes, expected: str | None) -> None:
    assert detect_format(head) == expected


def test_decode_mixes_to_mono_and_resamples_to_16k() -> None:
    stereo = np.stack([sine(2.0, rate=44_100), sine(2.0, rate=44_100, freq=880)], axis=1)
    samples, original_rate, duration = decode_audio(wav_bytes(stereo, 44_100), max_duration_s=60)
    assert original_rate == 44_100
    assert duration == pytest.approx(2.0, abs=1e-3)
    assert samples.ndim == 1
    assert samples.dtype == np.float32
    assert len(samples) == pytest.approx(32_000, abs=2)
    assert np.max(np.abs(samples)) <= 1.0


def test_decode_rejects_too_long() -> None:
    with pytest.raises(AudioTooLong):
        decode_audio(wav_bytes(sine(3.0, rate=8_000), 8_000), max_duration_s=2.0)


def test_decode_rejects_garbage_with_valid_magic() -> None:
    with pytest.raises(UndecodableAudio):
        decode_audio(b"RIFF\x00\x00\x00\x00WAVEnot really audio data", max_duration_s=60)


def test_decode_rejects_unknown_type() -> None:
    with pytest.raises(UnsupportedAudioType):
        decode_audio(b"hello, this is text", max_duration_s=60)
