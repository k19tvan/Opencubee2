# Tools / Data Pre-processing Utilities

Thư mục này chứa các công cụ Python chuẩn hóa để khởi tạo, bóc tách và tái tạo (regenerate) toàn bộ các file dữ liệu trong `storage/`.

## 🛠️ Danh sách các công cụ

### 1. `build_video_frame_mapping.py`
- **Mục đích**: Quét toàn bộ keyframes trong thư mục dataset, nhóm theo `video_id` và sắp xếp thứ tự khung hình.
- **Đầu ra**: `storage/video_frame_mapping.json`
- **Cách chạy**:
  ```bash
  python src/tools/build_video_frame_mapping.py [path_to_keyframes_dir]
  ```

### 2. `build_fps_mapping.py`
- **Mục đích**: Trích xuất chỉ số FPS của toàn bộ các file video trong dataset bằng OpenCV / `ffprobe`.
- **Đầu ra**: `storage/fps_mapping.json`
- **Cách chạy**:
  ```bash
  python src/tools/build_fps_mapping.py [path_to_videos_dir]
  ```

### 3. `build_frame_context.py`
- **Mục đích**: Đọc `video_frame_mapping.json` và tạo danh sách ngữ cảnh 40 khung hình (20 trước + 20 sau) cho từng keyframe.
- **Đầu ra**: `storage/frame_context.json`
- **Cách chạy**:
  ```bash
  python src/tools/build_frame_context.py
  ```

### 4. `build_scene_frame_mapping.py`
- **Mục đích**: Đọc dữ liệu ASR từ 2 nguồn thư mục chính để sinh 2 file mapping tương ứng:
  1. `transcription/semantic_level` $\rightarrow$ `storage/scene_frame_mapping.json` (Scene level)
  2. `transcription/sentence_level_gemini` $\rightarrow$ `storage/scene_frame_mapping_sentence_level.json` (Sentence level)
- **Đầu ra**: `storage/scene_frame_mapping.json` & `storage/scene_frame_mapping_sentence_level.json`
- **Cách chạy**:
  ```bash
  python src/tools/build_scene_frame_mapping.py [path_to_semantic_dir] [path_to_sentence_gemini_dir]
  ```

### 5. `extract_asr.py`
- **Mục đích**: Bóc tách lời thoại ASR ở cấp độ từng từ (`word_level`) và theo câu (`sentence_level`) bằng mô hình **PhoWhisper-large**.
- **Đầu ra**: `storage/asr/word_level/{video_id}.json` và `sentence_level/{video_id}.json`
- **Cách chạy**:
  ```bash
  python src/tools/extract_asr.py [input_mp3_dir] [out_word_dir] [out_sentence_dir]
  ```

### 6. `build_similarity_matrix.py`
- **Mục đích**: Tính toán Cosine similarity trên các vector nhúng **BEiT3** (với ngưỡng threshold = 0.9) để phát hiện và đánh nhãn ảnh trùng lặp hoặc lặp lại.
- **Đầu ra**: `storage/similar_frames.json` & `storage/frame_similarity_labels.json`
- **Cách chạy**:
  ```bash
  python src/tools/build_similarity_matrix.py <path_to_beit3_embeddings.npz>
  ```
