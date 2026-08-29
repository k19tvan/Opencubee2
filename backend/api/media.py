from __future__ import annotations

import asyncio
from functools import lru_cache
import math
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
    mode: str = "all"  # "all" or "shot"

IMAGE_BASE_PATH = "/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/keyframes/beit3_096_filtered"
CONTEXT_FRAME_RADIUS = 20
PROJECT_ROOT = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25")
WORD_LEVEL_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/Opencubee2/storage/asr/word_level")
FPS_MAPPING_PATH = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/Opencubee2/storage/fps_mapping.json")
VIDEO_FRAME_MAPPING_PATH = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/Opencubee2/storage/video_frame_mapping.json")

from backend.core import runtime
from backend.core.config import MODEL_CONFIGS, OCR_ASR_INDEX_NAME, TEMP_UPLOAD_DIR
from backend.services.media import probe_video_info, render_video_thumbnail, resolve_video_path, resolve_keyframe_path_sync

router = APIRouter()


@lru_cache(maxsize=1)
def load_fps_mapping() -> dict[str, float]:
    with FPS_MAPPING_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return {
        video_id: float(fps)
        for video_id, fps in data.items()
        if isinstance(video_id, str)
        and isinstance(fps, (int, float))
        and math.isfinite(float(fps))
        and float(fps) > 0
    }


@lru_cache(maxsize=1)
def load_video_frame_mapping() -> dict[str, list[str]]:
    with VIDEO_FRAME_MAPPING_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError("Video frame mapping must be a JSON object")
    return data


