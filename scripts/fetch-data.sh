#!/usr/bin/env bash
# Makes sure the data that is not stored in git is present and intact:
# the YAMNet model, the offline map tiles of the demo area and the demo audio clips.
# Checksums live in data/manifests/ (committed). Downloads happen only when a file is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/models/yamnet data/tiles data/demo

verify() { # manifest label: stop the whole run when a file does not match its checksum
  if (cd data && sha256sum --quiet -c "$1"); then
    echo "fetch-data: $2 — OK"
  else
    echo "fetch-data: контрольная сумма не совпала ($2). Удалите испорченный файл и запустите снова." >&2
    exit 1
  fi
}

fetch() { # url destination
  if [ ! -s "$2" ]; then
    echo "fetch-data: скачиваю $2"
    curl -fL --retry 3 -sS -o "$2.part" "$1" && mv "$2.part" "$2"
  fi
}

fetch https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/audio_classification/android/lite-model_yamnet_classification_tflite_1.tflite \
  data/models/yamnet/yamnet_classification.tflite
fetch https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv \
  data/models/yamnet/yamnet_class_map.csv
verify manifests/models.sha256 "модель YAMNet"

if [ ! -s data/tiles/agrakhan.pmtiles ]; then
  command -v pmtiles >/dev/null || { echo "fetch-data: нужен go-pmtiles (см. docs/PROGRESS.md)" >&2; exit 1; }
  build=$(cat data/manifests/tiles.build)
  # Extract into a temporary file so that an interrupted download is never mistaken for a complete one.
  rm -f data/tiles/agrakhan.pmtiles.part
  pmtiles extract "https://build.protomaps.com/${build}.pmtiles" data/tiles/agrakhan.pmtiles.part \
    --bbox=46.8,43.2,48.4,44.7 --maxzoom=13
  mv data/tiles/agrakhan.pmtiles.part data/tiles/agrakhan.pmtiles
fi
verify manifests/tiles.sha256 "тайлы карты"

if [ ! -s data/demo/boat_engine.wav ] || [ ! -s data/demo/gunshot.wav ]; then
  echo "fetch-data: готовлю демо-клипы (services/ml/tools/prepare_demo_clips.py)"
  (cd services/ml && uv run --frozen python tools/prepare_demo_clips.py)
fi
ls data/demo/boat_engine.wav data/demo/gunshot.wav >/dev/null && echo "fetch-data: демо-клипы — OK"
