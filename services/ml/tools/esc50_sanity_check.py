"""Sanity check of the PRELIMINARY thresholds on a few ESC-50 clips of other classes.

This is NOT an evaluation: a handful of clips per class, no confidence intervals.
It only shows whether the thresholds flag obvious non-targets (thunder, rain, waves...).
Clips are read from an extracted ESC-50 checkout (commit 33c8ce9e, licence CC BY-NC).

Usage (from services/ml, with YAMNET_MODEL_PATH / YAMNET_CLASS_MAP pointing to the model):
  uv run python tools/esc50_sanity_check.py <path to ESC-50 directory> --per-class 2
"""

import argparse
import csv
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.audio.classify import classify_bytes  # noqa: E402
from app.audio.mapping import load_label_map  # noqa: E402
from app.audio.yamnet import Yamnet  # noqa: E402

DEFAULT_CLASSES = [
    "thunderstorm",
    "rain",
    "sea_waves",
    "wind",
    "helicopter",
    "airplane",
    "train",
    "fireworks",
    "chainsaw",
    "crackling_fire",
    "door_wood_knock",
    "engine",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("esc50_dir", type=Path)
    parser.add_argument("--per-class", type=int, default=2)
    parser.add_argument("--classes", nargs="*", default=DEFAULT_CLASSES)
    args = parser.parse_args()

    model = Yamnet(Path(os.environ["YAMNET_MODEL_PATH"]), Path(os.environ["YAMNET_CLASS_MAP"]))
    label_map = load_label_map(
        Path(__file__).resolve().parents[1] / "app/audio/label_map.yaml", model.class_names
    )

    with (args.esc50_dir / "meta/esc50.csv").open(newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["category"] in args.classes]
    rows.sort(key=lambda r: (r["category"], int(r["fold"]), r["filename"]))
    taken: dict[str, int] = {}
    flagged = total = 0
    for row in rows:
        if taken.get(row["category"], 0) >= args.per_class:
            continue
        taken[row["category"]] = taken.get(row["category"], 0) + 1
        data = (args.esc50_dir / "audio" / row["filename"]).read_bytes()
        result = classify_bytes(data, model, label_map, 3, False, 60)
        s = result["summary"]
        peak_boat = max(w["scores"]["boat_engine"] for w in result["windows"])
        peak_gun = max(w["scores"]["gunshot"] for w in result["windows"])
        is_flagged = s["label"] != "background"
        total += 1
        flagged += is_flagged
        print(
            f"{row['category']:16s} {row['filename']:20s} -> {s['label']:11s} conf={s['confidence']:.3f} "
            f"boat_peak={peak_boat:.3f} gun_peak={peak_gun:.3f} {'FLAGGED' if is_flagged else ''}"
        )
    print(f"flagged {flagged} of {total} clips; thresholds {label_map.thresholds} (preliminary)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
