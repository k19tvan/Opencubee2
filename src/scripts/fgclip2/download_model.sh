#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${FGCLIP2_MODEL_PATH:-./models/fg-clip2-large}"
if [[ -f "$MODEL_PATH/config.json" ]]; then
  echo "FG-CLIP 2 already present at $MODEL_PATH"
  exit 0
fi

: "${FGCLIP2_MODEL_REVISION:?Set FGCLIP2_MODEL_REVISION to a reviewed Hugging Face commit SHA.}"

hf download qihoo360/fg-clip2-large \
  --revision "$FGCLIP2_MODEL_REVISION" \
  --local-dir "$MODEL_PATH"
