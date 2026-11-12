from pathlib import Path

import numpy as np
import pytest

from app.audio import mapping
from app.audio.mapping import LabelMap, load_label_map
from app.audio.yamnet import load_class_names
from tests.conftest import model_paths

LABEL_MAP = Path(__file__).resolve().parents[1] / "app" / "audio" / "label_map.yaml"
TARGET_NAMES = [
    "Gunshot, gunfire", "Machine gun", "Fusillade", "Artillery fire",
    "Motorboat, speedboat", "Boat, Water vehicle", "Engine", "Idling",
    "Medium engine (mid frequency)", "Heavy engine (low frequency)",
]  # fmt: skip
THRESHOLDS = {"boat_engine": 0.45, "gunshot": 0.30}


def fake_class_names() -> list[str]:
    """A class list with filler names around our target classes, like the real map."""
    names = [f"Other {i}" for i in range(20)]
    for i, name in enumerate(TARGET_NAMES):
        names[2 * i] = name
    return names


def test_label_map_resolves_indices_and_reads_preliminary_thresholds() -> None:
    names = fake_class_names()
    label_map = load_label_map(LABEL_MAP, names)
    assert label_map.version == "1"
    assert [names[i] for i in label_map.class_indices["gunshot"]] == TARGET_NAMES[:4]
    assert [names[i] for i in label_map.class_indices["boat_engine"]] == TARGET_NAMES[4:]
    assert set(label_map.thresholds) == {"boat_engine", "gunshot"}


def test_label_map_fails_when_a_class_is_missing() -> None:
    names = [n for n in fake_class_names() if n != "Fusillade"]
    with pytest.raises(ValueError, match="Fusillade"):
        load_label_map(LABEL_MAP, names)


def test_label_map_matches_real_class_map_when_available() -> None:
    _, class_map = model_paths()
    if not class_map.is_file():
        pytest.skip("YAMNet class map not available")
    load_label_map(LABEL_MAP, load_class_names(class_map))  # raises on any mismatch


def test_label_scores_take_the_max_of_each_group() -> None:
    names = fake_class_names()
    label_map = load_label_map(LABEL_MAP, names)
    scores = np.zeros(len(names))
    scores[names.index("Machine gun")] = 0.7
    scores[names.index("Gunshot, gunfire")] = 0.2
    scores[names.index("Idling")] = 0.4
    scores[names.index("Other 1")] = 0.99  # not mapped: must not count
    result = mapping.label_scores(scores, label_map)
    assert result == pytest.approx({"boat_engine": 0.4, "gunshot": 0.7, "background": 0.3})


def windows(*pairs: tuple[float, float]) -> list[dict[str, float]]:
    return [{"boat_engine": b, "gunshot": g, "background": 1 - max(b, g)} for b, g in pairs]


def spans(n: int) -> list[tuple[float, float]]:
    return [(round(i * 0.48, 3), round(i * 0.48 + 0.975, 3)) for i in range(n)]


def test_events_merge_consecutive_windows_and_keep_the_peak() -> None:
    per_window = windows((0.5, 0), (0.9, 0), (0.6, 0), (0.1, 0), (0.1, 0), (0.1, 0), (0.7, 0))
    events = mapping.find_events(per_window, spans(7), THRESHOLDS)
    assert events == [
        {"label": "boat_engine", "confidence": 0.9, "startS": 0.0, "endS": 1.935},
        {"label": "boat_engine", "confidence": 0.7, "startS": 2.88, "endS": 3.855},
    ]


def test_events_bridge_a_single_low_window_because_windows_overlap() -> None:
    per_window = windows((0, 0.5), (0, 0.1), (0, 0.6))
    events = mapping.find_events(per_window, spans(3), THRESHOLDS)
    assert events == [{"label": "gunshot", "confidence": 0.6, "startS": 0.0, "endS": 1.935}]


def test_no_events_below_threshold() -> None:
    assert mapping.find_events(windows((0.44, 0.29), (0.1, 0.1)), spans(2), THRESHOLDS) == []


def test_summary_prefers_gunshot_over_boat() -> None:
    label, confidence, best = mapping.summarize(windows((0.9, 0.0), (0.2, 0.35)), THRESHOLDS)
    assert (label, confidence, best) == ("gunshot", 0.35, 1)


def test_summary_boat_when_no_gunshot() -> None:
    label, confidence, best = mapping.summarize(windows((0.5, 0.1), (0.8, 0.29)), THRESHOLDS)
    assert (label, confidence, best) == ("boat_engine", 0.8, 1)


def test_summary_background_confidence_is_one_minus_highest_peak() -> None:
    label, confidence, best = mapping.summarize(windows((0.4, 0.1), (0.05, 0.2)), THRESHOLDS)
    assert label == "background"
    assert confidence == pytest.approx(0.6)
    assert best == 1  # the most "background" window


@pytest.mark.parametrize(
    ("confidence", "word"), [(0.95, "high"), (0.6, "high"), (0.59, "medium"), (0.35, "medium"), (0.34, "low")]
)
def test_qualitative(confidence: float, word: str) -> None:
    assert mapping.qualitative(confidence) == word


def test_top_k_is_sorted() -> None:
    top = mapping.top_k(np.array([0.1, 0.9, 0.5]), ["a", "b", "c"], 2)
    assert top == [{"name": "b", "score": 0.9}, {"name": "c", "score": 0.5}]


def test_label_map_dataclass_is_plain() -> None:
    lm = LabelMap(version="1", class_indices={"boat_engine": [0], "gunshot": [1]}, thresholds=THRESHOLDS)
    assert mapping.label_scores(np.array([0.2, 0.1]), lm)["background"] == pytest.approx(0.8)
