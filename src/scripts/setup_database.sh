#!/usr/bin/env bash
set -e

npm install -g layerbase

INSTANCE_NAME="opencubee2_qdrant"
QDRANT_STORAGE="$(pwd)/database/qdrant/storage/storage"
INSTANCE_DIR="$HOME/.spindb/containers/qdrant/$INSTANCE_NAME"

lbase create "$INSTANCE_NAME" -e qdrant --port 6333 || true
lbase stop "$INSTANCE_NAME" || true

mkdir -p "$QDRANT_STORAGE" "$INSTANCE_DIR"
rm -rf "$INSTANCE_DIR/storage"
ln -s "$QDRANT_STORAGE" "$INSTANCE_DIR/storage"

lbase start "$INSTANCE_NAME"

lbase list
lbase url "$INSTANCE_NAME"
curl http://127.0.0.1:6333/collections