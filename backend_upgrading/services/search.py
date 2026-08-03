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
    TEMP_UPLOAD_DIR,
    VLLM_BASE_URL,
    VLLM_MODEL,
)

def search_ocr_on_meilisearch_sync(
    keyword: str,
    limit: int = 500,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    if not runtime.meili_client: 
        return []
    print("cc")
    filter_expr = None
    if video_ids:
        filter_expr = " OR ".join([f"video_id = '{vid}'" for vid in video_ids])
        
    opt_params = {
        "limit": limit,
        "showRankingScore": True
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
        print(f"Lỗi Meilisearch OCR: {e}")
        return []

async def search_ocr_on_meilisearch_async(
    keyword: str,
    limit: int = 500,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
):
    return await asyncio.to_thread(
        search_ocr_on_meilisearch_sync,
        keyword,
        limit,
        video_ids,
        candidate_frame_names,
    )

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
            temp_filepath = TEMP_UPLOAD_DIR / image_name
            if not temp_filepath.is_file(): return None
            content = await asyncio.to_thread(temp_filepath.read_bytes)
            files = {"image_file": (image_name, content, "image/jpeg")}
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
) -> List[Dict]:
    if not runtime.qdrant_client: return []
    try:
        allowed_frame_names = list(dict.fromkeys(candidate_frame_names or []))
        if candidate_frame_names is not None and not allowed_frame_names:
            return []
        query_filter = None
        if allowed_frame_names:
            # Restrict before nearest-neighbor ranking so an unscoped top-K
            # cannot hide valid frames from the active similarity scope.
            query_filter = q_models.Filter(
                should=[
                    q_models.FieldCondition(
                        key="frame_name",
                        match=q_models.MatchValue(value=frame_name),
                    )
                    for frame_name in allowed_frame_names
                ]
            )
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
    )
    return model_name, raw_results

# --- Helper: Chạy tất cả model song song và gom theo model ---
async def search_all_models(
    models_to_use: List[str],
    text: Optional[str] = None,
    image_name: Optional[str] = None,
    image_text: Optional[str] = None,
    limit: int = MAX_FRAME_LIMIT,
    candidate_frame_names: Optional[List[str]] = None,
) -> Dict[str, List[Dict]]:
    tasks = [
        embed_and_search_model(
            m,
            text=text,
            image_name=image_name,
            image_text=image_text,
            limit=limit,
            candidate_frame_names=candidate_frame_names,
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

async def find_similar_frames(frame_name: str, limit: int = 20, threshold: float = 0.985) -> List[Dict]:
    """Finds near-duplicate frames using the pre-computed JSON loaded into memory."""
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
        similar_frames = []
    
    # We can filter again by threshold if needed, but the JSON already has a threshold
    filtered_frames = [
        frame for frame in similar_frames
        if frame.get('score', 0) >= threshold
    ]
    
    return filtered_frames[:limit]
