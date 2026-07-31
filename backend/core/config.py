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

SERVER_CANVAS_PATH = Path("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/agent_canvases")
if SERVER_CANVAS_PATH.parent.exists():
    AGENT_CANVAS_DIR = SERVER_CANVAS_PATH
else:
    AGENT_CANVAS_DIR = Path("./agent_canvases")
AGENT_CANVAS_DIR.mkdir(parents=True, exist_ok=True)

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
    },
    "metaclip2": {
        "worker_url": os.getenv("METACLIP2_WORKER_URL", 'http://127.0.0.1:2208/embed'),
        "collection": "metaclip2",
    },
    "jina_v5_omni": {
        "worker_url": os.getenv("JINA_V5_OMNI_WORKER_URL", 'http://127.0.0.1:2004/embed'),
        "collection": "jina_v5_omni",
    }
}

MEILISEARCH_HOST = os.getenv("MEILISEARCH_HOST", "http://opencubee2_meilisearch:7700")
OCR_ASR_INDEX_NAME = os.getenv("OCR_ASR_INDEX_NAME", "ocr_only_beit3_096")
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://192.168.20.152:2108/v1").rstrip("/")
VLLM_MODEL = os.getenv("VLLM_MODEL")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

try:
    MAX_FRAME_LIMIT = int(os.getenv("MAX_FRAME_LIMIT", "200"))
except ValueError:
    MAX_FRAME_LIMIT = 200

VIDEO_DIR = Path(os.getenv("VIDEO_DIR", "/mlcv1/Datasets/HCMAI25/full/")).resolve()
VIDEO_EXTENSIONS = (".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v")
