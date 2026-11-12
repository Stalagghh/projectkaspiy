"""Log-mel spectrogram rendered to a PNG, with numpy and Pillow only (no matplotlib).

Parameters: 16 kHz audio, 25 ms window, 10 ms hop, 64 mel bands (125 Hz - 7.5 kHz,
the same range YAMNet uses). Time runs left to right, low frequencies at the bottom.
Colours ramp through the design palette from quiet (dark navy) to loud (orange).
"""

import base64
import io

import numpy as np
from PIL import Image

SAMPLE_RATE = 16_000
WIN = 400  # 25 ms
HOP = 160  # 10 ms
N_FFT = 512
N_MELS = 64
F_MIN, F_MAX = 125.0, 7500.0
HEIGHT = 160
PX_PER_SECOND = 100
MAX_WIDTH = 1600
DYNAMIC_RANGE_DB = 80.0
# Design tokens, quiet -> loud.
PALETTE = ["#07111C", "#12263A", "#1FA39A", "#CDBB94", "#FF6A13"]


def _hz_to_mel(hz: np.ndarray) -> np.ndarray:
    return 2595.0 * np.log10(1.0 + hz / 700.0)


def _mel_to_hz(mel: np.ndarray) -> np.ndarray:
    return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)


def mel_filterbank() -> np.ndarray:
    """Triangular mel filters, shape (N_MELS, N_FFT // 2 + 1)."""
    fft_freqs = np.linspace(0.0, SAMPLE_RATE / 2, N_FFT // 2 + 1)
    mel_points = np.linspace(_hz_to_mel(np.array(F_MIN)), _hz_to_mel(np.array(F_MAX)), N_MELS + 2)
    hz_points = _mel_to_hz(mel_points)
    bank = np.zeros((N_MELS, len(fft_freqs)))
    for m in range(N_MELS):
        left, centre, right = hz_points[m], hz_points[m + 1], hz_points[m + 2]
        rising = (fft_freqs - left) / (centre - left)
        falling = (right - fft_freqs) / (right - centre)
        bank[m] = np.maximum(0.0, np.minimum(rising, falling))
    return bank


def log_mel(samples: np.ndarray) -> np.ndarray:
    """Log-mel energies in dB, shape (N_MELS, n_frames)."""
    if len(samples) < WIN:
        samples = np.pad(samples, (0, WIN - len(samples)))
    n_frames = 1 + (len(samples) - WIN) // HOP
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n_frames)[:, None]
    frames = samples[idx] * np.hanning(WIN)[None, :]
    power = np.abs(np.fft.rfft(frames, n=N_FFT, axis=1)) ** 2
    mel = power @ mel_filterbank().T
    return (10.0 * np.log10(mel + 1e-10)).T


def _colormap(values: np.ndarray) -> np.ndarray:
    """Map values in [0, 1] to RGB by linear interpolation through PALETTE."""
    stops = np.array([[int(c[i : i + 2], 16) for i in (1, 3, 5)] for c in PALETTE], dtype=np.float64)
    pos = values * (len(stops) - 1)
    low = np.clip(np.floor(pos).astype(int), 0, len(stops) - 2)
    frac = (pos - low)[..., None]
    return (stops[low] * (1.0 - frac) + stops[low + 1] * frac).astype(np.uint8)


def spectrogram_png(samples: np.ndarray) -> bytes:
    """Render the log-mel spectrogram as PNG bytes (about 100 px per second, height 160)."""
    db = log_mel(samples.astype(np.float64))
    top = float(db.max())
    norm = np.clip((db - (top - DYNAMIC_RANGE_DB)) / DYNAMIC_RANGE_DB, 0.0, 1.0)
    rgb = _colormap(norm[::-1, :])  # flip so that low frequencies are at the bottom
    duration_s = len(samples) / SAMPLE_RATE
    width = int(min(MAX_WIDTH, max(1, round(duration_s * PX_PER_SECOND))))
    image = Image.fromarray(rgb).resize((width, HEIGHT), Image.Resampling.BILINEAR)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def spectrogram_base64(samples: np.ndarray) -> str:
    return base64.b64encode(spectrogram_png(samples)).decode("ascii")
