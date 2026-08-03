# bge_worker.py
import io
import os
import torch
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from sentence_transformers import SentenceTransformer

# 1. Khởi tạo FastAPI với ORJSONResponse để tối ưu tốc độ truyền tải JSON
app = FastAPI(default_response_class=JSONResponse)

# 2. Cấu hình phần cứng và đường dẫn mô hình
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
MODEL_PATH = "./models/BGE-VL-large"

# Nạp mô hình toàn cục
print(f"--- [Worker] Loading BGE-VL-large on {DEVICE}... ---")
try:
    model = SentenceTransformer(MODEL_PATH, trust_remote_code=True, device=DEVICE)
    print("--- [Worker] Model loaded successfully! ---")
except Exception as e:
    print(f"--- [Worker] FATAL: Failed to load BGE-VL-large: {e} ---")
    raise e

# 3. Endpoint xử lý vector hóa tích hợp Composed Image Retrieval (CIR)
@app.post("/embed")
async def embed_endpoint(
    text_query: str = Form(None),
    image_file: UploadFile = File(None)
):
    try:
        # 💡 TRƯỜNG HỢP 1: DUNG HỢP TRỰC TIẾP CHỮ VÀ ẢNH (NATIVE COMPOSED RETRIEVAL)
        # Nếu gửi lên cả ảnh và chữ phản hồi, cho mô hình dung hợp trực tiếp ở tầng đặc trưng
        if image_file and text_query:
            content = await image_file.read()
            # Chuyển đổi nhị phân sang đối tượng PIL Image
            image = Image.open(io.BytesIO(content)).convert("RGB")
            
            # Đóng gói dữ liệu dạng dictionary theo chuẩn cấu trúc gốc của BGE-VL
            query = {
                "image": image,
                "text": text_query
            }
            
            # Sinh vector dung hợp
            # BGE-VL's composed-retrieval API expects a *batch* of dictionaries.
            # Passing the dictionary directly makes SentenceTransformer iterate its
            # keys ("image" and "text"), so image + textual feedback either fails
            # or produces an invalid embedding.
            embedding = model.encode([query], convert_to_numpy=True)[0].tolist()
            return {"embedding": [embedding]}
            
        # TRƯỜNG HỢP 2: Chỉ có tệp ảnh tải lên (Tìm kiếm bằng ảnh thô)
        elif image_file:
            content = await image_file.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")
            
            embedding = model.encode([image], convert_to_numpy=True)[0].tolist()
            return {"embedding": [embedding]}
        
        # TRƯỜNG HỢP 3: Chỉ có truy vấn văn bản thô
        elif text_query:
            embedding = model.encode([text_query], convert_to_numpy=True)[0].tolist()
            return {"embedding": [embedding]}
        
        else:
            raise HTTPException(status_code=400, detail="Either 'text_query' or 'image_file' must be provided.")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model inference failed: {str(e)}")

# Khởi chạy Worker trên cổng 8002 nội bộ
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=2001)
