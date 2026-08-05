import io
import os
import torch
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from sentence_transformers import SentenceTransformer

app = FastAPI(default_response_class=JSONResponse)

DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
MODEL_PATH = "./models/BGE-VL-large"

print(f"--- [Worker] Loading BGE-VL-large on {DEVICE}... ---")
try:
    model = SentenceTransformer(MODEL_PATH, trust_remote_code=True, device=DEVICE)
    print("--- [Worker] Model loaded successfully! ---")
except Exception as e:
    print(f"--- [Worker] FATAL: Failed to load BGE-VL-large: {e} ---")
    raise e


@app.post("/embed")
async def embed_endpoint(
    text_query: str = Form(None),
    image_file: UploadFile = File(None)
):
    """
    Extract embeddings for image, text, or multimodal inputs (Composed Image Retrieval) using BGE-VL.
    """
    try:
        if image_file and text_query:
            content = await image_file.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")
            
            query = {
                "image": image,
                "text": text_query
            }
            
            embedding = model.encode([query], convert_to_numpy=True)[0].tolist()
            return {"embedding": [embedding]}
            
        elif image_file:
            content = await image_file.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")
            
            embedding = model.encode([image], convert_to_numpy=True)[0].tolist()
            return {"embedding": [embedding]}
        
        elif text_query:
            embedding = model.encode([text_query], convert_to_numpy=True)[0].tolist()
            return {"embedding": [embedding]}
        
        else:
            raise HTTPException(status_code=400, detail="Either 'text_query' or 'image_file' must be provided.")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model inference failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=2001)