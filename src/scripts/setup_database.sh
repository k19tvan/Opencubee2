#!/usr/bin/env bash
set -euo pipefail

npm install -g layerbase

ROOT="$(pwd)"
LBASE_DIR="$HOME/.spindb/containers"

# ==================== Qdrant ====================
QDRANT_NAME="opencubee2_qdrant"
QDRANT_DATA="$ROOT/database/qdrant/storage"
QDRANT_DIR="$LBASE_DIR/qdrant/$QDRANT_NAME"

lbase stop "$QDRANT_NAME" 2>/dev/null || true
lbase delete "$QDRANT_NAME" --force 2>/dev/null || true

lbase create "$QDRANT_NAME" \
    -e qdrant \
    --port 6333 \
    --no-start

mkdir -p "$QDRANT_DATA"

rm -rf "$QDRANT_DIR/storage"
ln -s "$QDRANT_DATA" "$QDRANT_DIR/storage"

lbase start "$QDRANT_NAME"

# ================= Meilisearch ==================
MEILI_NAME="opencubee2_meilisearch"
MEILI_DATA="$ROOT/database/meilisearch/storage/data.ms"
MEILI_DIR="$LBASE_DIR/meilisearch/$MEILI_NAME"
MEILI_VERSION="1.33.1"

lbase stop "$MEILI_NAME" 2>/dev/null || true
lbase delete "$MEILI_NAME" --force 2>/dev/null || true

lbase create "$MEILI_NAME" \
    -e meilisearch \
    --db-version "$MEILI_VERSION" \
    --port 7700 \
    --no-start

mkdir -p "$MEILI_DATA"

rm -rf "$MEILI_DIR/data"
ln -s "$MEILI_DATA" "$MEILI_DIR/data"

lbase start "$MEILI_NAME"

# ==================== Check =====================
ls -la "$QDRANT_DIR"
ls -la "$MEILI_DIR"

lbase list

curl -fsS http://127.0.0.1:6333/collections
echo

curl -fsS http://127.0.0.1:7700/indexes
echo