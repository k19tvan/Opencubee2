from __future__ import annotations

import asyncio
import os
from collections import defaultdict
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

try:
    from qdrant_client.http import models as q_models
except ModuleNotFoundError:
    q_models = None

from backend.core import runtime
from backend.core.config import (
    MAX_FRAME_LIMIT,
    MODEL_CONFIGS,
    OCR_ASR_INDEX_NAME,
    OCR_SEARCH_FIELD,
    ASR_SEARCH_FIELD,
    TEMP_UPLOAD_DIR,
    VLLM_BASE_URL,
    VLLM_MODEL,
)

def search_text_on_meilisearch_sync(
    keyword: str,
    search_field: str,
    limit: int = 500,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    if not runtime.meili_client: 
        return []

    filter_expr = None
    if video_ids:
        filter_expr = " OR ".join([f"video_id = '{vid}'" for vid in video_ids])
        
    opt_params = {
        "limit": limit,
        "showRankingScore": True,
        "attributesToSearchOn": [search_field],
    }
    if filter_expr:
        opt_params["filter"] = filter_expr
        
    try:
        index = runtime.meili_client.index(OCR_ASR_INDEX_NAME)
        response = index.search(keyword, opt_params)
        allowed_frame_names = set(candidate_frame_names or [])
        results = []
        for hit in response.get("hits", []):
            filepath = hit.get('file_path') or hit.get('filepath')
            if filepath and all(k in hit for k in ['video_id', 'shot_id', 'frame_id']):
                frame_name = os.path.basename(filepath)
                # The index stores a full path rather than a stable frame-name
                # field, so retain the similarity scope exactly after retrieval.
                if allowed_frame_names and frame_name not in allowed_frame_names:
                    continue
                score = hit.get('_rankingScore', 1.0)
                results.append({
                    "frame_name": frame_name,
                    "filepath": filepath, 
                    "score": score, 
                    "video_id": hit['video_id'], 
                    "shot_id": str(hit['shot_id']), 
                    "frame_id": hit['frame_id']
                })
        return results
    except Exception as e: 
        print(f"Lỗi Meilisearch {search_field}: {e}")
        return []

def search_ocr_on_meilisearch_sync(
    keyword: str,
    limit: int = 500,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    return search_text_on_meilisearch_sync(
        keyword, OCR_SEARCH_FIELD, limit, video_ids, candidate_frame_names
    )

async def search_ocr_on_meilisearch_async(
    keyword: str,
    limit: int = 500,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
):
    return await asyncio.to_thread(
        search_text_on_meilisearch_sync,
        keyword,
        OCR_SEARCH_FIELD,
        limit,
        video_ids,
        candidate_frame_names,
    )

async def search_ocr_asr_on_meilisearch_async(
    ocr_keyword: Optional[str] = None,
    asr_keyword: Optional[str] = None,
    limit: int = 500,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Search OCR and ASR fields independently; when both are present, intersect frames."""
    queries = []
    if ocr_keyword and ocr_keyword.strip():
        queries.append((ocr_keyword.strip(), OCR_SEARCH_FIELD))
    if asr_keyword and asr_keyword.strip():
        queries.append((asr_keyword.strip(), ASR_SEARCH_FIELD))
    if not queries:
        return []
    results = await asyncio.gather(*[
        asyncio.to_thread(
            search_text_on_meilisearch_sync,
            keyword, field, limit, video_ids, candidate_frame_names,
        )
        for keyword, field in queries
    ])
    if len(results) == 1:
        return results[0]
    by_frame = [{item["frame_name"]: item for item in group} for group in results]
    common_frames = set(by_frame[0]).intersection(*by_frame[1:])
    return [
        {**by_frame[0][frame_name], "score": min(float(group[frame_name].get("score", 0.0)) for group in by_frame)}
        for frame_name in common_frames
    ]

# --- Helper: Fusion Vector & Meilisearch Results ---
def _combine_and_rerank_results(
    vector_results: List[Dict[str, Any]], 
    meili_results: List[Dict[str, Any]],
    vector_weight: float = 0.7, 
    meili_weight: float = 0.3
) -> List[Dict[str, Any]]:
    if not vector_results or not meili_results:
        return []

    # Strip extensions for matching
    vector_map = {os.path.splitext(res['frame_name'])[0]: res for res in vector_results}
    meili_map = {os.path.splitext(res['frame_name'])[0]: res for res in meili_results}
    
    union_framenames = set(vector_map.keys()).union(meili_map.keys())
    
    if not union_framenames:
        return []
        
    final_results = []
    max_meili_score = max((res.get('score', 0.0) for res in meili_results), default=1.0) or 1.0
    
    for fname_base in union_framenames:
        vector_res = vector_map.get(fname_base, {})
        meili_res = meili_map.get(fname_base, {})
        
        vector_score = vector_res.get('score', 0.0)
        normalized_meili_score = meili_res.get('score', 0.0) / max_meili_score
        
        combined_score = (vector_score * vector_weight) + (normalized_meili_score * meili_weight)
        
        # Base the final item on whichever we have
        final_item = (vector_res or meili_res).copy()
        final_item['score'] = combined_score 
        if 'source_scores' not in final_item:
            final_item['source_scores'] = {}
        final_item['source_scores']['meilisearch'] = {"score": meili_res.get('score', 0.0), "normalized_score": normalized_meili_score}
        
        if 'url' not in final_item:
            original_fname = vector_res.get('frame_name') or meili_res.get('frame_name') or f"{fname_base}.webp"
            final_item['url'] = f"/keyframes/{original_fname}"
            
        final_results.append(final_item)
        
    return sorted(final_results, key=lambda x: x.get('score', 0), reverse=True)

# --- Helper: Trích xuất Vector đặc trưng ---
async def get_embedding(
    model_name: str,
    text: Optional[str] = None, 
    image_name: Optional[str] = None, 
    image_text: Optional[str] = None
) -> Optional[list]:
    config = MODEL_CONFIGS.get(model_name)
    if not config: return None
    worker_url = config["worker_url"]

    client = runtime.http_client
    if client is None:
        client = httpx.AsyncClient(timeout=30.0)

    embed_timeout = httpx.Timeout(60.0, connect=5.0)

    try:
        if image_name:
            if image_name.startswith("_frame_:"):
                frame_filename = image_name.replace("_frame_:", "")
                from backend.api.media import IMAGE_BASE_PATH
                from pathlib import Path
                image_base_dir = Path(IMAGE_BASE_PATH)
                # Try .webp first, then .jpg
                temp_filepath = image_base_dir / f"{frame_filename}.webp"
                if not temp_filepath.is_file():
                    temp_filepath = image_base_dir / f"{frame_filename}.jpg"
                if not temp_filepath.is_file():
                    temp_filepath = image_base_dir / frame_filename
            else:
                temp_filepath = TEMP_UPLOAD_DIR / image_name
            if not temp_filepath.is_file(): return None
            content = await asyncio.to_thread(temp_filepath.read_bytes)
            files = {"image_file": (image_name.replace("_frame_:", ""), content, "image/jpeg")}
            data = {"text_query": image_text or ""}
            resp = await client.post(worker_url, files=files, data=data, timeout=embed_timeout)
            if resp.status_code == 200: return resp.json()["embedding"][0]
            print(f"{model_name} worker returned {resp.status_code} for image embed")
        elif text:
            data = {"text_query": text}
            resp = await client.post(worker_url, data=data, timeout=embed_timeout)
            if resp.status_code == 200: return resp.json()["embedding"][0]
            print(f"{model_name} worker returned {resp.status_code} for text embed")
    except Exception as e:
        print(f"Failed to extract embedding from {model_name} worker: {e}")
    return None

# --- Helper: Embed raw image bytes (optionally with steering text) ---
async def embed_image_bytes(
    model_name: str,
    content: bytes,
    filename: str = "frame.jpg",
    text: Optional[str] = None,
) -> Optional[list]:
    config = MODEL_CONFIGS.get(model_name)
    if not config:
        return None
    worker_url = config["worker_url"]

    client = runtime.http_client
    if client is None:
        client = httpx.AsyncClient(timeout=30.0)

    embed_timeout = httpx.Timeout(60.0, connect=5.0)

    try:
        files = {"image_file": (filename, content, "image/jpeg")}
        data = {"text_query": text or ""}
        resp = await client.post(worker_url, files=files, data=data, timeout=embed_timeout)
        if resp.status_code == 200:
            return resp.json()["embedding"][0]
        print(f"embed_image_bytes worker {model_name} returned {resp.status_code}")
    except Exception as e:
        print(f"Failed to embed image bytes via {model_name} worker: {e}")
    return None

# --- Helper: Lấy vector đã lưu của một keyframe trong Qdrant ---
async def get_stored_vector(frame_name: str, collection_name: str = "bge") -> Optional[list]:
    if not runtime.qdrant_client or not frame_name or q_models is None:
        return None
    try:
        points, _ = await asyncio.to_thread(
            runtime.qdrant_client.scroll,
            collection_name=collection_name,
            scroll_filter=q_models.Filter(
                must=[q_models.FieldCondition(
                    key="frame_name",
                    match=q_models.MatchValue(value=frame_name),
                )]
            ),
            with_vectors=True,
            limit=1,
        )
        if points and points[0].vector is not None:
            vector = points[0].vector
            if isinstance(vector, dict):
                vector = vector.get(collection_name) or next(iter(vector.values()), None)
            return list(vector) if vector is not None else None
    except Exception as e:
        print(f"get_stored_vector failed for {frame_name}: {e}")
    return None

# --- Helper: Tìm kiếm lân cận trên Qdrant ---
async def search_qdrant(
    query_vector: list,
    collection_name: str,
    limit: int = 200,
    candidate_frame_names: Optional[List[str]] = None,
    video_ids: Optional[List[str]] = None,  # <--- Bổ sung video_ids
) -> List[Dict]:
    if not runtime.qdrant_client: return []
    try:
        allowed_frame_names = list(dict.fromkeys(candidate_frame_names or []))
        if candidate_frame_names is not None and not allowed_frame_names:
            return []
        
        must_conditions = []
        if allowed_frame_names:
            must_conditions.append(
                q_models.FieldCondition(
                    key="frame_name",
                    match=q_models.MatchAny(any=allowed_frame_names),
                )
            )
        # Bổ sung lọc theo video_id trong Qdrant
        if video_ids:
            must_conditions.append(
                q_models.FieldCondition(
                    key="video_id",
                    match=q_models.MatchAny(any=video_ids),
                )
            )

        query_filter = q_models.Filter(must=must_conditions) if must_conditions else None

        response = await asyncio.to_thread(
            runtime.qdrant_client.query_points,
            collection_name=collection_name,
            query=query_vector,
            query_filter=query_filter,
            limit=min(limit, len(allowed_frame_names)) if allowed_frame_names else limit,
            with_payload=["frame_name", "video_id", "frame_id", "shot_id"],
            timeout=300
        )
        results = []
        for hit in response.points:
            payload = hit.payload
            frame_name = payload.get("frame_name")
            if not frame_name: continue
            
            results.append({
                "frame_name": frame_name,
                "score": hit.score,
                "video_id": payload.get("video_id"),
                "frame_id": payload.get("frame_id"),
                "shot_id": str(payload.get("shot_id", "1")),
                "url": f"/keyframes/{frame_name}"
            })
        return results
    except Exception as e:
        print(f"Qdrant search error on collection {collection_name}: {e}")
        return []

# --- Helper: Embed + Qdrant search cho MỘT model ---
async def embed_and_search_model(
    model_name: str,
    text: Optional[str] = None,
    image_name: Optional[str] = None,
    image_text: Optional[str] = None,
    limit: int = MAX_FRAME_LIMIT,
    candidate_frame_names: Optional[List[str]] = None,
    video_ids: Optional[List[str]] = None,  # <--- Bổ sung video_ids
):
    embedding = await get_embedding(
        model_name=model_name,
        text=text,
        image_name=image_name,
        image_text=image_text,
    )
    if not embedding:
        return model_name, None
    config = MODEL_CONFIGS[model_name]
    raw_results = await search_qdrant(
        embedding,
        config["collection"],
        limit=limit,
        candidate_frame_names=candidate_frame_names,
        video_ids=video_ids,  # <--- Truyền video_ids vào
    )
    return model_name, raw_results

async def search_all_models(
    models_to_use: List[str],
    text: Optional[str] = None,
    image_name: Optional[str] = None,
    image_text: Optional[str] = None,
    limit: int = MAX_FRAME_LIMIT,
    candidate_frame_names: Optional[List[str]] = None,
    video_ids: Optional[List[str]] = None,  # <--- Bổ sung video_ids
) -> Dict[str, List[Dict]]:
    tasks = [
        embed_and_search_model(
            m,
            text=text,
            image_name=image_name,
            image_text=image_text,
            limit=limit,
            candidate_frame_names=candidate_frame_names,
            video_ids=video_ids,  # <--- Truyền video_ids vào
        )
        for m in models_to_use
    ]
    gathered = await asyncio.gather(*tasks, return_exceptions=True)
    results_by_model = {}
    for item in gathered:
        if isinstance(item, Exception):
            print(f"Model search task failed: {item}")
            continue
        model_name, raw_results = item
        if raw_results is not None:
            results_by_model[model_name] = raw_results
    return results_by_model

# --- Helper: Dung hợp kết quả theo Trọng số ---
def fuse_results(results_by_model: Dict[str, List[Dict]], weights: Dict[str, float]) -> List[Dict]:
    active_weights = {m: w for m, w in weights.items() if m in results_by_model}
    total_weight = sum(active_weights.values())
    if total_weight <= 0: return []
        
    normalized_weights = {m: w / total_weight for m, w in active_weights.items()}
    merged_hits = {}
    for model_name, hits in results_by_model.items():
        weight = normalized_weights.get(model_name, 0.0)
        for hit in hits:
            fname = hit["frame_name"]
            if fname not in merged_hits:
                merged_hits[fname] = {
                    "frame_name": fname,
                    "video_id": hit["video_id"],
                    "frame_id": hit["frame_id"],
                    "shot_id": hit["shot_id"],
                    "url": hit["url"],
                    "scores": {}
                }
            merged_hits[fname]["scores"][model_name] = hit["score"]
            
    fused_list = []
    for fname, data in merged_hits.items():
        weighted_score = 0.0
        for model_name, norm_w in normalized_weights.items():
            score = data["scores"].get(model_name, 0.0)
            weighted_score += norm_w * score
            
        data["score"] = weighted_score
        del data["scores"]
        fused_list.append(data)
        
    fused_list.sort(key=lambda x: x["score"], reverse=True)
    return fused_list

# --- Gom cụm kết quả theo phân đoạn ---
def process_and_cluster_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not results:
        return []

    shots_by_video = defaultdict(list)
    for res in results:
        if not all(key in res for key in ('video_id', 'shot_id')):
            continue
        try:
            res['shot_id_int'] = int(str(res['shot_id']))
            shots_by_video[res['video_id']].append(res)
        except (ValueError, TypeError):
            continue

    raw_clusters = []
    for shots in shots_by_video.values():
        if not shots:
            continue
        sorted_shots = sorted(shots, key=lambda shot: shot['shot_id_int'])
        if not sorted_shots:
            continue
        current_cluster = [sorted_shots[0]]
        for current_shot in sorted_shots[1:]:
            previous_shot_id = current_cluster[-1]['shot_id_int']
            current_shot_id = current_shot['shot_id_int']
            if current_shot_id == previous_shot_id or current_shot_id == previous_shot_id + 1:
                current_cluster.append(current_shot)
            else:
                raw_clusters.append(current_cluster)
                current_cluster = [current_shot]
        if current_cluster:
            raw_clusters.append(current_cluster)

    processed_clusters = []
    for cluster_shots in raw_clusters:
        ranked_shots = sorted(
            cluster_shots,
            key=lambda shot: shot.get('rrf_score', shot.get('score', 0)),
            reverse=True,
        )
        best_shot = ranked_shots[0]
        cluster_score = best_shot.get('rrf_score', best_shot.get('score', 0))
        processed_clusters.append({
            "cluster_score": cluster_score,
            "shots": ranked_shots,
            "best_shot": best_shot,
        })

    return sorted(processed_clusters, key=lambda cluster: cluster['cluster_score'], reverse=True)

async def get_vllm_model_name() -> str:
    if VLLM_MODEL:
        return VLLM_MODEL

    client = runtime.http_client
    close_client = False
    if client is None:
        client = httpx.AsyncClient(timeout=30.0)
        close_client = True

    try:
        response = await client.get(f"{VLLM_BASE_URL}/models")
        response.raise_for_status()
        models = response.json().get("data", [])
        if models and models[0].get("id"):
            return models[0]["id"]
    finally:
        if close_client:
            await client.aclose()

    raise HTTPException(status_code=502, detail="No vLLM model is available.")

# --- Corrected Chat Helper using Groq (Async, Returning the Response) ---
async def call_groq_chat(messages: List[Any]) -> str:
    if not runtime.llm_enhance:
        raise HTTPException(status_code=500, detail="Groq LLM for query enhancement is not initialized.")
    try:
        response = await runtime.llm_enhance.ainvoke(messages)
        return response.content.strip()
    except Exception as e:
        print(f"Error calling Groq API: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to enhance query: {e}")

INTRO_MIN_FRAME_GAP = 100
INTRO_START_WINDOW_FRAMES = 300


def _frame_identity(frame: Dict[str, Any] | str) -> tuple[Optional[str], Optional[int], Optional[str]]:
    """Return stable video ID, raw frame number and frame name from a keyframe."""
    if isinstance(frame, dict):
        frame_name = frame.get("frame_name") or frame.get("filepath") or frame.get("url")
        video_id = frame.get("video_id")
        frame_id = frame.get("frame_id")
    else:
        frame_name = frame
        video_id = None
        frame_id = None

    if not frame_name:
        return video_id, None, None

    basename = os.path.basename(str(frame_name).split("?", 1)[0])
    stem = os.path.splitext(basename)[0]
    parts = stem.split("_")

    # HCMAI keyframes use names such as K01_V001_0016_001023.webp.
    # The first two fields identify the video and the last field is the source
    # frame number.  Prefer this canonical identity over optional payload data.
    if len(parts) >= 3:
        video_id = "_".join(parts[:2])
        try:
            frame_id = int(parts[-1])
        except (TypeError, ValueError):
            pass

    try:
        frame_id = int(frame_id) if frame_id is not None else None
    except (TypeError, ValueError):
        frame_id = None

    return video_id, frame_id, basename


def classify_similarity_match(
    source: Dict[str, Any] | str,
    candidate: Dict[str, Any] | str,
    intro_min_frame_gap: int = INTRO_MIN_FRAME_GAP,
    intro_start_window_frames: int = INTRO_START_WINDOW_FRAMES,
) -> Optional[str]:
    """Classify one visual-similarity pair without performing I/O."""
    source_video_id, source_frame_id, source_name = _frame_identity(source)
    candidate_video_id, candidate_frame_id, candidate_name = _frame_identity(candidate)

    if not source_name or not candidate_name or source_name == candidate_name:
        return None
    if source_video_id and candidate_video_id and candidate_video_id != source_video_id:
        return "DUP"
    if (
        source_video_id and candidate_video_id == source_video_id
        and source_frame_id is not None and candidate_frame_id is not None
        and abs(candidate_frame_id - source_frame_id) >= intro_min_frame_gap
    ):
        return (
            "INTRO"
            if min(source_frame_id, candidate_frame_id) <= intro_start_window_frames
            else "REUSE"
        )
    return None


def similarity_labels_for_frame(frame_name: str) -> List[str]:
    """Look up labels generated by the offline similarity-indexing job."""
    labels = runtime.frame_similarity_labels.get(frame_name)
    if labels is None:
        base_name = os.path.splitext(frame_name)[0]
        for extension in (".webp", ".jpg", ".png", ".jpeg"):
            labels = runtime.frame_similarity_labels.get(base_name + extension)
            if labels is not None:
                break

    if isinstance(labels, dict):
        labels = labels.get("labels", [])
    if not isinstance(labels, list):
        return []
    return [label for label in ("INTRO", "REUSE", "DUP") if label in labels]


def attach_similarity_labels(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach precomputed labels to normal-search results with O(1) lookups."""
    for result in results:
        frame_name = result.get("frame_name")
        if not frame_name:
            continue
        labels = similarity_labels_for_frame(frame_name)
        if labels:
            result["similarity_labels"] = labels
    return results


async def find_similar_frames(
    frame_name: str,
    limit: int = 20,
    threshold: float = 0.985,
    intro_min_frame_gap: int = INTRO_MIN_FRAME_GAP,
    intro_start_window_frames: int = INTRO_START_WINDOW_FRAMES,
) -> List[Dict]:
    """Find near-duplicate frames and classify in-video repetitions.

    A match in another video is a DUP.  For an in-video match, it is INTRO
    only when the earlier of the two frames is in the opening section; all
    other distant in-video matches are REPEAT.  Adjacent keyframes are normal
    temporal neighbours and are intentionally hidden.
    """
    similar_frames = runtime.similar_frames_map.get(frame_name)
    
    if similar_frames is None:
        import os
        base_name = os.path.splitext(frame_name)[0]
        for ext in ['.webp', '.jpg', '.png', '.jpeg']:
            alt_name = base_name + ext
            similar_frames = runtime.similar_frames_map.get(alt_name)
            if similar_frames is not None:
                break
                
    if similar_frames is None:
        # The JSON is an optional pre-computed cache.  Falling back to Qdrant
        # keeps the feature usable while that offline cache is unavailable.
        vector = await get_stored_vector(frame_name, "beit3")
        similar_frames = (
            await search_qdrant(vector, "beit3", limit=max(100, limit * 5))
            if vector else []
        )

    classified_frames = []
    for frame in similar_frames:
        if not isinstance(frame, dict) or frame.get("score", 0) < threshold:
            continue

        match_type = classify_similarity_match(
            frame_name,
            frame,
            intro_min_frame_gap=intro_min_frame_gap,
            intro_start_window_frames=intro_start_window_frames,
        )

        if match_type:
            classified_frames.append({**frame, "match_type": match_type})
        if len(classified_frames) >= limit:
            break

    return classified_frames

def find_keyframes_for_chunk(video_id: str, start_id: int, end_id: int) -> List[Dict[str, Any]]:
    """Lấy danh sách keyframe cho 1 chunk: Ưu tiên RAM Cache O(1), fallback quét đĩa nếu thiếu."""
    
    # 1. Tra cứu siêu tốc O(1) theo chunk_key chính xác
    chunk_key = f"{video_id}_{start_id}_{end_id}"
    if runtime.asr_chunk_frames_map and chunk_key in runtime.asr_chunk_frames_map:
        return runtime.asr_chunk_frames_map[chunk_key]

    # 2. Lọc siêu tốc từ RAM theo video_id
    if runtime.video_keyframes_map and video_id in runtime.video_keyframes_map:
        video_shots = runtime.video_keyframes_map[video_id]
        return [
            shot for shot in video_shots
            if start_id <= shot["frame_id"] <= end_id
        ]

    # 3. Fallback quét đĩa (chỉ chạy khi cả 2 bước RAM ở trên không tìm thấy)
    import glob
    from pathlib import Path

    candidate_dirs = [
        Path("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/keyframes_beit3_096"),
        Path("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/ocr_vlm_keyframes_full"),
        Path("/mlcv1/Datasets/HCMAI25/keyframes"),
        Path("/mlcv1/Datasets/HCMAI25/frames"),
    ]

    matched_files = []
    prefix = video_id.split('_')[0] if '_' in video_id else video_id

    for cdir in candidate_dirs:
        if not cdir.is_dir():
            continue
        matched_files.extend(glob.glob(str(cdir / f"{video_id}_*")))
        matched_files.extend(glob.glob(str(cdir / prefix / f"{video_id}_*")))

    unique_files = sorted(list(set(matched_files)))
    found_shots = []

    for fpath in unique_files:
        fname = os.path.basename(fpath)
        stem = os.path.splitext(fname)[0]
        parts = stem.split('_')
        try:
            frame_id = int(parts[-1])
            if start_id <= frame_id <= end_id:
                shot_id = parts[-2] if len(parts) >= 4 else "1"
                found_shots.append({
                    "frame_name": fname,
                    "filepath": fpath,
                    "video_id": video_id,
                    "frame_id": frame_id,
                    "shot_id": str(shot_id),
                    "url": f"/keyframes/{fname}"
                })
        except (ValueError, IndexError):
            continue

    found_shots.sort(key=lambda x: x["frame_id"])
    return found_shots


async def search_semantic_asr_qdrant(
    query_vector: list,
    limit: int = 50,
    video_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Retrieve ASR chunks từ collection 'qwen' trong Qdrant."""
    if not runtime.qdrant_client:
        return []
    try:
        must_conditions = []
        if video_ids:
            must_conditions.append(
                q_models.FieldCondition(
                    key="video_id",
                    match=q_models.MatchAny(any=video_ids),
                )
            )
        query_filter = q_models.Filter(must=must_conditions) if must_conditions else None

        response = await asyncio.to_thread(
            runtime.qdrant_client.query_points,
            collection_name="qwen",
            query=query_vector,
            query_filter=query_filter,
            limit=limit,
            with_payload=["video_id", "start_id", "end_id", "summary"],
            timeout=60,
        )

        results = []
        for hit in response.points:
            payload = hit.payload or {}
            video_id = payload.get("video_id")
            start_id = payload.get("start_id", 0)
            end_id = payload.get("end_id", 0)
            summary = payload.get("summary", "")
            if not video_id:
                continue

            shots = find_keyframes_for_chunk(video_id, start_id, end_id)
            results.append({
                "chunk_id": str(hit.id),
                "score": hit.score,
                "video_id": video_id,
                "start_id": start_id,
                "end_id": end_id,
                "summary": summary,
                "shots": shots,
            })
        return results
    except Exception as e:
        print(f"Error searching Qdrant collection 'qwen': {e}")
        return []
