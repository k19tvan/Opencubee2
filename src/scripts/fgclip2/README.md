# FG-CLIP 2

Weights, Qdrant, and keyframes are shared runtime — not git. After merge,
defaults (`./models/fg-clip2-large`, `./storage/fgclip2/state`) match the
shared repo cwd. From this pad checkout, set `FGCLIP2_MODEL_PATH` to
`Opencubee2/models/fg-clip2-large` instead of downloading a second copy.

```bash
export FGCLIP2_MODEL_REVISION="${FGCLIP2_MODEL_REVISION:-4d1d5dc35c716902f07c172dbfc23b82a7bc6bf3}"
bash src/scripts/fgclip2/download_model.sh
```

Use a dedicated env (`requirements_fgclip2.txt`). Keep `FGCLIP2_STATE_DIR` on
fast local disk, not keyframe NFS.

```bash
python -m src.scripts.fgclip2.index_fgclip2 \
  --state-dir "$FGCLIP2_STATE_DIR" manifest --shard-count 64

nvidia-smi --query-gpu=index,uuid,name,memory.free --format=csv,noheader

CUDA_VISIBLE_DEVICES=GPU-<uuid> FGCLIP2_DEVICE=cuda:0 \
python -m src.scripts.fgclip2.index_fgclip2 \
  --state-dir "$FGCLIP2_STATE_DIR" embed --shard-id 0 --chunk-size 5000
```

Completed chunks resume; partial chunks are discarded. Parallel jobs must use
different `--shard-id` values.

```bash
python -m src.scripts.fgclip2.import_fgclip2 \
  "$FGCLIP2_STATE_DIR"/chunks/shard-*/*.npz
```

The importer creates `QDRANT_COLLECTION_FGCLIP2` with cosine distance when the
collection does not already exist.
