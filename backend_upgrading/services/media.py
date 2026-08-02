from __future__ import annotations

import asyncio
import json
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import HTTPException

from backend.core import runtime
from backend.core.config import OCR_ASR_INDEX_NAME, VIDEO_DIR, VIDEO_EXTENSIONS

@lru_cache(maxsize=2000)
def resolve_video_path(video_id: str) -> Path:
    if not video_id or any(part in video_id for part in ("..", "/", "\\")):
        raise HTTPException(status_code=400, detail="Invalid video id.")

    candidates = []
    raw_path = VIDEO_DIR / video_id
    if raw_path.suffix.lower() in VIDEO_EXTENSIONS:
        candidates.append(raw_path)
    else:
        candidates.extend(VIDEO_DIR / f"{video_id}{ext}" for ext in VIDEO_EXTENSIONS)
        candidates.extend(path for path in VIDEO_DIR.glob(f"{video_id}.*") if path.suffix.lower() in VIDEO_EXTENSIONS)

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            resolved.relative_to(VIDEO_DIR)
        except ValueError:
            continue
        if resolved.is_file():
            return resolved

    raise HTTPException(status_code=404, detail=f"Video not found for id: {video_id}")

@lru_cache(maxsize=2000)
def probe_video_info(video_path: Path) -> Dict[str, Any]:
    try:
        import cv2
        capture = cv2.VideoCapture(str(video_path))
        if capture.isOpened():
            fps = capture.get(cv2.CAP_PROP_FPS) or 0
            frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            duration = frame_count / fps if fps > 0 and frame_count > 0 else 0
            capture.release()
            if fps > 0:
                return {"fps": fps, "frame_count": frame_count, "duration": duration}
        capture.release()
    except Exception:
        pass

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate,avg_frame_rate,nb_frames,duration",
                "-of", "json",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if result.returncode == 0 and result.stdout:
            data = json.loads(result.stdout)
            stream = (data.get("streams") or [{}])[0]
            rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1"
            numerator, denominator = [float(part) for part in rate.split("/", 1)]
            fps = numerator / denominator if denominator else 0
            duration = float(stream.get("duration") or 0)
            frame_count = int(stream.get("nb_frames") or round(duration * fps) or 0)
            if fps > 0:
                return {"fps": fps, "frame_count": frame_count, "duration": duration}
    except Exception:
        pass

    return {"fps": 25, "frame_count": 0, "duration": 0}

@lru_cache(maxsize=512)
def render_video_thumbnail(video_path_str: str, frame_id: int, width: int) -> bytes:
    import cv2
    import numpy as np
    import av
    
    # Use PyAV for frame-accurate seeking
    try:
        container = av.open(video_path_str)
        stream = container.streams.video[0]
        fps = stream.average_rate
        
        target_pts = None
        if fps and fps > 0:
            target_time = float(frame_id) / float(fps)
            target_pts = int(target_time / stream.time_base)
            container.seek(target_pts, stream=stream, backward=True, any_frame=False)
            
        for av_frame in container.decode(stream):
            if target_pts is not None and av_frame.pts is not None and av_frame.pts < target_pts:
                continue
                
            img = av_frame.to_ndarray(format='bgr24')
            source_height, source_width = img.shape[:2]
            if source_width > width:
                height = max(1, round(source_height * (width / source_width)))
                img = cv2.resize(img, (width, height), interpolation=cv2.INTER_AREA)

            encoded, buffer = cv2.imencode(
                ".jpg",
                img,
                [int(cv2.IMWRITE_JPEG_QUALITY), 72],
            )
            if encoded:
                return buffer.tobytes()
                
        raise ValueError(f"Could not decode frame {frame_id}.")
    except Exception as e:
        # Fallback to OpenCV if PyAV fails
        try:
            capture = cv2.VideoCapture(video_path_str)
            if capture.isOpened():
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_id)
                ok, frame = capture.read()
                capture.release()
                
                if ok and frame is not None:
                    source_height, source_width = frame.shape[:2]
                    if source_width > width:
                        height = max(1, round(source_height * (width / source_width)))
                        frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)

                    encoded, buffer = cv2.imencode(
                        ".jpg",
                        frame,
                        [int(cv2.IMWRITE_JPEG_QUALITY), 72],
                    )
                    if encoded:
                        return buffer.tobytes()
        except Exception:
            pass
            
        raise ValueError(f"Could not process video: {str(e)}")

