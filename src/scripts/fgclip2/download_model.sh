#!/usr/bin/env bash
set -euo pipefail

: "${FGCLIP2_MODEL_REVISION:?Set FGCLIP2_MODEL_REVISION to a reviewed Hugging Face commit SHA.}"

MODEL_PATH="${FGCLIP2_MODEL_PATH:-./models/fg-clip2-large}"
hf download qihoo360/fg-clip2-large \
  --revision "$FGCLIP2_MODEL_REVISION" \
  --local-dir "$MODEL_PATH"
