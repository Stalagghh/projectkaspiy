"""YAMNet (AudioSet, 521 classes) run with the LiteRT interpreter (no TensorFlow needed).

The classification model takes exactly 15600 samples (0.975 s at 16 kHz) and returns
one score per AudioSet class. We slide that window over the clip with a hop of
0.48 s, as YAMNet itself does, and pad the last window with zeros.
"""

import csv
import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter

SAMPLE_RATE = 16_000
WINDOW_SAMPLES = 15_600  # 0.975 s, fixed by the model
HOP_SAMPLES = 7_680  # 0.48 s
MODEL_NAME = "yamnet"
# Source file: TF Hub "lite-model_yamnet_classification_tflite_1.tflite" (PLAN.md section 8).
MODEL_VERSION = "classification-tflite-1"


def file_sha256(path: Path) -> str:
    """SHA-256 of a file, so /healthz proves exactly which model file is loaded."""
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_class_names(path: Path) -> list[str]:
    """Read display names from yamnet_class_map.csv (columns: index, mid, display_name)."""
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    names = [row["display_name"] for row in rows]
    if not names:
        raise ValueError(f"class map {path} is empty")
    return names


def split_windows(samples: np.ndarray) -> list[tuple[int, np.ndarray]]:
    """Cut the clip into overlapping windows of 15600 samples with a hop of 7680.

    Returns (start_sample, window) pairs. A clip shorter than one window gives one
    zero-padded window; the last window is zero-padded to full length.
    """
    count = max(1, int(np.ceil(max(0, len(samples) - WINDOW_SAMPLES) / HOP_SAMPLES)) + 1)
    windows = []
    for i in range(count):
        start = i * HOP_SAMPLES
        chunk = samples[start : start + WINDOW_SAMPLES]
        if len(chunk) < WINDOW_SAMPLES:
            chunk = np.pad(chunk, (0, WINDOW_SAMPLES - len(chunk)))
        windows.append((start, chunk.astype(np.float32)))
    return windows


@dataclass(frozen=True)
class ModelInfo:
    name: str
    version: str
    sha256: str


class Yamnet:
    """Loaded YAMNet model. One interpreter, protected by a lock (it is not thread-safe)."""

    def __init__(self, model_path: Path, class_map_path: Path) -> None:
        if not model_path.is_file():
            raise FileNotFoundError(f"YAMNet model not found: {model_path}")
        if not class_map_path.is_file():
            raise FileNotFoundError(f"YAMNet class map not found: {class_map_path}")
        self.class_names = load_class_names(class_map_path)
        self.info = ModelInfo(MODEL_NAME, MODEL_VERSION, file_sha256(model_path))
        self._lock = threading.Lock()
        self._interpreter = Interpreter(model_path=str(model_path))

        # Check the input tensor: the classification model expects 15600 float32 samples.
        inp = self._interpreter.get_input_details()[0]
        if -1 in list(inp.get("shape_signature", inp["shape"])):
            self._interpreter.resize_tensor_input(inp["index"], [WINDOW_SAMPLES], strict=False)
        self._interpreter.allocate_tensors()
        inp = self._interpreter.get_input_details()[0]
        if int(np.prod(inp["shape"])) != WINDOW_SAMPLES or inp["dtype"] != np.float32:
            raise ValueError(f"unexpected YAMNet input tensor: shape={inp['shape']} dtype={inp['dtype']}")
        self._input_index = inp["index"]
        self._input_shape = tuple(int(d) for d in inp["shape"])

        out = self._interpreter.get_output_details()[0]
        if int(np.prod(out["shape"])) != len(self.class_names):
            raise ValueError(
                f"model has {int(np.prod(out['shape']))} outputs, class map has {len(self.class_names)} names"
            )
        self._output_index = out["index"]

    def score_window(self, window: np.ndarray) -> np.ndarray:
        """Run the model on one 15600-sample window; returns 521 scores in [0, 1]."""
        with self._lock:
            self._interpreter.set_tensor(self._input_index, window.reshape(self._input_shape))
            self._interpreter.invoke()
            scores = self._interpreter.get_tensor(self._output_index).reshape(-1).copy()
        return np.clip(scores.astype(np.float64), 0.0, 1.0)

    def score_clip(self, samples: np.ndarray) -> tuple[list[int], np.ndarray]:
        """Score every window of a clip. Returns (window start samples, scores[n_windows, 521])."""
        starts, rows = [], []
        for start, window in split_windows(samples):
            starts.append(start)
            rows.append(self.score_window(window))
        return starts, np.vstack(rows)
