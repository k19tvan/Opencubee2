#!/usr/bin/env python3
"""
Tool: build_scene_frame_mapping.py
Chức năng: 
1. Đọc các file JSON trong transcription/semantic_level/ để tạo storage/scene_frame_mapping.json.
2. Đọc các file JSON trong transcription/sentence_level_gemini/ để tạo storage/scene_frame_mapping_sentence_level.json.

Quy trình: Quy đổi mốc giây (start/end) sang frame_id bằng FPS, tìm các keyframe thuộc khoảng (start_id, end_id)
và gắn danh sách keyframe đó vào trường frame_inside.
"""

import json
import os
import sys
from pathlib import Path

STORAGE_DIR = Path(__file__).resolve().parents[2] / "storage"
DEFAULT_SEMANTIC_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/asr/transcription/semantic_level")
DEFAULT_SENTENCE_GEMINI_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/asr/transcription/sentence_level_gemini")


def get_frames_inside(video_id: str, start_id: int, end_id: int, video_mapping: dict) -> list[str]:
    kf_list = video_mapping.get(video_id, [])
    frames_inside = []
    for kf_name in kf_list:
        stem = os.path.splitext(kf_name)[0]
        try:
            frame_num = int(stem.rsplit("_", 1)[-1])
            if start_id <= frame_num <= end_id:
                frames_inside.append(kf_name)
        except ValueError:
            pass
    return frames_inside


def build_semantic_level(semantic_dir: Path, video_mapping: dict, fps_mapping: dict):
    """Tạo storage/scene_frame_mapping.json từ thư mục transcription/semantic_level."""
    if not semantic_dir.exists():
        print(f"[WARNING] Bỏ qua Semantic Level: Không tìm thấy thư mục {semantic_dir}")
        return

    print(f"--- Đang tạo scene_frame_mapping.json từ: {semantic_dir} ---")
    result = {}

    for file_name in sorted(os.listdir(semantic_dir)):
        if not file_name.endswith(".json"):
            continue

        video_id = os.path.splitext(file_name)[0]
        fps = fps_mapping.get(video_id, 25.0)
        file_path = semantic_dir / file_name

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            continue

        contents = data.get("contents", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])

        for idx, item in enumerate(contents):
            if not isinstance(item, dict):
                continue

            try:
                start_sec = float(item.get("start", 0))
                end_sec = float(item.get("end", 0))
            except (ValueError, TypeError):
                continue

            summary = str(item.get("summary") or item.get("text") or "").strip()
            start_id = int(round(start_sec * fps))
            end_id = int(round(end_sec * fps))

            frames_inside = get_frames_inside(video_id, start_id, end_id, video_mapping)
            scene_id = f"{video_id}_{idx}"

            result[scene_id] = {
                "video_id": video_id,
                "start_id": start_id,
                "end_id": end_id,
                "summary": summary,
                "frame_inside": frames_inside
            }

    out_path = STORAGE_DIR / "scene_frame_mapping.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[THÀNH CÔNG] Đã lưu scene_frame_mapping.json ({len(result)} scenes từ {len(os.listdir(semantic_dir))} files)")


def build_sentence_level_gemini(sentence_dir: Path, video_mapping: dict, fps_mapping: dict):
    """Tạo storage/scene_frame_mapping_sentence_level.json từ thư mục transcription/sentence_level_gemini."""
    if not sentence_dir.exists():
        print(f"[WARNING] Bỏ qua Sentence Level: Không tìm thấy thư mục {sentence_dir}")
        return

    print(f"--- Đang tạo scene_frame_mapping_sentence_level.json từ: {sentence_dir} ---")
    result = {}

    for file_name in sorted(os.listdir(sentence_dir)):
        if not file_name.endswith(".json"):
            continue

        video_id = os.path.splitext(file_name)[0]
        fps = fps_mapping.get(video_id, 25.0)
        file_path = sentence_dir / file_name

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                sentences = json.load(f)
        except Exception:
            continue

        if not isinstance(sentences, list):
            continue

        for idx, item in enumerate(sentences):
            if not isinstance(item, dict):
                continue

            try:
                start_sec = float(item.get("start", 0))
                end_sec = float(item.get("end", 0))
            except (ValueError, TypeError):
                continue

            text = str(item.get("text") or item.get("summary") or "").strip()
            start_id = int(round(start_sec * fps))
            end_id = int(round(end_sec * fps))

            frames_inside = get_frames_inside(video_id, start_id, end_id, video_mapping)
            sentence_id = f"{video_id}_{idx}"

            result[sentence_id] = {
                "video_id": video_id,
                "start_id": start_id,
                "end_id": end_id,
                "summary": text,
                "frame_inside": frames_inside
            }

    out_path = STORAGE_DIR / "scene_frame_mapping_sentence_level.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[THÀNH CÔNG] Đã lưu scene_frame_mapping_sentence_level.json ({len(result)} sentences từ {len(os.listdir(sentence_dir))} files)")


def main():
    semantic_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SEMANTIC_DIR
    sentence_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_SENTENCE_GEMINI_DIR

    video_map_file = STORAGE_DIR / "video_frame_mapping.json"
    fps_map_file = STORAGE_DIR / "fps_mapping.json"

    if not video_map_file.exists():
        print(f"[ERROR] Thiếu file {video_map_file}. Hãy chạy build_video_frame_mapping.py trước.")
        sys.exit(1)

    with open(video_map_file, "r", encoding="utf-8") as f:
        video_mapping = json.load(f)

    fps_mapping = {}
    if fps_map_file.exists():
        with open(fps_map_file, "r", encoding="utf-8") as f:
            fps_mapping = json.load(f)

    # 1. Build Scene Level từ semantic_level
    build_semantic_level(semantic_dir, video_mapping, fps_mapping)

    # 2. Build Sentence Level từ sentence_level_gemini
    build_sentence_level_gemini(sentence_dir, video_mapping, fps_mapping)


if __name__ == "__main__":
    main()
