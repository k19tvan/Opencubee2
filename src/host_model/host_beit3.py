import io
import os
import sys
import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from torchvision import transforms

# 1. Khởi tạo FastAPI
app = FastAPI(default_response_class=JSONResponse)

# 2. Cấu hình phần cứng và đường dẫn mô hình
DEVICE = os.getenv("DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu")
MODEL_WEIGHTS_PATH = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/models/beit3_large_patch16_384_coco_retrieval.pth"
BEIT3_FULL_SOURCE_DIR = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/tools"

if BEIT3_FULL_SOURCE_DIR not in sys.path: 
    sys.path.insert(0, BEIT3_FULL_SOURCE_DIR)

try:
    from modeling_finetune import BEiT3ForRetrieval
    from modeling_utils import _get_large_config
    from transformers import XLMRobertaTokenizer
except ImportError as e:
    sys.exit(f"FATAL: ImportError - {e}")

print(f"--- [BEiT-3 Worker] Loading model on {DEVICE}... ---")
try:
    model = BEiT3ForRetrieval(_get_large_config(img_size=384))
    ckpt = torch.load(MODEL_WEIGHTS_PATH, map_location='cpu')
    model.load_state_dict(ckpt.get('model', ckpt.get('module')), strict=False)
    model.to(device=DEVICE, dtype=torch.float16).eval()
    
    tokenizer = XLMRobertaTokenizer("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/models/beit3.spm")
    
    transform = transforms.Compose([
        transforms.Resize((384, 384), interpolation=transforms.InterpolationMode.BICUBIC),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.5, 0.5, 0.5], std=[0.5, 0.5, 0.5])
    ])
    
    print("--- [BEiT-3 Worker] Model loaded successfully! ---")
except Exception as e:
    print(f"--- [BEiT-3 Worker] FATAL: Failed to load BEiT-3: {e} ---")
    raise e

@app.post("/embed")
async def embed_endpoint(
    text_query: str = Form(None),
    image_file: UploadFile = File(None)
):
    try:
        if image_file and text_query:
            raise HTTPException(status_code=400, detail="BEiT-3 worker hiện chưa hỗ trợ dung hợp ảnh và chữ trong 1 request.")
            
        elif image_file:
            content = await image_file.read()
            image = Image.open(io.BytesIO(content)).convert("RGB")
            img_tensor = transform(image).unsqueeze(0).to(device=DEVICE, dtype=torch.float16)
            
            with torch.no_grad():
                image_embed, _ = model(image=img_tensor, text_description=None, padding_mask=None, only_infer=True)
                embedding = image_embed[0].cpu().float().numpy().tolist()
                
            return {"embedding": [embedding]}
        
        elif text_query:
            # Tokenize cho XLM-Roberta
            tokens = tokenizer(text_query, padding='max_length', truncation=True, max_length=64, return_tensors='pt')
            text_ids = tokens['input_ids'].to(device=DEVICE)
            padding_mask = (tokens['attention_mask'] == 0).to(device=DEVICE) # Padding mask là boolean
            
            with torch.no_grad():
                _, text_embed = model(image=None, text_description=text_ids, padding_mask=padding_mask, only_infer=True)
                embedding = text_embed[0].cpu().float().numpy().tolist()
                
            return {"embedding": [embedding]}
        
        else:
            raise HTTPException(status_code=400, detail="Either 'text_query' or 'image_file' must be provided.")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model inference failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=2002)
