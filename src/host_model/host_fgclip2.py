from __future__ import annotations

import io
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from src.host_model.fgclip2_runtime import FGClip2Embedder

embedder: FGClip2Embedder | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global embedder
    embedder = FGClip2Embedder()
    yield
    embedder = None


app = FastAPI(title="FG-CLIP 2 worker", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ready": embedder is not None}


@app.post("/embed")
async def embed(
    text_query: str | None = Form(default=None),
    image_file: UploadFile | None = File(default=None),
) -> dict[str, list[list[float]]]:
    text = (text_query or "").strip() or None
    if embedder is None:
        raise HTTPException(status_code=503, detail="FG-CLIP 2 model is not ready.")
    if bool(text) == bool(image_file):
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of text_query or image_file.",
        )

    try:
        if image_file:
            image = Image.open(io.BytesIO(await image_file.read()))
            embedding = embedder.embed_image(image)
        else:
            embedding = embedder.embed_text(text or "")
    except (UnidentifiedImageError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"FG-CLIP 2 inference failed: {exc}") from exc

    return {"embedding": [embedding.tolist()]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("FGCLIP2_PORT", "2005")))
