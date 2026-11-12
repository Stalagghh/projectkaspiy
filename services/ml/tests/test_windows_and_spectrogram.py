import io

import numpy as np
import pytest
from PIL import Image

from app.audio.spectrogram import spectrogram_png
from app.audio.yamnet import HOP_SAMPLES, WINDOW_SAMPLES, split_windows


@pytest.mark.parametrize(
    ("length", "expected_windows"),
    [(0, 1), (100, 1), (15_600, 1), (15_601, 2), (15_600 + 7_680, 2), (15_600 + 7_681, 3), (160_000, 20)],
)
def test_window_count(length: int, expected_windows: int) -> None:
    assert len(split_windows(np.zeros(length, dtype=np.float32))) == expected_windows


def test_windows_have_fixed_size_hop_and_zero_padding() -> None:
    samples = np.arange(1, 20_001, dtype=np.float32)  # no zeros inside the signal
    windows = split_windows(samples)
    assert [start for start, _ in windows] == [0, HOP_SAMPLES]
    assert all(len(w) == WINDOW_SAMPLES for _, w in windows)
    _, last = windows[-1]
    real = 20_000 - HOP_SAMPLES
    assert np.all(last[:real] == samples[HOP_SAMPLES:])
    assert np.all(last[real:] == 0)  # padded with zeros


@pytest.mark.parametrize(("seconds", "width"), [(1.0, 100), (10.0, 1000), (30.0, 1600)])
def test_spectrogram_png_size(seconds: float, width: int) -> None:
    rng = np.random.default_rng(0)
    png = spectrogram_png(rng.uniform(-0.5, 0.5, int(seconds * 16_000)).astype(np.float32))
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    image = Image.open(io.BytesIO(png))
    assert image.size == (width, 160)
