import io
import os
import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from transformers import AutoModel, AutoProcessor

# 1. Khởi tạo FastAPI app
app = FastAPI(default_response_class=JSONResponse)

# 2. Cấu hình phần cứng và đường dẫn mô hình
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
MODEL_PATH = "./models/metaclip-2-worldwide-huge-quickgelu"
FALLBACK_HF_PATH = "facebook/metaclip-2-worldwide-huge-quickgelu"

# Đường dẫn ưu tiên local
model_path_to_use = MODEL_PATH if os.path.exists(MODEL_PATH) else FALLBACK_HF_PATH

print(f"--- [Worker MetaCLIP] Loading model on {DEVICE}... ---")
try:
    processor = AutoProcessor.from_pretrained(
        model_path_to_use,
        trust_remote_code=True,
    )
    model = AutoModel.from_pretrained(
        model_path_to_use,
        torch_dtype=torch.bfloat16,
        attn_implementation="sdpa",
        device_map=None,
        trust_remote_code=True,
    )
    model = model.to(DEVICE)
    model.eval()
    print("--- [Worker MetaCLIP] Model loaded successfully! ---")
except Exception as e:
    print(f"--- [Worker MetaCLIP] FATAL: Failed to load MetaCLIP model: {e} ---")
    raise e


def extract_features_from_output(output):
    """Hàm bổ trợ lấy tensor embedding từ output của model MetaCLIP"""
    if hasattr(output, "pooler_output"):
        return output.pooler_output
    elif hasattr(output, "image_embeds"):
        return output.image_embeds
    elif hasattr(output, "text_embeds"):
        return output.text_embeds
    return output


def get_image_embedding(image: Image.Image) -> np.ndarray:
    """Rút trích vector từ ảnh"""
    inputs = processor(images=image, return_tensors="pt")
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        outputs = model.get_image_features(**inputs)
        embeds = extract_features_from_output(outputs)
        embedding = embeds.float().cpu().numpy()[0]
    return embedding


def get_text_embedding(text: str) -> np.ndarray:
    """Rút trích vector từ văn bản (Text Query)"""
    inputs = processor(text=[text], return_tensors="pt", padding=True, truncation=True)
    inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        outputs = model.get_text_features(**inputs)
        embeds = extract_features_from_output(outputs)
        embedding = embeds.float().cpu().numpy()[0]
    return embedding


# 3. Endpoint xử lý vector hóa
@app.post("/embed")
async def embed_endpoint(
    text_query: str = Form(None),
    image_file: UploadFile = File(None)
):
    try:
        # TRƯỜNG HỢP 1: CẢ ẢNH VÀ CHỮ (Dung hợp bằng cách trung bình cộng và Chuẩn hóa L2)
        if image_file and text_query:
            content = await image_file.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")
            
            img_emb = get_image_embedding(image)
            txt_emb = get_text_embedding(text_query)
            
            # Dung hợp 2 vector theo tỉ lệ trung bình (Average Pooling)
            fused_emb = (img_emb + txt_emb) / 2.0
            
            # Chuẩn hóa L2 về vector đơn vị
            norm = np.linalg.norm(fused_emb)
            if norm > 0:
                fused_emb = fused_emb / norm

            return {"embedding": [fused_emb.tolist()]}

        # TRƯỜNG HỢP 2: CHỈ CÓ TỆP ẢNH
        elif image_file:
            content = await image_file.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")
            
            img_emb = get_image_embedding(image)
            return {"embedding": [img_emb.tolist()]}

        # TRƯỜNG HỢP 3: CHỈ CÓ TRUY VẤN VĂN BẢN
        elif text_query:
            txt_emb = get_text_embedding(text_query)
            return {"embedding": [txt_emb.tolist()]}

        else:
            raise HTTPException(
                status_code=400, 
                detail="Either 'text_query' or 'image_file' must be provided."
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model inference failed: {str(e)}")


# Khởi chạy Worker trên cổng 2003 nội bộ (hoặc 0.0.0.0 nếu truy cập ngoài)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=2003)