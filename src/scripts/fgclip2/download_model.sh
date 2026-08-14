#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="./models/fg-clip2-large"
REVISION="4d1d5dc35c716902f07c172dbfc23b82a7bc6bf3"

if [[ -f "$MODEL_PATH/config.json" ]]; then
  echo "FG-CLIP 2 already present at $MODEL_PATH"
  exit 0
fi

hf download qihoo360/fg-clip2-large \
  --revision "$REVISION" \
  --local-dir "$MODEL_PATH"
