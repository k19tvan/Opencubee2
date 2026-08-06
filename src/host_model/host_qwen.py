import os
from pathlib import Path
from typing import Optional

import torch
import torch.nn.functional as F
from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import JSONResponse
from transformers import AutoModel, AutoTokenizer


app = FastAPI(default_response_class=JSONResponse)

# Qwen3-Embedding requires transformers >= 4.51.0.
MODEL_PATH = Path(
    "./models/Qwen3-Embedding-0.6B"
)
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
if DEVICE.startswith("cuda"):
    DTYPE = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
else:
    DTYPE = torch.float32

MAX_LENGTH = int(os.getenv("QWEN_MAX_LENGTH", "8192"))
QUERY_INSTRUCTION = (
    "Given a web search query, retrieve relevant passages that answer the query"
)


if not MODEL_PATH.is_dir():
    raise FileNotFoundError(f"Qwen embedding model not found: {MODEL_PATH}")

print(f"--- [Qwen Worker] Loading Qwen3-Embedding-0.6B on {DEVICE}... ---")
try:
    tokenizer = AutoTokenizer.from_pretrained(
        str(MODEL_PATH),
        padding_side="left",
        local_files_only=True,
    )
    model = AutoModel.from_pretrained(
        str(MODEL_PATH),
        torch_dtype=DTYPE,
        attn_implementation="sdpa",
        local_files_only=True,
    )
    model = model.to(DEVICE)
    model.eval()
    print("--- [Qwen Worker] Model loaded successfully! ---")
except Exception as exc:
    print(f"--- [Qwen Worker] FATAL: Failed to load Qwen model: {exc} ---")
    raise


def _format_query(text: str) -> str:
    """Add the retrieval instruction recommended for Qwen query embeddings."""
    return f"Instruct: {QUERY_INSTRUCTION}\nQuery:{text}"


def get_text_embedding(text: str) -> list[float]:
    """Create one normalized 1024-dimensional embedding from text."""
    encoded = tokenizer(
        [_format_query(text)],
        padding=True,
        truncation=True,
        max_length=MAX_LENGTH,
        return_tensors="pt",
    )
    encoded = {key: value.to(DEVICE) for key, value in encoded.items()}

    with torch.inference_mode():
        output = model(**encoded, use_cache=False)
        # padding_side="left" guarantees that the last token is the final
        # non-padding token, which is the pooling strategy used by Qwen3.
        embedding = output.last_hidden_state[:, -1, :]
        embedding = F.normalize(embedding.float(), p=2, dim=1)

    return embedding[0].cpu().tolist()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": "Qwen3-Embedding-0.6B",
        "model_path": str(MODEL_PATH),
        "device": DEVICE,
        "embedding_dimension": 1024,
    }


@app.post("/embed")
async def embed_endpoint(text_query: Optional[str] = Form(None)):
    """Embed a text query and return the worker-compatible response format."""
    if text_query is None or not text_query.strip():
        raise HTTPException(
            status_code=400,
            detail="'text_query' must be a non-empty string.",
        )

    try:
        embedding = get_text_embedding(text_query.strip())
        return {"embedding": [embedding]}
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Qwen inference failed: {exc}",
        ) from exc


if __name__ == "__main__":
    import uvicorn

    port = 2006
    uvicorn.run(app, host="127.0.0.1", port=port)