@lru_cache(maxsize=4)
def load_word_timeline(video_id: str) -> tuple[float, list[dict]]:
    fps = load_fps_mapping().get(video_id)
    if fps is None:
        raise ValueError(f"Missing FPS for video {video_id}")

    transcription_path = WORD_LEVEL_DIR / f"{video_id}.json"
    with transcription_path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise ValueError("Word-level transcription must be a JSON array")

    words = []
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("word"), str):
            continue
        try:
            start = float(item["start"])
            end = float(item["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
            continue
        words.append({
            "word": item["word"],
            "start": start,
            "end": end,
            "start_frame_id": int(start * fps + 0.5),
            "end_frame_id": int(end * fps + 0.5),
        })
    return fps, words


def validate_video_id(video_id: str) -> None:
    safe_video_id = os.path.basename(video_id)
    if safe_video_id != video_id or not all(
        character.isalnum() or character in {"_", "-"}
        for character in video_id
    ):
        raise HTTPException(status_code=400, detail="Invalid video ID")


def select_surrounding_keyframes(candidates, target_frame: int):
    """Return up to 20 keyframes before and 20 after a dynamic video frame.

    This is retained as a legacy fallback for deployments without the
    video-frame mapping.  Normal context requests use
    ``select_surrounding_shots`` below so a long shot cannot fill the panel
    with near-identical keyframes.
    """
    ordered = sorted(candidates, key=lambda candidate: candidate[0])
    before = [candidate for candidate in ordered if candidate[0] < target_frame][-CONTEXT_FRAME_RADIUS:]
    after = [candidate for candidate in ordered if candidate[0] >= target_frame][:CONTEXT_FRAME_RADIUS]
    selected = before + after

    # At the start/end of a video, fill the missing side with the closest
    # remaining keyframes so the user still gets up to 40 context keyframes.
    target_count = min(CONTEXT_FRAME_RADIUS * 2, len(ordered))
    if len(selected) < target_count:
        selected_names = {name for _, name in selected}
        remaining = [candidate for candidate in ordered if candidate[1] not in selected_names]
        selected.extend(sorted(remaining, key=lambda candidate: abs(candidate[0] - target_frame))[:target_count - len(selected)])

    return [name for _, name in sorted(selected, key=lambda candidate: candidate[0])]


def parse_mapped_keyframe(frame_name: str):
    """Return ``(frame_id, shot_id, frame_name)`` for a mapped keyframe.

    Keyframes follow ``<collection>_<video>_<shot>_<frame>.webp``.  The shot
    portion is intentionally kept as part of the ID: if a visually similar
    scene returns later in the video it has a new shot ID and must remain in
    the storyboard.
    """
    name = os.path.basename(frame_name)
    stem = os.path.splitext(name)[0]
    parts = stem.split("_")
    if len(parts) < 4:
        return None
    try:
        frame_id = int(parts[-1])
    except ValueError:
        return None
    return frame_id, "_".join(parts[:-1]), name


def select_surrounding_shots(frame_names, base_name: str, target_frame: int):
    """Build a chronological, shot-level storyboard around a target frame.

    First take the normal local window (up to 20 keyframes before and 20 from
    the target onwards).  Only then collapse consecutive keyframes in the
    same shot.  If that leaves fewer than 40 cards, expand with the nearest
    adjacent shots until the panel is full.  This preserves every scene in the
    initial local window without filling the remaining space with duplicates.
    """
    parsed_frames = [parsed for name in frame_names if (parsed := parse_mapped_keyframe(name))]
    if not parsed_frames:
        return None

    parsed_frames.sort(key=lambda item: item[0])
    local_frame_names = set(select_surrounding_keyframes(
        [(frame_id, frame_name) for frame_id, _, frame_name in parsed_frames],
        target_frame,
    ))
    shots = []
    for frame_id, shot_id, frame_name in parsed_frames:
        if not shots or shots[-1]["shot_id"] != shot_id:
            shots.append({"shot_id": shot_id, "frames": []})
        shots[-1]["frames"].append((frame_id, frame_name))

    normalized_base_name = os.path.basename(base_name)
    center_index = next(
        (
            index
            for index, shot in enumerate(shots)
            if any(frame_name == normalized_base_name for _, frame_name in shot["frames"])
        ),
        None,
    )
    if center_index is None:
        # Video-preview frames are dynamic and have no keyframe entry.  Pick
        # the shot containing their timestamp, or the closest end shot.
        center_index = next(
            (
                index
                for index, shot in enumerate(shots)
                if target_frame <= shot["frames"][-1][0]
            ),
            len(shots) - 1,
        )

    local_shot_indices = [
        index
        for index, shot in enumerate(shots)
        if any(frame_name in local_frame_names for _, frame_name in shot["frames"])
    ]
    if not local_shot_indices:
        return None

    # Keep every shot seen in the 40-keyframe local window, then extend its
    # contiguous range with whichever adjacent shot is temporally closer to
    # the target.  A returned scene remains a separate shot and is retained.
    start = min(local_shot_indices)
    end = max(local_shot_indices) + 1
    target_count = min(CONTEXT_FRAME_RADIUS * 2, len(shots))
    while end - start < target_count and (start > 0 or end < len(shots)):
        left_distance = (
            target_frame - shots[start - 1]["frames"][-1][0]
            if start > 0
            else math.inf
        )
        right_distance = (
            shots[end]["frames"][0][0] - target_frame
            if end < len(shots)
            else math.inf
        )
        if left_distance <= right_distance:
            start -= 1
        else:
            end += 1

    selected = []
    for index in range(start, end):
        shot = shots[index]
        frames = shot["frames"]
        if index == center_index:
            original = next(
                (frame_name for _, frame_name in frames if frame_name == normalized_base_name),
                None,
            )
            if original:
                selected.append(original)
                continue
        # The closest keyframe to the target is deterministic: the last frame
        # for a preceding shot and the first frame for a following shot.
        _, representative = min(frames, key=lambda item: abs(item[0] - target_frame))
        selected.append(representative)
    return selected

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

from fastapi import APIRouter, File, HTTPException, UploadFile, Body, Header

# --- Endpoint API tìm kiếm chính (Đơn tầng) ---
@router.get("/videos/{video_id}")
async def get_video(
    video_id: str,
    x_accel_supported: Optional[str] = Header(None, alias="X-Accel-Supported"),
):
    video_path = resolve_video_path(video_id)
    media_type = mimetypes.guess_type(video_path.name)[0] or "video/mp4"

    # Offload directly to Nginx kernel-level sendfile if running behind reverse proxy
    if x_accel_supported == "1" or os.getenv("FORCE_X_ACCEL", "0") == "1":
        return Response(
            content=b"",
            media_type=media_type,
            headers={
                "X-Accel-Redirect": f"/_internal_fs{video_path.resolve()}",
                "Content-Type": media_type,
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        )

    return FileResponse(
        video_path,
        media_type=media_type,
        filename=video_path.name,
        headers={"Cache-Control": "public, max-age=31536000"},
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
async def get_keyframe(
    frame_name: str,
    x_accel_supported: Optional[str] = Header(None, alias="X-Accel-Supported"),
):
    target_path = resolve_keyframe_path_sync(frame_name)
    if not target_path:
        raise HTTPException(status_code=404, detail=f"Keyframe {frame_name} not found")

    media_type = mimetypes.guess_type(target_path.name)[0] or "image/jpeg"
    if x_accel_supported == "1" or os.getenv("FORCE_X_ACCEL", "0") == "1":
        return Response(
            content=b"",
            media_type=media_type,
            headers={
                "X-Accel-Redirect": f"/_internal_fs{target_path.resolve()}",
                "Content-Type": media_type,
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        )

    return FileResponse(
        target_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000"},
    )

@router.get("/image/{video_id}/{frame_id}")
async def get_image(
    video_id: str,
    frame_id: str,
    x_accel_supported: Optional[str] = Header(None, alias="X-Accel-Supported"),
):
    # DRES format expects something like K01_V001_0001/000000
    frame_name = f"{video_id}_{frame_id}.webp"
    target_path = resolve_keyframe_path_sync(frame_name)
    if not target_path:
        target_path = resolve_keyframe_path_sync(f"{video_id}_{frame_id}")

    if not target_path:
        raise HTTPException(status_code=404, detail=f"Image {video_id}/{frame_id} not found")

    media_type = mimetypes.guess_type(target_path.name)[0] or "image/webp"
    if x_accel_supported == "1" or os.getenv("FORCE_X_ACCEL", "0") == "1":
        return Response(
            content=b"",
            media_type=media_type,
            headers={
                "X-Accel-Redirect": f"/_internal_fs{target_path.resolve()}",
                "Content-Type": media_type,
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        )

    return FileResponse(
        target_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000"},
    )

@router.post("/check_temporal_frames")
async def check_temporal_frames(request: TemporalFrameRequest):
    base_name = os.path.basename(request.base_frame_name)
    parts = base_name.split("_")
    video_id = "_".join(parts[:2]) if len(parts) >= 3 else None
    try:
        target_frame = int(os.path.splitext(parts[-1])[0]) if video_id else None
    except ValueError:
        target_frame = None

    # Prefer the complete video timeline over the old frame_context cache.
    # The old cache is a raw keyframe window, which can hide an intervening
    # shot behind many nearly identical frames from its neighbours.
    if video_id and target_frame is not None:
        frame_names = runtime.video_frame_mapping.get(video_id)
        if frame_names is None:
            try:
                frame_mapping = await asyncio.to_thread(load_video_frame_mapping)
                frame_names = frame_mapping.get(video_id)
            except (OSError, ValueError):
                frame_names = None
        if frame_names:
            if request.mode == "shot":
                shot_context = select_surrounding_shots(frame_names, base_name, target_frame)
                if shot_context:
                    return shot_context
            else:
                parsed_frames = [parsed for name in frame_names if (parsed := parse_mapped_keyframe(name))]
                candidates = [(f[0], f[2]) for f in parsed_frames]
                all_context = select_surrounding_keyframes(candidates, target_frame)
                if all_context:
                    return all_context

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

            # Dynamic frames from Video Preview are not stored in the context
            # table. Resolve their 40 neighboring keyframes from the same video.
            if video_id and target_frame is not None:
                def query_nearest_context():
                    conn = sqlite3.connect(DB_PATH)
                    cursor = conn.cursor()
                    cursor.execute(
                        "SELECT frame_name FROM neighbors WHERE frame_name GLOB ?",
                        (f"{video_id}_*.webp",),
                    )
                    candidates = []
                    for (frame_name,) in cursor:
                        try:
                            indexed_frame = int(os.path.splitext(frame_name)[0].rsplit("_", 1)[-1])
                        except ValueError:
                            continue
                        candidates.append((indexed_frame, frame_name))
                    conn.close()
                    return select_surrounding_keyframes(candidates, target_frame) if candidates else None

                neighbors = await asyncio.to_thread(query_nearest_context)
                if neighbors:
                    return neighbors
        except Exception as e:
            print(f"Error querying SQLite frame context cache: {e}")
    # Fallback to globbing logic similar to keyframe_neighbor.py if cache misses or doesn't exist
    if video_id and target_frame is not None:
        try:
            # A dynamic frame from Video Preview does not exist as a keyframe.
            # Its name has the form <collection>_<video>_<frame_id>.webp. A
            # persisted keyframe includes an extra shot segment before the
            # frame number, but the first two segments are the stable video ID.
            pattern = os.path.join(IMAGE_BASE_PATH, f"{video_id}_*.webp")
            files = glob.glob(pattern)
            if not files:
                return [base_name]

            def frame_number(filepath):
                return int(os.path.splitext(os.path.basename(filepath))[0].rsplit("_", 1)[-1])

            candidates = [(frame_number(filepath), os.path.basename(filepath)) for filepath in files]
        except (IndexError, ValueError):
            return [base_name]

        return select_surrounding_keyframes(candidates, target_frame)
            
    return [base_name]


@router.get("/video_keyframes/{video_id}")
async def get_video_keyframes(video_id: str):
    """Return every extracted keyframe in a video, ordered by frame ID."""
    validate_video_id(video_id)

    frame_names = runtime.video_frame_mapping.get(video_id)
    if frame_names is None:
        raise HTTPException(
            status_code=404,
            detail=f"No keyframe mapping found for video {video_id}",
        )
    return frame_names


SENTENCE_LEVEL_GEMINI_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/asr/transcription/sentence_level_gemini")
SENTENCE_LEVEL_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/asr/transcription/sentence_level")


@lru_cache(maxsize=16)
def load_sentence_timeline(video_id: str) -> tuple[float, list[dict]]:
    fps = load_fps_mapping().get(video_id, 25.0)
    trans_path = SENTENCE_LEVEL_GEMINI_DIR / f"{video_id}.json"
    if not trans_path.exists():
        trans_path = SENTENCE_LEVEL_DIR / f"{video_id}.json"
    if not trans_path.exists():
        return fps, []

    try:
        with trans_path.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except Exception:
        return fps, []

    sentences = []
    if isinstance(data, list):
        for idx, item in enumerate(data):
            if not isinstance(item, dict):
                continue
            try:
                start = float(item.get("start", 0))
                end = float(item.get("end", 0))
            except (ValueError, TypeError):
                continue
            text = str(item.get("text") or item.get("summary") or "").strip()
            if not text:
                continue
            sentences.append({
                "id": f"{video_id}_{idx}",
                "text": text,
                "start": start,
                "end": end,
                "start_frame_id": int(start * fps + 0.5),
                "end_frame_id": int(end * fps + 0.5),
            })
    return fps, sentences


@router.get("/video_timeline/{video_id}")
async def get_video_timeline(video_id: str):
    """Return full-video keyframes, word timestamps, and sentence-level transcriptions mapped to frame IDs."""
    validate_video_id(video_id)
    frame_names = runtime.video_frame_mapping.get(video_id)
    if frame_names is None:
        frame_mapping = await asyncio.to_thread(load_video_frame_mapping)
        frame_names = frame_mapping.get(video_id)
    if frame_names is None:
        raise HTTPException(
            status_code=404,
            detail=f"No keyframe mapping found for video {video_id}",
        )

    try:
        fps, words = await asyncio.to_thread(load_word_timeline, video_id)
    except Exception:
        fps = load_fps_mapping().get(video_id, 25.0)
        words = []

    _, sentences = await asyncio.to_thread(load_sentence_timeline, video_id)

    return {
        "video_id": video_id,
        "fps": fps,
        "frames": frame_names,
        "words": words,
        "sentences": sentences,
    }

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
    parsed_url = urlparse(url)
    if parsed_url.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Invalid URL")
    try:
        def fetch_image():
            # Image-result URLs are commonly hosted by sites that reject the
            # minimal default requests headers.  Use browser-like headers and
            # follow redirects so Google/Tavily result links can be fetched.
            resp = requests.get(
                url,
                stream=True,
                timeout=(10, 30),
                allow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Referer": "https://www.google.com/",
                },
            )
            resp.raise_for_status()
            content_type = resp.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if not content_type.startswith("image/"):
                raise ValueError(f"Remote URL returned {content_type or 'non-image content'}")
            extension = mimetypes.guess_extension(content_type) or ".jpg"
            temp_filename = f"proxy_{uuid.uuid4()}{extension}"
            temp_filepath = TEMP_UPLOAD_DIR / temp_filename
            with temp_filepath.open("wb") as buffer:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        buffer.write(chunk)
            return temp_filepath
            
        temp_filepath = await asyncio.to_thread(fetch_image)
        return FileResponse(temp_filepath, headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        print(f"Proxy image failed for {url}: {e}")
        raise HTTPException(status_code=502, detail=f"Unable to fetch remote image: {e}")

# --- WebSockets ---
