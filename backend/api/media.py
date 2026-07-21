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

class TemporalFrameRequest(BaseModel):
    base_frame_name: str

FRAME_CONTEXT_CACHE = None
CACHE_PATH = "/AIClub_NAS/nguyenmv/Opencubee2/results/frame_context_cache.json"
IMAGE_BASE_PATH = "/AIClub_NAS/nguyenmv/Opencubee2/results/keyframes_full"

from backend.core import runtime
from backend.core.config import MODEL_CONFIGS, OCR_ASR_INDEX_NAME, TEMP_UPLOAD_DIR
from backend.services.media import probe_video_info, render_video_thumbnail, resolve_video_path

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
    return FileResponse(video_path, media_type=media_type, filename=video_path.name)

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
    if any(part in frame_name for part in ("..", "/", "\\")):
         raise HTTPException(status_code=400, detail="Invalid frame name")

    candidate_dirs = [
        Path("/AIClub_NAS/nguyenmv/Opencubee2/results/keyframes_full"),
        Path("/AIClub_NAS/nguyenmv/Opencubee2/results/frames"),
        Path("/mlcv1/Datasets/HCMAI25/keyframes"),
        Path("/mlcv1/Datasets/HCMAI25/frames"),
        Path("/mlcv1/Datasets/HCMAI25/full/keyframes"),
        Path("/mlcv1/Datasets/HCMAI25/full/frames"),
        Path("/AIClub_NAS/nguyenmv/Opencubee2/database/keyframes"),
    ]

    for directory in candidate_dirs:
        try:
            resolved_dir = directory.resolve()
            target = resolved_dir / frame_name
            if target.is_file():
                return FileResponse(target, media_type="image/jpeg")
            
            prefix = frame_name.split("_")[0]
            target_sub = resolved_dir / prefix / frame_name
            if target_sub.is_file():
                return FileResponse(target_sub, media_type="image/jpeg")
        except Exception:
            continue

    if runtime.meili_client:
        try:
            index = runtime.meili_client.index(OCR_ASR_INDEX_NAME)
            response = index.search(frame_name, {"limit": 1})
            hits = response.get("hits", [])
            if hits:
                exact_path = hits[0].get("file_path") or hits[0].get("filepath")
                if exact_path:
                    target_path = Path(exact_path).resolve()
                    if target_path.is_file():
                        return FileResponse(target_path, media_type="image/jpeg")
        except Exception as e:
            print(f"[Keyframe Route Fallback] Resolution lookup failed: {e}")

    raise HTTPException(status_code=404, detail=f"Keyframe {frame_name} not found")

@router.post("/check_temporal_frames")
async def check_temporal_frames(request: TemporalFrameRequest):
    base_name = request.base_frame_name
    
    DB_PATH = "/AIClub_NAS/nguyenmv/Opencubee2/results/frame_context.sqlite"
    
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
            start_index = max(0, idx - 10)
            end_index = min(len(files), idx + 11)
            neighbors = files[start_index:end_index]
            return [os.path.basename(p) for p in neighbors]
        except ValueError:
            pass
            
    return [base_name]

@router.post("/upload_image")
async def upload_image(image: UploadFile = File(...)):
    if not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type.")
    
    extension = Path(image.filename).suffix
    temp_filename = f"{uuid.uuid4()}{extension}"
    temp_filepath = TEMP_UPLOAD_DIR / temp_filename
    
    def write_file():
        with temp_filepath.open("wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
            
    try:
        await asyncio.to_thread(write_file)
    except Exception as e:
        print(f"File upload disk write failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to write uploaded image: {e}")
        
    return {"temp_image_name": temp_filename}

# --- WebSockets ---
