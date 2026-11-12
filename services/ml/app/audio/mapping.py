"""Map 521 YAMNet class scores to our labels and build events and a clip summary.

Everything here is plain arithmetic on score arrays, so it is easy to test without
the model file.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import yaml

EVENT_LABELS = ("boat_engine", "gunshot")


@dataclass(frozen=True)
class LabelMap:
    version: str
    # label -> indices of its AudioSet classes in the model output
    class_indices: dict[str, list[int]]
    # PRELIMINARY thresholds (see label_map.yaml)
    thresholds: dict[str, float]


def load_label_map(path: Path, class_names: list[str]) -> LabelMap:
    """Read label_map.yaml and resolve every class name to its index.

    Raises ValueError if a name is not in the class map, so a typo or a different
    model version stops the service at startup instead of silently scoring 0.
    """
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    position = {name: i for i, name in enumerate(class_names)}
    indices: dict[str, list[int]] = {}
    for label in EVENT_LABELS:
        names = config["labels"][label]
        missing = [n for n in names if n not in position]
        if missing:
            raise ValueError(f"label {label!r}: classes not in the YAMNet class map: {missing}")
        indices[label] = [position[n] for n in names]
    thresholds = {label: float(config["preliminary_thresholds"][label]) for label in EVENT_LABELS}
    return LabelMap(version=str(config["version"]), class_indices=indices, thresholds=thresholds)


def label_scores(window_scores: np.ndarray, label_map: LabelMap) -> dict[str, float]:
    """Scores of our labels for one window (521 AudioSet scores in)."""
    boat = float(np.max(window_scores[label_map.class_indices["boat_engine"]]))
    gun = float(np.max(window_scores[label_map.class_indices["gunshot"]]))
    return {"boat_engine": boat, "gunshot": gun, "background": 1.0 - max(boat, gun)}


def top_k(window_scores: np.ndarray, class_names: list[str], k: int) -> list[dict]:
    """The k AudioSet classes with the highest scores, best first."""
    order = np.argsort(-window_scores, kind="stable")[:k]
    return [{"name": class_names[i], "score": float(window_scores[i])} for i in order]


def find_events(
    per_window: list[dict[str, float]],
    spans: list[tuple[float, float]],
    thresholds: dict[str, float],
) -> list[dict]:
    """Merge windows whose label score is >= threshold into events.

    per_window[i] holds the label scores of window i; spans[i] is its (startS, endS).
    Consecutive windows above the threshold form one event. Windows overlap by half,
    so a window that starts before the current event ends (a one-window dip) is merged
    too; otherwise the timeline would show overlapping events of the same label.
    Each event keeps the peak score of its windows as its confidence.
    """
    events = []
    for label in EVENT_LABELS:
        current = None
        for scores, (start, end) in zip(per_window, spans, strict=True):
            if scores[label] < thresholds[label]:
                continue
            if current is not None and start <= current["endS"]:
                current["endS"] = max(current["endS"], end)
                current["confidence"] = max(current["confidence"], scores[label])
            else:
                if current is not None:
                    events.append(current)
                current = {"label": label, "confidence": scores[label], "startS": start, "endS": end}
        if current is not None:
            events.append(current)
    events.sort(key=lambda e: (e["startS"], e["label"]))
    return events


def qualitative(confidence: float) -> str:
    """Words for the dashboard: high >= 0.6, medium >= 0.35, otherwise low."""
    if confidence >= 0.6:
        return "high"
    if confidence >= 0.35:
        return "medium"
    return "low"


def summarize(per_window: list[dict[str, float]], thresholds: dict[str, float]) -> tuple[str, float, int]:
    """Clip-level verdict. Returns (label, confidence, index of the most telling window).

    Gunshot wins over boat engine because a missed shot costs more than a false alarm.
    background confidence = 1 - the highest event score anywhere in the clip.
    """
    gun = [w["gunshot"] for w in per_window]
    boat = [w["boat_engine"] for w in per_window]
    gun_peak, boat_peak = max(gun), max(boat)
    if gun_peak >= thresholds["gunshot"]:
        return "gunshot", gun_peak, int(np.argmax(gun))
    if boat_peak >= thresholds["boat_engine"]:
        return "boat_engine", boat_peak, int(np.argmax(boat))
    background = [w["background"] for w in per_window]
    return "background", 1.0 - max(gun_peak, boat_peak), int(np.argmax(background))
