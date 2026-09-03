from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

BASE_DIR = Path(__file__).resolve().parents[2]
TEMP_UPLOAD_DIR = BASE_DIR / "temp_uploads"
TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

QDRANT_HOST = os.getenv("QDRANT_HOST", "opencubee2_qdrant")
QDRANT_PORT = 6333
QDRANT_GRPC_PORT = 6334

MILVUS_HOST = os.getenv("MILVUS_HOST", "opencubee_milvus_standalone")
MILVUS_PORT = os.getenv("MILVUS_PORT", "19530")
VECTOR_DATABASE = os.getenv("VECTOR_DATABASE", "milvus").strip().lower()

MODEL_CONFIGS = {
    "bge": {
        "worker_url": os.getenv("BGE_WORKER_URL", 'http://127.0.0.1:2001/embed'),
        "collection": "bge",
    },
    "beit3": {
        "worker_url": os.getenv("BEIT3_WORKER_URL", 'http://127.0.0.1:2002/embed'),
        "collection": "beit3",
        "spatial_collection": os.getenv("QDRANT_COLLECTION_BEIT3_SPATIAL", "beit3_spatial"),
    },
    "metaclip2": {
        "worker_url": os.getenv("METACLIP2_WORKER_URL", 'http://127.0.0.1:2208/embed'),
        "collection": "metaclip2",
    },
    "fgclip2": {
        "worker_url": os.getenv("FGCLIP2_WORKER_URL", "http://127.0.0.1:2005/embed"),
        "collection": "fgclip2",
    },
    "qwen": {
        "worker_url": os.getenv("QWEN_WORKER_URL", 'http://127.0.0.1:2006/embed'),
        "collection": os.getenv("ASR_COLLECTION", "asr"),
    },
}

MEILISEARCH_HOST = os.getenv("MEILISEARCH_HOST", "http://opencubee2_meilisearch:7700")
OCR_ASR_INDEX_NAME = os.getenv("OCR_ASR_INDEX_NAME", "ocr_only_beit3_096")
SEMANTIC_ASR_INDEX_NAME = os.getenv("SEMANTIC_ASR_INDEX_NAME", "semantic_asr")
SEMANTIC_ASR_SENTENCE_LEVEL_INDEX_NAME = os.getenv("SEMANTIC_ASR_SENTENCE_LEVEL_INDEX_NAME", "semantic_asr_sentence_level")
OCR_SEARCH_FIELD = os.getenv("OCR_SEARCH_FIELD", "ocr_text")
ASR_SEARCH_FIELD = os.getenv("ASR_SEARCH_FIELD", "asr_text")
VLLM_BASE_URL = os.getenv("VLLM_BASE_URL", "http://192.168.20.152:2108/v1").rstrip("/")
VLLM_MODEL = os.getenv("VLLM_MODEL")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
TRANSLATE_PROVIDER = os.getenv("TRANSLATE_PROVIDER", "llm_translate").strip().lower()
TRANSLATE_MODEL = os.getenv("TRANSLATE_MODEL", "qwen3-vl-8b")
TRANSLATE_MODEL_BASE_URL = os.getenv("TRANSLATE_MODEL_BASE_URL", "http://192.168.20.150:2108/v1").rstrip("/")
TRANSLATE_MODEL_API_KEY = os.getenv("TRANSLATE_MODEL_API_KEY", "EMPTY")

# Multi-agent retrieval uses one OpenAI-compatible model for both query planning
# and visual canvas criticism. It follows the same configuration shape as translation.
MULTIAGENT_MODEL = os.getenv("MULTIAGENT_MODEL", TRANSLATE_MODEL)
MULTIAGENT_MODEL_BASE_URL = os.getenv("MULTIAGENT_MODEL_BASE_URL", TRANSLATE_MODEL_BASE_URL).rstrip("/")
MULTIAGENT_MODEL_API_KEY = os.getenv("MULTIAGENT_MODEL_API_KEY", TRANSLATE_MODEL_API_KEY)

GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "http://gemini-web2api:8081/v1").rstrip("/")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "enn")
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-flash-lite")

try:
    MAX_FRAME_LIMIT = int(os.getenv("MAX_FRAME_LIMIT", "200"))
except ValueError:
    MAX_FRAME_LIMIT = 200

VIDEO_DIR = Path(os.getenv("VIDEO_DIR", "/mlcv1/Datasets/HCMAI25/full/"))
VIDEO_EXTENSIONS = (".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v")
