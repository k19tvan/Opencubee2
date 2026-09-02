#!/usr/bin/env python3
"""
Tool: build_fps_mapping.py
Chức năng: Trích xuất chỉ số FPS của toàn bộ video trong thư mục dataset
và xuất ra file storage/fps_mapping.json.
"""

import json
import os
import sys
from pathlib import Path

DEFAULT_VIDEO_DIR = Path("/mlcv1/Datasets/HCMAI25/videos")
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parents[2] / "storage" / "fps_mapping.json"
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm"}


def get_video_fps(video_path: Path) -> float:
    # 1. Thử dùng OpenCV
    try:
        import cv2
        cap = cv2.VideoCapture(str(video_path))
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS)
            cap.release()
            if fps and fps > 0:
                return float(fps)
    except Exception:
        pass

    # 2. Thử dùng ffprobe
    try:
        import subprocess
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate,avg_frame_rate",
            "-of", "json", str(video_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            data = json.loads(res.stdout)
            stream = (data.get("streams") or [{}])[0]
            rate = stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1"
            num, den = [float(p) for p in rate.split("/", 1)]
            if den > 0:
                return num / den
    except Exception:
        pass

    return 25.0  # Mặc định fallback 25 FPS


def build_fps_mapping(video_dir: Path, output_file: Path):
    if not video_dir.exists():
        print(f"[WARNING] Thư mục video không tồn tại: {video_dir}. Đang thử tìm trong các vị trí mặc định khác...")
        alt_dirs = [
            Path("/mlcv1/Datasets/HCMAI25"),
            Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/videos")
        ]
        for d in alt_dirs:
            if d.exists():
                video_dir = d
                break

    print(f"--- Đang trích xuất FPS từ thư mục: {video_dir} ---")
    fps_map = {}

    for root, _, files in os.walk(video_dir):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in VIDEO_EXTENSIONS:
                video_id = os.path.splitext(file)[0]
                video_path = Path(root) / file
                fps = get_video_fps(video_path)
                fps_map[video_id] = round(fps, 3)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(fps_map, f, ensure_ascii=False, indent=2)

    print(f"[THÀNH CÔNG] Đã lưu fps_mapping.json tại: {output_file} ({len(fps_map)} videos)")


if __name__ == "__main__":
    v_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_VIDEO_DIR
    out_file = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT_PATH
    build_fps_mapping(v_dir, out_file)
