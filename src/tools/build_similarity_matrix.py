#!/usr/bin/env python3
"""
Tool: build_similarity_matrix.py
Chức năng: Đọc feature vectors BEiT3 của keyframes, tính toán độ tương đồng Cosine
(ngưỡng threshold = 0.9) để xuất ra similar_frames.json và frame_similarity_labels.json
(các nhãn DUP, SAME_SHOT, INTRO, REUSE).
"""

import json
import os
import sys
from pathlib import Path
import numpy as np

STORAGE_DIR = Path(__file__).resolve().parents[2] / "storage"
SIMILARITY_THRESHOLD = 0.90
INTRO_START_WINDOW_FRAMES = 50


def compute_cosine_similarity(feats_a: np.ndarray, feats_b: np.ndarray) -> np.ndarray:
    """Tính Cosine similarity giữa 2 ma trận embeddings đã được L2 normalized."""
    norm_a = feats_a / np.linalg.norm(feats_a, axis=-1, keepdims=True)
    norm_b = feats_b / np.linalg.norm(feats_b, axis=-1, keepdims=True)
    return np.dot(norm_a, norm_b.T)


def build_similarity_labels(
    frame_names: list[str],
    embeddings: np.ndarray,
    threshold: float = SIMILARITY_THRESHOLD
):
    print(f"--- Đang tính toán Cosine Similarity cho {len(frame_names)} keyframes (threshold = {threshold})... ---")

    similar_frames_map = {}
    frame_similarity_labels = {}

    # Chuyển đổi embeddings sang L2 norm
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    normalized_embeddings = embeddings / norms

    # Tính theo block để tránh tràn RAM
    block_size = 1000
    n_frames = len(frame_names)

    for i in range(0, n_frames, block_size):
        end_i = min(i + block_size, n_frames)
        sim_block = np.dot(normalized_embeddings[i:end_i], normalized_embeddings.T)

        for idx_in_block, row in enumerate(sim_block):
            global_idx = i + idx_in_block
            frame_name = frame_names[global_idx]

            # Lấy các index có độ tương đồng >= threshold (loại trừ chính nó)
            match_indices = np.where((row >= threshold) & (np.arange(n_frames) != global_idx))[0]

            if len(match_indices) > 0:
                matched_names = [frame_names[m] for m in match_indices]
                similar_frames_map[frame_name] = matched_names

                # Đánh nhãn
                labels = []
                stem = os.path.splitext(frame_name)[0]
                frame_num = int(stem.rsplit("_", 1)[-1]) if "_" in stem else 0

                for m_idx in match_indices:
                    m_name = frame_names[m_idx]
                    m_stem = os.path.splitext(m_name)[0]
                    m_num = int(m_stem.rsplit("_", 1)[-1]) if "_" in m_stem else 0

                    if abs(frame_num - m_num) <= 5:
                        if "DUP" not in labels:
                            labels.append("DUP")
                    else:
                        if min(frame_num, m_num) <= INTRO_START_WINDOW_FRAMES:
                            if "INTRO" not in labels:
                                labels.append("INTRO")
                        else:
                            if "REUSE" not in labels:
                                labels.append("REUSE")

                if labels:
                    frame_similarity_labels[frame_name] = labels

    return similar_frames_map, frame_similarity_labels


def main():
    feat_file = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if not feat_file or not feat_file.exists():
        print("[INFO] Cách dùng: python src/tools/build_similarity_matrix.py <path_to_beit3_embeddings.npy_or_npz>")
        print("[INFO] File embeddings (.npy / .npz) cần chứa ma trận BEiT3 vectors tương ứng với danh sách keyframe.")
        return

    # Load feature vectors & frame names
    data = np.load(feat_file)
    embeddings = data["embeddings"] if "embeddings" in data else data
    frame_names = list(data["frame_names"]) if "frame_names" in data else []

    sim_map, sim_labels = build_similarity_labels(frame_names, embeddings)

    out_sim = STORAGE_DIR / "similar_frames.json"
    out_labels = STORAGE_DIR / "frame_similarity_labels.json"

    with open(out_sim, "w", encoding="utf-8") as f:
        json.dump(sim_map, f, ensure_ascii=False)

    with open(out_labels, "w", encoding="utf-8") as f:
        json.dump(sim_labels, f, ensure_ascii=False, indent=2)

    print(f"[THÀNH CÔNG] Đã lưu similar_frames.json và frame_similarity_labels.json vào {STORAGE_DIR}")


if __name__ == "__main__":
    main()
