from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


TEMP_UPLOAD_DIR = Path("./backend/temp_uploads")
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

QDRANT_HOST = os.getenv("QDRANT_HOST", "opencubee2_qdrant")
QDRANT_PORT = 6333
QDRANT_GRPC_PORT = 6334

MODEL_CONFIGS = {
    "bge": {
        "worker_url": "http://127.0.0.1:2001/embed",
        "collection": "bge_part",
    },
    "jina_v5_omni": {
        "worker_url": "http://127.0.0.1:2004/embed",
        "collection": "jina_v5_omni",
    },
    "beit3": {
        "worker_url": "http://127.0.0.1:2002/embed",
        "collection": "beit3",
    }
}

MEILISEARCH_HOST = os.getenv("MEILISEARCH_HOST", "http://opencubee2_meilisearch:7700")
OCR_ASR_INDEX_NAME = "ocr_asr_index_part"
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://192.168.20.152:2108/v1").rstrip("/")
VLLM_MODEL = os.getenv("VLLM_MODEL")

try:
    MAX_FRAME_LIMIT = int(os.getenv("MAX_FRAME_LIMIT", "1000"))
except ValueError:
    MAX_FRAME_LIMIT = 1000

VIDEO_DIR = Path(os.getenv("VIDEO_DIR", "/mlcv1/Datasets/HCMAI25/full/")).resolve()
VIDEO_EXTENSIONS = (".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v")
