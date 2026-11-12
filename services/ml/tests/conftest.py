"""Shared test helpers. Tests never use the network.

Tests that need the YAMNet model are skipped when the model file is absent (CI has no model).
The model is looked up in YAMNET_MODEL_PATH / YAMNET_CLASS_MAP, then in <repo>/data/models/yamnet/.
"""

import io
import os
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

REPO_ROOT = Path(__file__).resolve().parents[3]
LOCAL_MODEL_DIR = REPO_ROOT / "data" / "models" / "yamnet"


def model_paths() -> tuple[Path, Path]:
    model = Path(os.environ.get("YAMNET_MODEL_PATH", LOCAL_MODEL_DIR / "yamnet_classification.tflite"))
    class_map = Path(os.environ.get("YAMNET_CLASS_MAP", LOCAL_MODEL_DIR / "yamnet_class_map.csv"))
    return model, class_map


def model_available() -> bool:
    model, class_map = model_paths()
    return model.is_file() and class_map.is_file()


needs_model = pytest.mark.skipif(not model_available(), reason="YAMNet model file not available")


def wav_bytes(samples: np.ndarray, rate: int) -> bytes:
    """Encode float samples (mono 1-D or [frames, channels]) as a 16-bit WAV in memory."""
    buffer = io.BytesIO()
    sf.write(buffer, samples, rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def sine(seconds: float, rate: int = 16_000, freq: float = 440.0, amplitude: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)
