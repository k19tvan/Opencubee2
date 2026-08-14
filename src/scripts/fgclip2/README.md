# FG-CLIP 2

This workflow uses the keyframes at `FGCLIP2_KEYFRAME_DIR` and keeps generated
model files and embedding shards outside Git.

## Download model

Set a reviewed Hugging Face commit SHA, then run:

```bash
export FGCLIP2_MODEL_REVISION="<commit-sha>"
bash src/scripts/fgclip2/download_model.sh
```

## Resumable embedding

Run inside the `opencubee2` Docker container. Mount a persistent local Docker
volume at `FGCLIP2_STATE_DIR` before full embedding. This directory holds the
manifest and completed chunks; do not place it on the slow keyframe NFS.

Create a manifest once. It records stable keyframe metadata and assigns each
keyframe to one of the fixed shards:

```bash
/root/miniconda3/envs/fgclip2/bin/python -m src.scripts.fgclip2.index_fgclip2 \
  --state-dir "$FGCLIP2_STATE_DIR" manifest --shard-count 64
```

Before every shard, inspect shared GPU usage and choose a GPU UUID with enough
free VRAM:

```bash
nvidia-smi --query-gpu=index,uuid,name,memory.free --format=csv,noheader
```

Use the selected UUID in `CUDA_VISIBLE_DEVICES`; inside that process,
`FGCLIP2_DEVICE` remains `cuda:0`. Completed chunks are skipped on restart;
partial chunks are discarded safely.

```bash
CUDA_VISIBLE_DEVICES=GPU-<uuid> FGCLIP2_DEVICE=cuda:0 \
/root/miniconda3/envs/fgclip2/bin/python -m src.scripts.fgclip2.index_fgclip2 \
  --state-dir "$FGCLIP2_STATE_DIR" embed --shard-id 0 --chunk-size 5000
```

Run parallel jobs only with different `--shard-id` values. Start with one or
two workers and increase concurrency only if NFS throughput remains stable.

## Import into Qdrant

```bash
/root/miniconda3/envs/fgclip2/bin/python -m src.scripts.fgclip2.import_fgclip2 \
  "$FGCLIP2_STATE_DIR"/chunks/shard-*/*.npz
```

The importer creates `QDRANT_COLLECTION_FGCLIP2` with cosine distance when the
collection does not already exist.
