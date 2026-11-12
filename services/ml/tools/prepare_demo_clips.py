"""Prepare the demo audio clips from the committed manifest.

For every row of data/manifests/demo_clips.csv this script:
  1. downloads the original recording into <data>/demo/raw/ if it is missing,
  2. checks its SHA-256 against original_sha256 (stops on mismatch),
  3. cuts the segment listed in TRIM_SECONDS below,
  4. mixes to mono, resamples to 16 kHz, normalises the peak to -1 dBFS,
  5. writes a 16-bit WAV to <data>/demo/<file> and prints its SHA-256
     (compare with prepared_sha256; a different libsndfile version may change it).

Usage (from services/ml):
  uv run python tools/prepare_demo_clips.py --data-dir ../../data
"""

import argparse
import csv
import hashlib
import sys
import urllib.request
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

TARGET_RATE = 16_000
PEAK = 10 ** (-1 / 20)  # -1 dBFS
MAX_SECONDS = 20.0
MAX_BYTES = 1_000_000

# Segment (start, end) in seconds of the original recording, chosen by listening to the
# recording and looking at its loudness; see the notes column of the manifest.
TRIM_SECONDS = {
    "boat_engine.wav": (42.0, 52.0),
    "gunshot.wav": (12.0, 22.0),
    "thunder.wav": (0.0, 10.0),
    "fireworks.wav": (0.0, 10.0),
}

REPO_ROOT = Path(__file__).resolve().parents[3]


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "ecoshield-demo-clips/0.1"})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 (URL from our manifest)
        target.write_bytes(response.read())


def prepare(original: Path, start_s: float, end_s: float) -> np.ndarray:
    audio, rate = sf.read(original, dtype="float32", always_2d=True)
    segment = audio[int(start_s * rate) : int(end_s * rate)]
    mono = segment.mean(axis=1)
    if rate != TARGET_RATE:
        mono = soxr.resample(mono, rate, TARGET_RATE)
    peak = float(np.max(np.abs(mono)))
    if peak <= 0:
        raise ValueError(f"{original.name}: the selected segment is silent")
    return (mono / peak * PEAK).astype(np.float32)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--manifest", type=Path, default=REPO_ROOT / "data/manifests/demo_clips.csv")
    parser.add_argument("--data-dir", type=Path, default=REPO_ROOT / "data")
    args = parser.parse_args()

    ok = True
    with args.manifest.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        name = row["file"]
        raw = args.data_dir / "demo" / "raw" / Path(row["download_url"]).name
        if not raw.exists():
            print(f"downloading {row['download_url']}")
            download(row["download_url"], raw)
        actual = sha256_file(raw)
        if actual != row["original_sha256"]:
            print(f"ERROR {name}: original sha256 {actual} != manifest {row['original_sha256']}")
            ok = False
            continue

        start_s, end_s = TRIM_SECONDS[name]
        samples = prepare(raw, start_s, end_s)
        out = args.data_dir / "demo" / name
        sf.write(out, samples, TARGET_RATE, subtype="PCM_16")

        seconds = len(samples) / TARGET_RATE
        size = out.stat().st_size
        prepared = sha256_file(out)
        status = "ok" if prepared == row["prepared_sha256"] else "prepared sha256 differs from manifest"
        print(f"{name}: {seconds:.2f} s, {size} bytes, sha256 {prepared} ({status})")
        if seconds > MAX_SECONDS or size > MAX_BYTES:
            print(f"ERROR {name}: longer than {MAX_SECONDS} s or larger than {MAX_BYTES} bytes")
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
