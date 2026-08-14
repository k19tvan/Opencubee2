# FG-CLIP 2

Weights live at `./models/fg-clip2-large`. Index state defaults to
`./storage/fgclip2/state` (gitignored). Pass the keyframe directory explicitly.

```bash
bash src/scripts/fgclip2/download_model.sh
```

Use a dedicated env (`requirements_fgclip2.txt`). Keep `--state-dir` on fast
local disk, not keyframe NFS.

```bash
python -m src.scripts.fgclip2.index_fgclip2 \
  manifest --keyframe-dir /path/to/keyframes --shard-count 64

nvidia-smi --query-gpu=index,uuid,name,memory.free --format=csv,noheader

CUDA_VISIBLE_DEVICES=<index> \
python -m src.scripts.fgclip2.index_fgclip2 \
  embed --shard-id 0 --chunk-size 5000
```

Completed chunks resume; partial chunks are discarded. Parallel jobs must use
different `--shard-id` values.

```bash
python -m src.scripts.fgclip2.import_fgclip2 \
  ./storage/fgclip2/state/chunks/shard-*/*.npz
```

The importer creates collection `fgclip2` with cosine distance when it does not
already exist.
