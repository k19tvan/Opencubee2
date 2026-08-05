import io
import os
import sys
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

from tools.jina_embedding_utils import (
    encode_images,
    encode_multimodal_queries,
    encode_texts,
    load_jina_model,
)


app = FastAPI(default_response_class=JSONResponse)

# ==========================================
# CẤU HÌNH MODEL VÀ WORKER
# ==========================================
MODEL_PATH = os.getenv(
    "JINA_MODEL_PATH",
    "/AIClub_NAS/nguyenmv/Opencubee2/models/jina-embeddings-v5-omni-small",
)
DEVICE = os.getenv("JINA_DEVICE")
BACKEND = os.getenv("JINA_BACKEND", "sentence_transformers")
DTYPE = os.getenv("JINA_DTYPE", "auto")
TASK = os.getenv("JINA_TASK", "retrieval")
TEXT_PROMPT_NAME = os.getenv("JINA_TEXT_PROMPT_NAME", "query")
DEFAULT_TASK = os.getenv("JINA_DEFAULT_TASK", "retrieval")
MODALITY = os.getenv("JINA_MODALITY", "vision")

# ==========================================
# NẠP MODEL TOÀN CỤC
# ==========================================
print(f"--- [Jina Worker] Loading Jina v5 omni from {MODEL_PATH}... ---")
try:
    bundle = load_jina_model(
        model_path=MODEL_PATH,
        device=DEVICE,
        backend=BACKEND,
        dtype=DTYPE,
        default_task=DEFAULT_TASK,
        modality=MODALITY,
    )
    print(f"--- [Jina Worker] Model loaded on {bundle.device} via {bundle.backend}. ---")
except Exception as exc:
    print(f"--- [Jina Worker] FATAL: failed to load model: {exc} ---")
    raise


# ==========================================
# HELPER — cùng pattern với host_bge.py
# ==========================================
async def _read_upload_image(image_file: UploadFile) -> Image.Image:
    content = await image_file.read()
    return Image.open(io.BytesIO(content)).convert("RGB")


# ==========================================
# ENDPOINT KIỂM TRA TRẠNG THÁI WORKER
# ==========================================
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "jina_v5_omni",
        "model_path": MODEL_PATH,
        "device": bundle.device,
        "backend": bundle.backend,
    }


# ==========================================
# ENDPOINT EMBEDDING — contract giống BGE worker
# ==========================================
@app.post("/embed")
async def embed_endpoint(
    text_query: str = Form(None),
    image_file: UploadFile = File(None),
):
    try:
        if image_file and text_query:
            image = await _read_upload_image(image_file)
            vector = encode_multimodal_queries(bundle, [(text_query, image)])[0]
            return {"embedding": [vector.astype(float).tolist()]}

        if image_file:
            image = await _read_upload_image(image_file)
            vector = encode_images(bundle, [image], task=TASK, role="query")[0]
            return {"embedding": [vector.astype(float).tolist()]}

        if text_query:
            vector = encode_texts(
                bundle,
                [text_query],
                task=TASK,
                prompt_name=TEXT_PROMPT_NAME,
                role="query",
            )[0]
            return {"embedding": [vector.astype(float).tolist()]}

        raise HTTPException(
            status_code=400,
            detail="Either 'text_query' or 'image_file' must be provided.",
        )

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Jina inference failed: {exc}",
        ) from exc


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("JINA_WORKER_PORT", "2004"))
    uvicorn.run(app, host="127.0.0.1", port=port)
