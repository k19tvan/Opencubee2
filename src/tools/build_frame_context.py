#!/usr/bin/env python3
"""
Tool: build_frame_context.py
Chức năng: Đọc video_frame_mapping.json và tính toán danh sách ngữ cảnh
(20 keyframe trước + 20 keyframe sau) cho từng keyframe, xuất ra storage/frame_context.json.
"""

import json
import sys
from pathlib import Path

DEFAULT_MAPPING_PATH = Path(__file__).resolve().parents[2] / "storage" / "video_frame_mapping.json"
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parents[2] / "storage" / "frame_context.json"
RADIUS = 20


def build_frame_context(mapping_file: Path, output_file: Path, radius: int = RADIUS):
    if not mapping_file.exists():
        print(f"[ERROR] Không tìm thấy {mapping_file}")
        sys.exit(1)

    print(f"--- Đang tải {mapping_file}... ---")
    with open(mapping_file, "r", encoding="utf-8") as f:
        video_mapping = json.load(f)

    context_map = {}
    print("--- Đang tính toán ngữ cảnh keyframe (frame_context)... ---")

    for video_id, frame_list in video_mapping.items():
        total_frames = len(frame_list)
        for idx, frame_name in enumerate(frame_list):
            start_idx = max(0, idx - radius)
            end_idx = min(total_frames, idx + radius + 1)
            neighbors = frame_list[start_idx:end_idx]
            context_map[frame_name] = neighbors

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(context_map, f, ensure_ascii=False)

    print(f"[THÀNH CÔNG] Đã tạo frame_context.json tại: {output_file} ({len(context_map)} keyframes)")


if __name__ == "__main__":
    map_file = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_MAPPING_PATH
    out_file = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT_PATH
    build_frame_context(map_file, out_file)