@lru_cache(maxsize=100000)
def resolve_keyframe_path_sync(frame_name: str) -> Optional[Path]:
    if not frame_name or any(part in frame_name for part in ("..", "/", "\\")):
         return None

    candidate_dirs = [
        Path("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/keyframes_beit3_096"),
        Path("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/ocr_vlm_keyframes_full"),
        Path("/mlcv1/Datasets/HCMAI25/keyframes"),
        Path("/mlcv1/Datasets/HCMAI25/frames"),
        Path("/mlcv1/Datasets/HCMAI25/full/keyframes"),
        Path("/mlcv1/Datasets/HCMAI25/full/frames"),
    ]

    for directory in candidate_dirs:
        try:
            resolved_dir = directory.resolve()
            
            # Check original requested extension
            target = resolved_dir / frame_name
            if target.is_file():
                return target
                
            # Fallbacks for other extensions
            base_name = os.path.splitext(frame_name)[0]
            for ext in [".webp", ".jpg", ".jpeg", ".png"]:
                fallback = resolved_dir / f"{base_name}{ext}"
                if fallback.is_file():
                    return fallback
            
            # Also check subdirectories (e.g., K01)
            prefix = frame_name.split("_")[0]
            target_sub = resolved_dir / prefix / frame_name
            if target_sub.is_file():
                return target_sub
                
            for ext in [".webp", ".jpg", ".jpeg", ".png"]:
                fallback_sub = resolved_dir / prefix / f"{base_name}{ext}"
                if fallback_sub.is_file():
                    return fallback_sub
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
                        return target_path
        except Exception as e:
            print(f"[resolve_keyframe_path] Meilisearch fallback failed: {e}")

    return None


async def resolve_keyframe_path(shot: Dict[str, Any]) -> Optional[Path]:
    filepath = shot.get("filepath") or shot.get("file_path")
    if filepath:
        try:
            path_obj = Path(filepath).resolve()
            if path_obj.is_file():
                return path_obj
        except Exception:
            pass

    frame_name = shot.get("frame_name", "")
    if not frame_name:
        return None

    return await asyncio.to_thread(resolve_keyframe_path_sync, frame_name)


# --- Refactored Grid Generation Functions ---
from PIL import Image
import io
from pathlib import Path

def generate_grid_canvas(image_paths: list[Path], output_path: Path, cols=5, thumb_size=(320, 180)):
    """Tạo ảnh lưới 5x4 từ danh sách path. Tối ưu bằng cách resize trước khi dán."""
    rows = (len(image_paths) + cols - 1) // cols
    canvas_w = cols * thumb_size[0]
    canvas_h = rows * thumb_size[1]
    grid_img = Image.new("RGB", (canvas_w, canvas_h), (30, 30, 30))
    
    for idx, path in enumerate(image_paths):
        try:
            with Image.open(path) as img:
                img = img.resize(thumb_size, Image.Resampling.LANCZOS)
                x = (idx % cols) * thumb_size[0]
                y = (idx // cols) * thumb_size[1]
                grid_img.paste(img, (x, y))
                # Vẽ số thứ tự lên ảnh để VLM dễ gọi index
                from PIL import ImageDraw
                draw = ImageDraw.Draw(grid_img)
                draw.text((x + 5, y + 5), str(idx + 1), fill=(255, 255, 0))
        except Exception:
            continue
            
    grid_img.save(output_path, "JPEG", quality=80)