#!/usr/bin/env python3
"""
Tool: build_video_frame_mapping.py
Chức năng: Quét thư mục chứa keyframes, phân loại theo video_id và sắp xếp thứ tự khung hình,
sau đó xuất ra file storage/video_frame_mapping.json.
"""

import json
import os
import sys
from pathlib import Path

# Đường dẫn mặc định
DEFAULT_KEYFRAME_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/keyframes/beit3_096_filtered")
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parents[2] / "storage" / "video_frame_mapping.json"


def parse_frame_info(filename: str):
    """
    Phân tích tên file keyframe dạng K01_V001_0016_001023.webp
    Trả về (video_id, frame_id)
    """
    stem = os.path.splitext(filename)[0]
    parts = stem.split("_")
    if len(parts) >= 3:
        video_id = "_".join(parts[:2])
        try:
            frame_id = int(parts[-1])
            return video_id, frame_id
        except ValueError:
            pass
    return None, None


def build_video_frame_mapping(keyframe_dir: Path, output_file: Path):
    if not keyframe_dir.exists():
        print(f"[ERROR] Thư mục keyframe không tồn tại: {keyframe_dir}")
        sys.exit(1)

    print(f"--- Đang quét keyframes từ: {keyframe_dir} ---")
    video_map = {}
    valid_extensions = {".webp", ".jpg", ".jpeg", ".png"}

    for root, _, files in os.walk(keyframe_dir):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in valid_extensions:
                video_id, frame_id = parse_frame_info(file)
                if video_id and frame_id is not None:
                    video_map.setdefault(video_id, []).append((frame_id, file))

    print(f"--- Đã tìm thấy {len(video_map)} video. Đang sắp xếp khung hình... ---")
    result = {}
    for video_id, items in video_map.items():
        items.sort(key=lambda x: x[0])
        result[video_id] = [item[1] for item in items]

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[THÀNH CÔNG] Đã lưu video_frame_mapping.json tại: {output_file} ({len(result)} videos)")


if __name__ == "__main__":
    kf_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_KEYFRAME_DIR
    out_file = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT_PATH
    build_video_frame_mapping(kf_dir, out_file)
