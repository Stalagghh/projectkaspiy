"""Full classification pipeline: bytes -> samples -> YAMNet windows -> labels, events, summary."""

import numpy as np

from app.audio import mapping
from app.audio.decode import TARGET_SAMPLE_RATE, decode_audio
from app.audio.mapping import LabelMap
from app.audio.spectrogram import spectrogram_base64
from app.audio.yamnet import WINDOW_SAMPLES, Yamnet


def classify_bytes(
    data: bytes,
    model: Yamnet,
    label_map: LabelMap,
    top_k: int,
    with_spectrogram: bool,
    max_duration_s: float,
) -> dict:
    """Classify one uploaded clip. Returns a dict shaped like ClassifyResponse (without "model")."""
    samples, _original_rate, duration_s = decode_audio(data, max_duration_s)
    starts, scores = model.score_clip(samples)

    per_window = [mapping.label_scores(row, label_map) for row in scores]
    spans = [
        (
            round(start / TARGET_SAMPLE_RATE, 3),
            round(min(start + WINDOW_SAMPLES, len(samples)) / TARGET_SAMPLE_RATE, 3),
        )
        for start in starts
    ]
    windows = [
        {
            "startS": start_s,
            "endS": end_s,
            "scores": label_scores,
            "topK": mapping.top_k(row, model.class_names, top_k),
        }
        for (start_s, end_s), label_scores, row in zip(spans, per_window, scores, strict=True)
    ]
    events = mapping.find_events(per_window, spans, label_map.thresholds)
    label, confidence, best_window = mapping.summarize(per_window, label_map.thresholds)
    confidence = float(np.clip(confidence, 0.0, 1.0))

    return {
        "durationS": round(duration_s, 3),
        "sampleRate": TARGET_SAMPLE_RATE,
        "windows": windows,
        "events": events,
        "summary": {
            "label": label,
            "confidence": confidence,
            "qualitative": mapping.qualitative(confidence),
            "topK": mapping.top_k(scores[best_window], model.class_names, top_k),
        },
        "thresholds": dict(label_map.thresholds),
        "spectrogramPng": spectrogram_base64(samples) if with_spectrogram else None,
    }
