from __future__ import annotations

import asyncio
import mimetypes
import shutil
import uuid
from pathlib import Path
from urllib.parse import urlparse
from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, Body
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
import json
import glob
import os
import requests

class TemporalFrameRequest(BaseModel):
    base_frame_name: str

IMAGE_BASE_PATH = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/keyframes_beit3_096"

from backend.core import runtime
from backend.core.config import MODEL_CONFIGS, OCR_ASR_INDEX_NAME, TEMP_UPLOAD_DIR
from backend.services.media import probe_video_info, render_video_thumbnail, resolve_video_path, resolve_keyframe_path_sync

router = APIRouter()

@router.get("/models_status")
async def get_models_status():
    status = {}
    for name, config in MODEL_CONFIGS.items():
        url = config["worker_url"]
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port or 80
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=1.0
            )
            writer.close()
            await writer.wait_closed()
            status[name] = True
        except Exception:
            status[name] = False
    return status

# --- Endpoint API tìm kiếm chính (Đơn tầng) ---
@router.get("/videos/{video_id}")
async def get_video(video_id: str):
    video_path = resolve_video_path(video_id)
    media_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"
    return FileResponse(
        video_path,
        media_type=media_type,
        filename=video_path.name,
        headers={"Cache-Control": "public, max-age=31536000"}
    )

@router.get("/video_info/{video_id}")
async def get_video_info(video_id: str):
    video_path = resolve_video_path(video_id)
    info = probe_video_info(video_path)
    return {
        "video_id": video_id,
        "filename": video_path.name,
        "fps": info["fps"],
        "frame_count": info["frame_count"],
        "duration": info["duration"],
    }

@router.get("/video_thumbnail/{video_id}")
async def get_video_thumbnail(video_id: str, frame: int = 0, width: int = 160):
    video_path = resolve_video_path(video_id)
    safe_frame = max(frame, 0)
    safe_width = min(max(width, 80), 480)

    try:
        image = await asyncio.to_thread(
            render_video_thumbnail,
            str(video_path),
            safe_frame,
            safe_width,
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return Response(
        content=image,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )

# --- Endpoint Phục vụ Keyframes Phân đoạn và Vạn năng ---
@router.get("/keyframes/{frame_name}")
async def get_keyframe(frame_name: str):
    target_path = resolve_keyframe_path_sync(frame_name)
    if target_path:
        return FileResponse(
            target_path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=31536000"}
        )
    raise HTTPException(status_code=404, detail=f"Keyframe {frame_name} not found")

@router.get("/image/{video_id}/{frame_id}")
async def get_image(video_id: str, frame_id: str):
    # DRES format expects something like K01_V001_0001/000000
    frame_name = f"{video_id}_{frame_id}.webp"
    target_path = resolve_keyframe_path_sync(frame_name)
    if target_path:
        return FileResponse(
            target_path,
            media_type="image/webp",
            headers={"Cache-Control": "public, max-age=31536000"}
        )
    
    # Fallback without extension
    target_path = resolve_keyframe_path_sync(f"{video_id}_{frame_id}")
    if target_path:
        return FileResponse(
            target_path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=31536000"}
        )
    raise HTTPException(status_code=404, detail=f"Image {video_id}/{frame_id} not found")

@router.post("/check_temporal_frames")
async def check_temporal_frames(request: TemporalFrameRequest):
    base_name = request.base_frame_name
    from backend.core.runtime import frame_context_cache
    
    if frame_context_cache and base_name in frame_context_cache:
        return frame_context_cache[base_name]

    DB_PATH = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/frame_context.sqlite"
    
    if os.path.exists(DB_PATH):
        try:
            import sqlite3
            def query_db():
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("SELECT context_list FROM neighbors WHERE frame_name = ?", (base_name,))
                row = cursor.fetchone()
                conn.close()
                if row:
                    return json.loads(row[0])
                return None
                
            neighbors = await asyncio.to_thread(query_db)
            if neighbors:
                return neighbors
        except Exception as e:
            print(f"Error querying SQLite frame context cache: {e}")
    # Fallback to globbing logic similar to keyframe_neighbor.py if cache misses or doesn't exist
    parts = base_name.split("_")
    if len(parts) >= 4:
        prefix = f"{parts[0]}_{parts[1]}_"
        pattern = os.path.join(IMAGE_BASE_PATH, f"{prefix}*.webp")
        files = glob.glob(pattern)
        
        def sort_key(filepath):
            filename = os.path.basename(filepath)
            fps = filename.split("_")
            if len(fps) >= 4:
                return fps[3]
            return filename
            
        files.sort(key=sort_key)
        if not base_name.endswith(".webp"):
            target_path = os.path.join(IMAGE_BASE_PATH, base_name + ".webp")
        else:
            target_path = os.path.join(IMAGE_BASE_PATH, base_name)
        try:
            idx = files.index(target_path)
        except ValueError:
            # target_path not found, find the closest file by frame index
            try:
                target_frame = int(parts[3].split('.')[0])
                closest_idx = 0
                min_diff = float('inf')
                for i, f in enumerate(files):
                    f_parts = os.path.basename(f).split("_")
                    if len(f_parts) >= 4:
                        f_frame = int(f_parts[3].split('.')[0])
                        diff = abs(f_frame - target_frame)
                        if diff < min_diff:
                            min_diff = diff
                            closest_idx = i
                idx = closest_idx
            except:
                return [base_name]

        start_index = max(0, idx - 10)
        end_index = min(len(files), idx + 11)
        neighbors = files[start_index:end_index]
        return [os.path.basename(p) for p in neighbors]
            
    return [base_name]

@router.post("/upload_image")
async def upload_image(image: UploadFile = File(...)):
    if not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type.")
    
    temp_filename = f"{uuid.uuid4()}.jpg"
    temp_filepath = TEMP_UPLOAD_DIR / temp_filename
    
    def write_and_convert_file():
        from PIL import Image
        import io
        img_bytes = image.file.read()
        try:
            with Image.open(io.BytesIO(img_bytes)) as pil_img:
                if pil_img.mode in ("RGBA", "P"):
                    pil_img = pil_img.convert("RGB")
                pil_img.save(temp_filepath, format="JPEG")
        except Exception as e:
            # Fallback to direct write if PIL fails
            with temp_filepath.open("wb") as buffer:
                buffer.write(img_bytes)
            
    try:
        await asyncio.to_thread(write_and_convert_file)
    except Exception as e:
        print(f"File upload disk write failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to write uploaded image: {e}")
        
    return {"temp_image_name": temp_filename}

@router.get("/proxy_image")
async def proxy_image(url: str):
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        def fetch_image():
            resp = requests.get(url, stream=True, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            extension = ".jpg"
            if "png" in resp.headers.get("Content-Type", ""):
                extension = ".png"
            temp_filename = f"proxy_{uuid.uuid4()}{extension}"
            temp_filepath = TEMP_UPLOAD_DIR / temp_filename
            with temp_filepath.open("wb") as buffer:
                for chunk in resp.iter_content(chunk_size=8192):
                    buffer.write(chunk)
            return temp_filepath
            
        temp_filepath = await asyncio.to_thread(fetch_image)
        return FileResponse(temp_filepath, headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        print(f"Proxy image failed for {url}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch proxy image")

# --- WebSockets ---
