from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

NAS_UPLOAD_DIR = Path("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/database/temp_uploads")
if NAS_UPLOAD_DIR.parent.exists():
    TEMP_UPLOAD_DIR = NAS_UPLOAD_DIR
else:
    print("Warning: NAS mount path not accessible. Falling back to local './temp_uploads'")
    TEMP_UPLOAD_DIR = Path("./temp_uploads")
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

QDRANT_HOST = os.getenv("QDRANT_HOST", "opencubee2_qdrant")
QDRANT_PORT = 6333
QDRANT_GRPC_PORT = 6334

MODEL_CONFIGS = {
    "bge": {
        "worker_url": os.getenv("BGE_WORKER_URL", 'http://127.0.0.1:2001/embed'),
        "collection": "bge",
    },
    "beit3": {
        "worker_url": os.getenv("BEIT3_WORKER_URL", 'http://127.0.0.1:2002/embed'),
        "collection": "beit3",
        # One Qdrant point per frame, with named vectors for left/right/top/bottom.
        "spatial_collection": os.getenv(
            "QDRANT_COLLECTION_BEIT3_SPATIAL",
            "beit3_spatial",
        ),
    },
    "metaclip2": {
        "worker_url": os.getenv("METACLIP2_WORKER_URL", 'http://127.0.0.1:2208/embed'),
        "collection": "metaclip2",
    },
    "fgclip2": {
        "worker_url": os.getenv("FGCLIP2_WORKER_URL", "http://127.0.0.1:2005/embed"),
        "collection": "fgclip2",
    },
    "jina_v5_omni": {
        "worker_url": os.getenv("JINA_V5_OMNI_WORKER_URL", 'http://127.0.0.1:2004/embed'),
        "collection": "jina_v5_omni",
    },
    "qwen": {
        "worker_url": os.getenv("QWEN_WORKER_URL", 'http://127.0.0.1:2006/embed'),
        "collection": os.getenv("ASR_COLLECTION", "asr"),
    }
}

MEILISEARCH_HOST = os.getenv("MEILISEARCH_HOST", "http://opencubee2_meilisearch:7700")
OCR_ASR_INDEX_NAME = os.getenv("OCR_ASR_INDEX_NAME", "ocr_only_beit3_096")
SEMANTIC_ASR_INDEX_NAME = os.getenv("SEMANTIC_ASR_INDEX_NAME", "semantic_asr")
OCR_SEARCH_FIELD = os.getenv("OCR_SEARCH_FIELD", "ocr_text")
ASR_SEARCH_FIELD = os.getenv("ASR_SEARCH_FIELD", "asr_text")
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://192.168.20.152:2108/v1").rstrip("/")
VLLM_MODEL = os.getenv("VLLM_MODEL")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
TRANSLATE_PROVIDER = os.getenv("TRANSLATE_PROVIDER", "llm_translate").strip().lower()

try:
    MAX_FRAME_LIMIT = int(os.getenv("MAX_FRAME_LIMIT", "200"))
except ValueError:
    MAX_FRAME_LIMIT = 200

VIDEO_DIR = Path(os.getenv("VIDEO_DIR", "/mlcv1/Datasets/HCMAI25/full/")).resolve()
VIDEO_EXTENSIONS = (".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v")
