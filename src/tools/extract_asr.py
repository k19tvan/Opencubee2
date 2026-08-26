#!/usr/bin/env python3
"""
Tool: extract_asr.py
Chức năng: Trích xuất lời thoại ASR ở cấp độ từng từ (word-level) và câu (sentence-level)
từ các file mp3/video bằng mô hình PhoWhisper-large qua Faster-Whisper.
"""

import json
import multiprocessing as mp
import os
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from tqdm import tqdm

DEFAULT_INPUT_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/asr/video_mp3")
DEFAULT_WORD_LEVEL_DIR = Path(__file__).resolve().parents[2] / "storage" / "asr" / "word_level"
DEFAULT_SENTENCE_LEVEL_DIR = Path("/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/results/asr/transcription/sentence_level")
DEFAULT_MODEL_PATH = "/workingspace_aiclub/WorkingSpace/Personal/nguyenmv/Opencubee2_HCMAI25/tools/asr/models/PhoWhisper-ct2-FasterWhisper/PhoWhisper-large-ct2-fasterWhisper"

global_model = None


def init_worker(model_path: str):
    global global_model
    try:
        from faster_whisper import WhisperModel
        global_model = WhisperModel(model_path, compute_type="int8")
    except Exception as exc:
        print(f"[ERROR] Không thể khởi tạo PhoWhisper worker: {exc}")


def transcribe_video(video_path: str, word_out_dir: Path, sentence_out_dir: Path):
    global global_model
    if global_model is None:
        return None

    video_id = os.path.splitext(os.path.basename(video_path))[0]
    out_word = word_out_dir / f"{video_id}.json"
    out_sentence = sentence_out_dir / f"{video_id}.json"

    segments, info = global_model.transcribe(video_path, beam_size=5, word_timestamps=True)

    words_result = []
    sentences_result = []

    for segment in segments:
        sentences_result.append({
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "text": segment.text.strip()
        })
        for w in (segment.words or []):
            words_result.append({
                "start": round(w.start, 3),
                "end": round(w.end, 3),
                "word": w.word.strip()
            })

    with open(out_word, "w", encoding="utf-8") as f:
        json.dump(words_result, f, indent=2, ensure_ascii=False)

    with open(out_sentence, "w", encoding="utf-8") as f:
        json.dump(sentences_result, f, indent=2, ensure_ascii=False)

    return video_id


def extract_asr_transcriptions(
    input_dir: Path,
    word_dir: Path,
    sentence_dir: Path,
    model_path: str,
    max_workers: int = 4
):
    if not input_dir.exists():
        print(f"[ERROR] Thư mục âm thanh/video không tồn tại: {input_dir}")
        return

    word_dir.mkdir(parents=True, exist_ok=True)
    sentence_dir.mkdir(parents=True, exist_ok=True)

    existing = {os.path.splitext(f)[0] for f in os.listdir(word_dir) if f.endswith(".json")}
    all_files = [
        os.path.join(input_dir, f) for f in os.listdir(input_dir)
        if os.path.splitext(f)[1].lower() in {".mp3", ".wav", ".mp4", ".mkv", ".m4a"}
        and os.path.splitext(f)[0] not in existing
    ]

    print(f"--- Đã hoàn thành: {len(existing)} videos. Cần xử lý tiếp: {len(all_files)} videos ---")
    if not all_files:
        print("[INFO] Không có video mới cần bóc tách ASR.")
        return

    ctx = mp.get_context("spawn")
    with ProcessPoolExecutor(max_workers=max_workers, initializer=init_worker, initargs=(model_path,), mp_context=ctx) as executor:
        futures = [executor.submit(transcribe_video, path, word_dir, sentence_dir) for path in all_files]
        for f in tqdm(as_completed(futures), total=len(futures), desc="Extracting ASR"):
            try:
                f.result()
            except Exception as e:
                print(f"[ERROR] Lỗi khi xử lý video: {e}")


if __name__ == "__main__":
    in_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT_DIR
    w_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_WORD_LEVEL_DIR
    s_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_SENTENCE_LEVEL_DIR
    extract_asr_transcriptions(in_dir, w_dir, s_dir, DEFAULT_MODEL_PATH)
