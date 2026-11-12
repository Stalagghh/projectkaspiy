"""Turn uploaded bytes into 16 kHz mono float32 samples.

Steps: recognise the file type by its first bytes ("magic bytes"), decode it with
soundfile (libsndfile: wav, flac, ogg, mp3), mix all channels to mono and resample
to 16 kHz with soxr, which is the rate YAMNet was trained on.
"""

import io

import numpy as np
import soundfile as sf
import soxr

TARGET_SAMPLE_RATE = 16_000


class UnsupportedAudioType(Exception):
    """The first bytes do not match any supported audio format (HTTP 415)."""


class UndecodableAudio(Exception):
    """The file looks like audio but cannot be decoded (HTTP 422)."""


class AudioTooLong(Exception):
    """The clip is longer than the allowed maximum (HTTP 422)."""


def detect_format(data: bytes) -> str | None:
    """Return "wav", "flac", "ogg" or "mp3" from the file signature, or None if unknown."""
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[:4] == b"fLaC":
        return "flac"
    if data[:4] == b"OggS":
        return "ogg"
    if data[:3] == b"ID3":
        return "mp3"  # MP3 with an ID3 tag in front
    if len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        return "mp3"  # bare MPEG audio frame: 11 sync bits set
    return None


def decode_audio(data: bytes, max_duration_s: float) -> tuple[np.ndarray, int, float]:
    """Decode bytes into mono float32 samples at 16 kHz.

    Returns (samples, original_sample_rate, duration_seconds).
    Raises UnsupportedAudioType, UndecodableAudio or AudioTooLong.
    """
    if detect_format(data) is None:
        raise UnsupportedAudioType()
    try:
        with sf.SoundFile(io.BytesIO(data)) as f:
            original_rate = int(f.samplerate)
            # Check the declared length before decoding everything (cheap protection).
            if f.frames > 0 and f.frames / original_rate > max_duration_s + 0.5:
                raise AudioTooLong()
            audio = f.read(dtype="float32", always_2d=True)
    except AudioTooLong:
        raise
    except Exception as exc:  # libsndfile reports many different errors; all mean "cannot decode"
        raise UndecodableAudio() from exc

    if audio.size == 0 or original_rate <= 0:
        raise UndecodableAudio()
    duration_s = audio.shape[0] / original_rate
    if duration_s > max_duration_s:
        raise AudioTooLong()

    mono = audio.mean(axis=1).astype(np.float32)  # average the channels
    if original_rate != TARGET_SAMPLE_RATE:
        mono = soxr.resample(mono, original_rate, TARGET_SAMPLE_RATE).astype(np.float32)
    if not np.all(np.isfinite(mono)):
        raise UndecodableAudio()
    mono = np.clip(mono, -1.0, 1.0)  # YAMNet expects samples in [-1, 1]
    return mono, original_rate, float(duration_s)
