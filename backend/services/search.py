from __future__ import annotations

import asyncio
import json
import os
import re
import time
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
    SEMANTIC_ASR_INDEX_NAME,
    SEMANTIC_ASR_SENTENCE_LEVEL_INDEX_NAME,
    OCR_SEARCH_FIELD,
    ASR_SEARCH_FIELD,
    TEMP_UPLOAD_DIR,
    VLLM_BASE_URL,
    VLLM_MODEL,
    VECTOR_DATABASE,
)

try:
    from pymilvus import Collection
except ModuleNotFoundError:
    Collection = None

SPATIAL_REGION_VECTORS = {
    "left": ("left",), "right": ("right",), "top": ("top",), "bottom": ("bottom",),
    "top_left": ("left", "top"), "top_right": ("right", "top"),
    "bottom_left": ("left", "bottom"), "bottom_right": ("right", "bottom"),
}

_SPATIAL_PATTERNS = (
    ("top_left", (r"\b(?:top|upper)[ -]?left(?:\s+corner)?\b", r"\bgóc\s+trên\s+bên\s+trái\b")),
    ("top_right", (r"\b(?:top|upper)[ -]?right(?:\s+corner)?\b", r"\bgóc\s+trên\s+bên\s+phải\b")),
    ("bottom_left", (r"\b(?:bottom|lower)[ -]?left(?:\s+corner)?\b", r"\bgóc\s+dưới\s+bên\s+trái\b")),
    ("bottom_right", (r"\b(?:bottom|lower)[ -]?right(?:\s+corner)?\b", r"\bgóc\s+dưới\s+bên\s+phải\b")),
    ("left", (r"\b(?:on|at|in)\s+the\s+left(?:\s+(?:side|half))?\b", r"\b(?:bên|phía|ở)\s+trái\b", r"\bnửa\s+trái\b")),
    ("right", (r"\b(?:on|at|in)\s+the\s+right(?:\s+(?:side|half))?\b", r"\b(?:bên|phía|ở)\s+phải\b", r"\bnửa\s+phải\b")),
    ("top", (r"\b(?:at|in)\s+the\s+(?:top|upper)\s+(?:part|half|side)?\b", r"\bnửa\s+trên\b")),
    ("bottom", (r"\b(?:at|in)\s+the\s+(?:bottom|lower)\s+(?:part|half|side)?\b", r"\bnửa\s+dưới\b")),
)

_OBJECT_RELATION_PATTERNS = (
    r"\b(?:left|right)\s+(?:hand|arm|leg|foot|eye)\b",
    r"\b(?:to|on|at)\s+the\s+(?:left|right|top|bottom)\s+of\b(?!\s+(?:the\s+)?(?:frame|image|picture|screen|video)\b)",
    r"\b(?:left|right|top|bottom)\s+of\s+(?!the\s+)?(?!frame\b|image\b|picture\b|screen\b|video\b)",
)


def infer_spatial_query(query: Optional[str], requested_region: str = "auto") -> Dict[str, str]:
    """Resolve per-stage spatial mode and keep object-relative phrases semantic."""
    original_query = (query or "").strip()
    requested_region = requested_region or "auto"
    if requested_region != "auto":
        return {"semantic_query": original_query, "spatial_region": requested_region, "source": "explicit"}
    normalized = original_query.lower()
    if not normalized or any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in _OBJECT_RELATION_PATTERNS):
        return {"semantic_query": original_query, "spatial_region": "full", "source": "none"}
    for region, patterns in _SPATIAL_PATTERNS:
        for pattern in patterns:
            if re.search(pattern, normalized, flags=re.IGNORECASE):
                semantic_query = re.sub(pattern, " ", original_query, flags=re.IGNORECASE)
                semantic_query = re.sub(r"\s+", " ", semantic_query).strip(" ,.-")
                return {"semantic_query": semantic_query or original_query, "spatial_region": region, "source": "rule"}
    return {"semantic_query": original_query, "spatial_region": "full", "source": "none"}

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
    t_start = time.time()
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
        res = results[0]
    else:
        by_frame = [{item["frame_name"]: item for item in group} for group in results]
        common_frames = set(by_frame[0]).intersection(*by_frame[1:])
        res = [
            {**by_frame[0][frame_name], "score": min(float(group[frame_name].get("score", 0.0)) for group in by_frame)}
            for frame_name in common_frames
        ]
    t_elapsed = time.time() - t_start
    print(f"  ⏱ [Meilisearch] OCR/ASR search returned {len(res)} hits in {t_elapsed:.3f}s")
    return res

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
                if not image_text:
                    config = MODEL_CONFIGS.get(model_name)
                    if config:
                        stored_vector = await get_stored_vector(frame_filename, config["collection"])
                        if stored_vector:
                            return stored_vector
                
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

# --- Helper: Lấy vector đã lưu của một keyframe ---
async def get_stored_vector(frame_name: str, collection_name: str = "bge") -> Optional[list]:
    if not frame_name: return None
    
    # ------------------ MILVUS ------------------
    if VECTOR_DATABASE == "milvus":
        if Collection is None: return None
        try:
            milvus_col = Collection(collection_name)
            base_name = os.path.splitext(frame_name)[0]
            possible_names = [base_name, f"{base_name}.jpg", f"{base_name}.webp", f"{base_name}.png", f"{base_name}.jpeg"]
            names_str = json.dumps(possible_names) # e.g. '["name1", "name2..."]'
            
            # Since older schema merged everything into `payload`, but new one splits to `other_payload`
            # and `frame_name` isn't an explicit column, it usually lives inside JSON payload:
            expr = f'other_payload["frame_name"] in {names_str}' 
            # Temporary fallback if schema used `payload` instead of `other_payload`... but we will stick to one.
            if collection_name in ["beit3", "bge", "metaclip2", "fgclip2"]:
                # The latest schema you ran has `other_payload`
                pass
            
            res = await asyncio.to_thread(milvus_col.query, expr=expr, limit=1, output_fields=["vector"])
            if res and res[0].get("vector"):
                return list(res[0]["vector"])
                
            # If nothing, try with explicit mapped fallback logic for hallucinated paths (Skip for brevity to not break UI logic)
        except Exception as e:
            print(f"Milvus get_stored_vector failed for {frame_name}: {e}")
            
    # ------------------ QDRANT ------------------
    else:
        if not runtime.qdrant_client or q_models is None: return None
        try:
            base_name = os.path.splitext(frame_name)[0]
            possible_names = [base_name, f"{base_name}.jpg", f"{base_name}.webp", f"{base_name}.png", f"{base_name}.jpeg"]
            
            must_conditions = [
                q_models.FieldCondition(
                    key="frame_name",
                    match=q_models.MatchAny(any=possible_names),
                )
            ]
            
            points, _ = await asyncio.to_thread(
                runtime.qdrant_client.scroll,
                collection_name=collection_name,
                scroll_filter=q_models.Filter(must=must_conditions),
                with_vectors=True,
                limit=1,
            )
            if points and points[0].vector is not None:
                vector = points[0].vector
                if isinstance(vector, dict):
                    vector = vector.get(collection_name) or next(iter(vector.values()), None)
                return list(vector) if vector is not None else None
                
            # UI shortcut hallucination fallback (e.g. L22_V025_021195.webp -> L22_V025_0012_021195.webp)
            parts = base_name.split("_")
            if len(parts) == 3:
                vid = f"{parts[0]}_{parts[1]}"
                fid_str = parts[2]
                frames = runtime.video_frame_mapping.get(vid, [])
                true_frame = next((f for f in frames if f.endswith(f"_{fid_str}.webp") or f.endswith(f"_{str(int(fid_str))}.webp")), None)
                if true_frame:
                    points_retry, _ = await asyncio.to_thread(
                        runtime.qdrant_client.scroll,
                        collection_name=collection_name,
                        scroll_filter=q_models.Filter(must=[
                            q_models.FieldCondition(key="frame_name", match=q_models.MatchValue(value=true_frame))
                        ]),
                        with_vectors=True,
                        limit=1,
                    )
                    if points_retry and points_retry[0].vector is not None:
                        vector = points_retry[0].vector
                        if isinstance(vector, dict):
                            vector = vector.get(collection_name) or next(iter(vector.values()), None)
                        return list(vector) if vector is not None else None
        except Exception as e:
            print(f"get_stored_vector failed for {frame_name}: {e}")
            
    return None

# --- Helper: Tìm kiếm lân cận Vector Database (Qdrant / Milvus) ---
async def search_qdrant(
    query_vector: list,
    collection_name: str,
    limit: int = 200,
    candidate_frame_names: Optional[List[str]] = None,
    video_ids: Optional[List[str]] = None, 
    vector_name: Optional[str] = None,
) -> List[Dict]:
    
    allowed_frame_names = list(dict.fromkeys(candidate_frame_names or []))
    if candidate_frame_names is not None and not allowed_frame_names:
        return []
            
    # ------------------ MILVUS ------------------
    if VECTOR_DATABASE == "milvus":
        if Collection is None: return []
        try:
            milvus_col = Collection(collection_name)
            
            expr_parts = []
            if allowed_frame_names:
                allowed_str = json.dumps(allowed_frame_names)
                # Dùng thuộc tính phụ trợ the other_payload JSON field
                expr_parts.append(f'other_payload["frame_name"] in {allowed_str}')
                
            if video_ids:
                vids_str = json.dumps(video_ids)
                # Trường video_id đã tách ra schema cột chính
                expr_parts.append(f'video_id in {vids_str}')
                
            expr = " and ".join(expr_parts) if expr_parts else None
            
            k = min(limit, len(allowed_frame_names)) if allowed_frame_names else limit
            
            search_params = {
                "metric_type": "COSINE",
                "params": {"ef": max(64, k)}, 
            }
            anns_field_name = f"vector_{vector_name}" if vector_name else "vector"
            # For 2.4, milvus_col.search is quick
            resp = await asyncio.to_thread(
                milvus_col.search,
                data=[query_vector],
                anns_field=anns_field_name,
                param=search_params,
                limit=k,
                expr=expr,
                output_fields=["file_path", "video_id", "shot_id", "frame_id", "other_payload"],
                timeout=120.0
            )
            
            results = []
            if not resp or not resp[0]:
                return []
                
            for hit in resp[0]:
                ent = hit.entity
                fname = ent.get("other_payload", {}).get("frame_name")
                if not fname:
                    fname = os.path.basename(ent.get("file_path", ""))
                    
                results.append({
                    "frame_name": fname,
                    "score": float(hit.distance), # Cosine trả về similarity distance range [0, 1] cho search (tùy config metric type milvus, nhưng nó tương thích)
                    "video_id": ent.get("video_id"),
                    "frame_id": ent.get("frame_id"),
                    "shot_id": str(ent.get("shot_id", "1")),
                    "url": f"/keyframes/{fname}"
                })
            return results
        except Exception as e:
            print(f"Milvus search error on collection {collection_name}: {e}")
            return []

    # ------------------ QDRANT ------------------
    else:
        if not runtime.qdrant_client or q_models is None: return []
        try:
            must_conditions = []
            if allowed_frame_names:
                must_conditions.append(
                    q_models.FieldCondition(
                        key="frame_name",
                        match=q_models.MatchAny(any=allowed_frame_names),
                    )
                )
            if video_ids:
                must_conditions.append(
                    q_models.FieldCondition(
                        key="video_id",
                        match=q_models.MatchAny(any=video_ids),
                    )
                )

            query_filter = q_models.Filter(must=must_conditions) if must_conditions else None

            query_kwargs = {
                "collection_name": collection_name,
                "query": query_vector,
                "query_filter": query_filter,
                "limit": min(limit, len(allowed_frame_names)) if allowed_frame_names else limit,
                "with_payload": ["frame_name", "video_id", "frame_id", "shot_id"],
                "timeout": 300,
            }
            if vector_name:
                query_kwargs["using"] = vector_name
            response = await asyncio.to_thread(runtime.qdrant_client.query_points, **query_kwargs)
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


def weighted_rrf(
    rankings: List[tuple[List[Dict[str, Any]], float]],
    limit: int,
    k: int = 60,
) -> List[Dict[str, Any]]:
    fused: Dict[str, Dict[str, Any]] = {}
    scores: Dict[str, float] = defaultdict(float)
    for results, weight in rankings:
        if not results or weight <= 0:
            continue
        for rank, result in enumerate(results, start=1):
            frame_name = result.get("frame_name")
            if frame_name:
                fused.setdefault(frame_name, result.copy())
                scores[frame_name] += weight / (k + rank)
    for frame_name, result in fused.items():
        result["score"] = scores[frame_name]
        result["url"] = f"/keyframes/{frame_name}"
    return sorted(fused.values(), key=lambda result: result["score"], reverse=True)[:limit]


async def search_spatial_qdrant(
    query_vector: list,
    collection_name: str,
    spatial_region: str,
    limit: int = MAX_FRAME_LIMIT,
    candidate_frame_names: Optional[List[str]] = None,
    video_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    vector_names = SPATIAL_REGION_VECTORS.get(spatial_region)
    if not vector_names:
        return []
    rankings = await asyncio.gather(*[
        search_qdrant(query_vector, collection_name, limit=limit,
                      candidate_frame_names=candidate_frame_names,
                      video_ids=video_ids, vector_name=vector_name)
        for vector_name in vector_names
    ])
    return weighted_rrf([(results, 1.0) for results in rankings], limit=limit)

# --- Helper: Embed + Qdrant search cho MỘT model ---
async def embed_and_search_model(
    model_name: str,
    text: Optional[str] = None,
    image_name: Optional[str] = None,
    image_text: Optional[str] = None,
    limit: int = MAX_FRAME_LIMIT,
    candidate_frame_names: Optional[List[str]] = None,
    video_ids: Optional[List[str]] = None,  # <--- Bổ sung video_ids
    spatial_region: str = "full",
    spatial_only: bool = False,
):
    t_embed_start = time.time()
    embedding = await get_embedding(
        model_name=model_name,
        text=text,
        image_name=image_name,
        image_text=image_text,
    )
    t_embed = time.time() - t_embed_start
    if not embedding:
        print(f"  ❌ [Model: {model_name}] Embedding extraction FAILED in {t_embed:.3f}s")
        return model_name, None
    print(f"  ⏱ [Model: {model_name}] Embedding extracted in {t_embed:.3f}s")

    t_qdrant_start = time.time()
    config = MODEL_CONFIGS[model_name]
    if model_name == "beit3" and spatial_region in SPATIAL_REGION_VECTORS:
        spatial_results = await search_spatial_qdrant(
            embedding, config["spatial_collection"], spatial_region, limit=limit,
            candidate_frame_names=candidate_frame_names, video_ids=video_ids,
        )
        if spatial_only:
            raw_results = spatial_results
        else:
            full_results = await search_qdrant(
                embedding, config["collection"], limit=limit,
                candidate_frame_names=candidate_frame_names, video_ids=video_ids,
            )
            raw_results = weighted_rrf([(spatial_results, 0.8), (full_results, 0.2)], limit=limit)
    else:
        raw_results = await search_qdrant(
            embedding, config["collection"], limit=limit,
            candidate_frame_names=candidate_frame_names, video_ids=video_ids,
        )
    t_qdrant = time.time() - t_qdrant_start
    hit_count = len(raw_results) if raw_results is not None else 0
    db_name = "Milvus" if VECTOR_DATABASE == "milvus" else "Qdrant"
    print(f"  ⏱ [Model: {model_name}] {db_name} search returned {hit_count} hits in {t_qdrant:.3f}s (Total for model: {t_embed + t_qdrant:.3f}s)")
    return model_name, raw_results

async def search_all_models(
    models_to_use: List[str],
    text: Optional[str] = None,
    image_name: Optional[str] = None,
    image_text: Optional[str] = None,
    limit: int = MAX_FRAME_LIMIT,
    candidate_frame_names: Optional[List[str]] = None,
    video_ids: Optional[List[str]] = None,  # <--- Bổ sung video_ids
    spatial_region: str = "full",
    spatial_only: bool = False,
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
            spatial_region=spatial_region,
            spatial_only=spatial_only,
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

def keyframes_from_scene(
    video_id: str,
    frame_inside: Any,
    candidate_frame_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Convert the exact frame filenames stored in a semantic scene to shots."""
    if not isinstance(frame_inside, list):
        return []

    allowed = set(candidate_frame_names or [])
    shots = []
    for frame_name in frame_inside:
        if not isinstance(frame_name, str) or not frame_name.endswith(".webp"):
            continue
        if allowed and frame_name not in allowed:
            continue

        stem = os.path.splitext(os.path.basename(frame_name))[0]
        parts = stem.split("_")
        try:
            frame_id = int(parts[-1])
        except (ValueError, IndexError):
            continue
        frame_video_id = "_".join(parts[:2]) if len(parts) >= 3 else ""
        if frame_video_id != video_id:
            continue

        shot_id = parts[-2] if len(parts) >= 4 else "1"
        shots.append({
            "frame_name": frame_name,
            "filepath": f"/keyframes/{frame_name}",
            "video_id": video_id,
            "frame_id": frame_id,
            "shot_id": str(shot_id),
            "url": f"/keyframes/{frame_name}",
        })

    shots.sort(key=lambda shot: (shot["frame_id"], shot["frame_name"]))
    return shots


def _semantic_result_from_scene(
    scene_id: str,
    scene: Dict[str, Any],
    score: float,
    candidate_frame_names: Optional[List[str]],
    source_scores: Optional[Dict[str, float]] = None,
) -> Optional[Dict[str, Any]]:
    video_id = scene.get("video_id")
    if not isinstance(video_id, str):
        return None
    shots = keyframes_from_scene(video_id, scene.get("frame_inside", []), candidate_frame_names)
    if candidate_frame_names and not shots:
        return None
    result = {
        "chunk_id": scene_id, "scene_id": scene_id, "score": score,
        "video_id": video_id, "start_id": scene.get("start_id", 0),
        "end_id": scene.get("end_id", 0), "summary": scene.get("summary", ""),
        "frame_inside": [shot["frame_name"] for shot in shots], "shots": shots,
    }
    if source_scores is not None:
        result["source_scores"] = source_scores
    return result


def _semantic_meilisearch_filters(
    video_ids: Optional[List[str]], candidate_frame_names: Optional[List[str]]
) -> list[str]:
    """Build Meilisearch filters using JSON literals to safely quote values."""
    filters = []
    if video_ids:
        filters.append(f"video_id IN {json.dumps(video_ids, ensure_ascii=False)}")
    if candidate_frame_names is not None:
        if not candidate_frame_names:
            return ["id = '__no_semantic_asr_candidate__'"]
        filters.append(
            f"frame_inside IN {json.dumps(candidate_frame_names, ensure_ascii=False)}"
        )
    return filters


_EXACT_HIGHLIGHT_START = "__MEILI_HIGHLIGHT_START__"
_EXACT_HIGHLIGHT_END = "__MEILI_HIGHLIGHT_END__"
_SEMANTIC_EXACT_CANDIDATE_LIMIT = 5000


def _extract_exact_phrases(query_text: str) -> list[str]:
    """Return non-empty phrases wrapped in straight or curly double quotes."""
    normalized_query = (query_text or "").replace("“", '"').replace("”", '"')
    phrases = []
    for phrase in re.findall(r'"([^"\n]+)"', normalized_query):
        normalized_phrase = " ".join(phrase.split())
        if normalized_phrase and normalized_phrase not in phrases:
            phrases.append(normalized_phrase)
    return phrases


def _extract_exact_words(query_text: str) -> list[str]:
    """Return individual words wrapped in straight or curly single quotes."""
    normalized_query = (query_text or "").replace("‘", "'").replace("’", "'")
    # Exclude content inside double quotes first so single quotes inside double quotes aren't misparsed
    query_without_double_quotes = re.sub(r'"[^"\n]*"', " ", normalized_query)
    words = []
    for phrase in re.findall(r"'([^'\n]+)'", query_without_double_quotes):
        for word in phrase.split():
            clean_word = word.strip()
            if clean_word and clean_word not in words:
                words.append(clean_word)
    return words


def _extract_unquoted_query_text(query_text: str) -> str:
    """Return the query portion which retains normal Meilisearch matching."""
    normalized_query = (
        (query_text or "")
        .replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
    )
    unquoted = re.sub(r'"[^"\n]*"', " ", normalized_query)
    unquoted = re.sub(r"'[^'\n]*'", " ", unquoted)
    return " ".join(unquoted.replace(",", " ").split())


def _exact_phrase_pattern(phrase: str) -> re.Pattern[str]:
    # Whitespace may vary in ASR text, but every word and its order must be
    # exact. Unicode-aware word boundaries prevent partial-word matches.
    words = [re.escape(word) for word in phrase.split()]
    return re.compile(r"(?<!\w)" + r"\s+".join(words) + r"(?!\w)", re.IGNORECASE)


def _exact_word_pattern(word: str) -> re.Pattern[str]:
    return re.compile(r"(?<!\w)" + re.escape(word) + r"(?!\w)", re.IGNORECASE)


def _summary_matches_exact_requirements(
    summary: str,
    phrases: list[str],
    words: list[str],
) -> bool:
    phrase_match = all(_exact_phrase_pattern(phrase).search(summary) for phrase in phrases)
    if not phrase_match:
        return False
    return all(_exact_word_pattern(word).search(summary) for word in words)


def _highlight_exact_and_meili_matches(
    summary: str,
    exact_phrases: list[str],
    exact_words: list[str],
    meili_formatted_summary: Optional[str],
) -> str:
    """Merge verified quoted spans with Meilisearch's unquoted highlights."""
    spans = []
    if isinstance(meili_formatted_summary, str):
        cursor = 0
        plain_parts = []
        plain_length = 0
        highlight_start = None
        while cursor < len(meili_formatted_summary):
            if meili_formatted_summary.startswith(_EXACT_HIGHLIGHT_START, cursor):
                highlight_start = plain_length
                cursor += len(_EXACT_HIGHLIGHT_START)
            elif meili_formatted_summary.startswith(_EXACT_HIGHLIGHT_END, cursor):
                if highlight_start is not None:
                    spans.append((highlight_start, plain_length))
                highlight_start = None
                cursor += len(_EXACT_HIGHLIGHT_END)
            else:
                plain_parts.append(meili_formatted_summary[cursor])
                plain_length += 1
                cursor += 1
        # The formatter must be based on this exact source summary, otherwise
        # its offsets are not safe to apply.
        if "".join(plain_parts) != summary:
            spans.clear()

    for phrase in exact_phrases:
        spans.extend(match.span() for match in _exact_phrase_pattern(phrase).finditer(summary))

    for word in exact_words:
        spans.extend(match.span() for match in _exact_word_pattern(word).finditer(summary))

    if not spans:
        return summary

    merged_spans = []
    for start, end in sorted(spans):
        if merged_spans and start <= merged_spans[-1][1]:
            merged_spans[-1] = (merged_spans[-1][0], max(end, merged_spans[-1][1]))
        else:
            merged_spans.append((start, end))

    highlighted = summary
    for start, end in reversed(merged_spans):
        highlighted = (
            highlighted[:start]
            + _EXACT_HIGHLIGHT_START
            + highlighted[start:end]
            + _EXACT_HIGHLIGHT_END
            + highlighted[end:]
        )
    return highlighted


def search_semantic_asr_on_meilisearch_sync(
    query_text: str,
    limit: int = 50,
    offset: int = 0,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
    sentence_level: bool = False,
) -> tuple[List[Dict[str, Any]], int]:
    """Search semantic scene summaries in the dedicated Meilisearch index."""
    if not runtime.meili_client:
        return [], 0
    try:
        index_name = (
            SEMANTIC_ASR_SENTENCE_LEVEL_INDEX_NAME
            if sentence_level
            else SEMANTIC_ASR_INDEX_NAME
        )
        scene_mapping = (
            runtime.scene_frame_mapping_sentence_level
            if sentence_level
            else runtime.scene_frame_mapping
        )
        meilisearch_query = (
            (query_text or "")
            .replace("“", '"')
            .replace("”", '"')
            .replace("‘", "'")
            .replace("’", "'")
        )
        exact_phrases = _extract_exact_phrases(meilisearch_query)
        exact_words = _extract_exact_words(meilisearch_query)
        unquoted_query_text = _extract_unquoted_query_text(meilisearch_query)
        has_exact_requirement = bool(exact_phrases or exact_words)
        params: Dict[str, Any] = {
            # Exact phrases/words are post-filtered, so retrieve all likely scenes
            # before applying local pagination.
            "limit": _SEMANTIC_EXACT_CANDIDATE_LIMIT if has_exact_requirement else limit,
            "offset": 0 if has_exact_requirement else offset,
            "showRankingScore": True,
            "attributesToSearchOn": ["summary"],
            "attributesToHighlight": ["summary"],
            # Deliberately use inert markers instead of HTML. The UI converts
            # only these known markers to React <mark> elements.
            "highlightPreTag": "__MEILI_HIGHLIGHT_START__",
            "highlightPostTag": "__MEILI_HIGHLIGHT_END__",
            "attributesToRetrieve": [
                "id", "scene_id", "summary", "video_id", "start_id", "end_id", "frame_inside",
            ],
        }
        filters = _semantic_meilisearch_filters(video_ids, candidate_frame_names)
        if filters:
            params["filter"] = filters
        index = runtime.meili_client.index(index_name)
        response = index.search(meilisearch_query, params)
        unquoted_formatted_by_scene = {}
        if has_exact_requirement and unquoted_query_text:
            # This second formatting pass contains only unquoted terms. Thus a
            # quoted term can never regain a fuzzy/typo highlight (e.g. "tàn"
            # must not highlight "tận").
            unquoted_response = index.search(unquoted_query_text, params)
            for unquoted_hit in unquoted_response.get("hits", []):
                unquoted_scene_id = unquoted_hit.get("scene_id") or unquoted_hit.get("id")
                formatted = (unquoted_hit.get("_formatted") or {}).get("summary")
                if isinstance(unquoted_scene_id, str) and isinstance(formatted, str):
                    unquoted_formatted_by_scene[unquoted_scene_id] = formatted
        results = []
        for hit in response.get("hits", []):
            summary = hit.get("summary")
            if has_exact_requirement and (
                not isinstance(summary, str)
                or not _summary_matches_exact_requirements(summary, exact_phrases, exact_words)
            ):
                continue
            scene_id = hit.get("scene_id") or hit.get("id")
            if not isinstance(scene_id, str) or not isinstance(hit.get("video_id"), str):
                continue
            scene_info = scene_mapping.get(scene_id) or {}
            frame_inside = scene_info.get("frame_inside") or hit.get("frame_inside") or []
            hit_data = dict(hit)
            hit_data["frame_inside"] = frame_inside

            result = _semantic_result_from_scene(
                scene_id,
                hit_data,
                float(hit.get("_rankingScore", 0.0)),
                candidate_frame_names,
                source_scores={"meilisearch": float(hit.get("_rankingScore", 0.0))},
            )
            if result:
                if has_exact_requirement:
                    result["formatted_summary"] = _highlight_exact_and_meili_matches(
                        summary,
                        exact_phrases,
                        exact_words,
                        unquoted_formatted_by_scene.get(scene_id),
                    )
                else:
                    formatted = (hit.get("_formatted") or {}).get("summary")
                    if isinstance(formatted, str):
                        result["formatted_summary"] = formatted
                results.append(result)
        if has_exact_requirement:
            return results[offset:offset + limit], len(results)
        total = response.get("totalHits", response.get("estimatedTotalHits", len(results)))
        return results, int(total)
    except Exception as exc:
        print(f"Error searching semantic ASR in Meilisearch: {exc}")
        return [], 0


async def search_semantic_asr_on_meilisearch(
    query_text: str,
    limit: int = 50,
    offset: int = 0,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
    sentence_level: bool = False,
) -> tuple[List[Dict[str, Any]], int]:
    return await asyncio.to_thread(
        search_semantic_asr_on_meilisearch_sync,
        query_text, limit, offset, video_ids, candidate_frame_names, sentence_level,
    )


async def search_semantic_asr_qdrant(
    query_vector: list,
    limit: int = 50,
    offset: int = 0,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
    sentence_level: bool = False,
) -> tuple[List[Dict[str, Any]], int]:
    """Retrieve semantic ASR scenes and their exact mapped keyframes."""
    if not runtime.qdrant_client or q_models is None:
        return [], 0
    try:
        scene_mapping = (
            runtime.scene_frame_mapping_sentence_level
            if sentence_level
            else runtime.scene_frame_mapping
        )
        frame_scene_ids_map = (
            runtime.frame_scene_ids_map_sentence_level
            if sentence_level
            else runtime.frame_scene_ids_map
        )
        if not scene_mapping:
            print("Semantic ASR scene mapping is not loaded")
            return [], 0

        must_conditions = []
        if video_ids:
            must_conditions.append(
                q_models.FieldCondition(
                    key="video_id",
                    match=q_models.MatchAny(any=video_ids),
                )
            )
        if candidate_frame_names is not None:
            scene_ids = sorted({
                scene_id
                for frame_name in candidate_frame_names
                for scene_id in frame_scene_ids_map.get(frame_name, [])
            })
            if not scene_ids:
                return [], 0
            must_conditions.append(
                q_models.FieldCondition(
                    key="scene_id",
                    match=q_models.MatchAny(any=scene_ids),
                )
            )
        query_filter = q_models.Filter(must=must_conditions) if must_conditions else None
        collection_name = MODEL_CONFIGS["qwen"]["collection"]

        response, count_response = await asyncio.gather(
            asyncio.to_thread(
                runtime.qdrant_client.query_points,
                collection_name=collection_name,
                query=query_filter,
                limit=limit,
                offset=offset,
                with_payload=["scene_id", "video_id"],
                timeout=60,
            ),
            asyncio.to_thread(
                runtime.qdrant_client.count,
                collection_name=collection_name,
                count_filter=query_filter,
                exact=True,
            ),
        )

        results = []
        for hit in response.points:
            payload = hit.payload or {}
            scene_id = payload.get("scene_id")
            scene = scene_mapping.get(scene_id)
            if not isinstance(scene, dict):
                continue
            video_id = scene.get("video_id")
            if not isinstance(video_id, str):
                continue
            shots = keyframes_from_scene(
                video_id,
                scene.get("frame_inside", []),
                candidate_frame_names=candidate_frame_names,
            )
            if candidate_frame_names and not shots:
                continue
            results.append({
                "chunk_id": scene_id,
                "scene_id": scene_id,
                "score": hit.score,
                "video_id": video_id,
                "start_id": scene.get("start_id", 0),
                "end_id": scene.get("end_id", 0),
                "summary": scene.get("summary", ""),
                "frame_inside": [shot["frame_name"] for shot in shots],
                "shots": shots,
            })
        return results, count_response.count
    except Exception as exc:
        print(f"Error searching semantic ASR collection: {exc}")
        return [], 0


async def search_semantic_asr(
    query_text: str,
    query_vector: Optional[list],
    search_mode: str = "meilisearch",
    embedding_weight: float = 0.7,
    meilisearch_weight: float = 0.3,
    limit: int = 50,
    offset: int = 0,
    video_ids: Optional[List[str]] = None,
    candidate_frame_names: Optional[List[str]] = None,
    sentence_level: bool = False,
) -> tuple[List[Dict[str, Any]], int]:
    """Search semantic ASR scenes with Meilisearch, Qdrant, or both."""
    if search_mode == "embedding":
        if not query_vector:
            return [], 0
        return await search_semantic_asr_qdrant(
            query_vector, limit, offset, video_ids, candidate_frame_names, sentence_level
        )

    if search_mode == "meilisearch":
        return await search_semantic_asr_on_meilisearch(
            query_text, limit, offset, video_ids, candidate_frame_names, sentence_level
        )

    if not query_vector:
        return [], 0
    candidate_limit = max(200, (offset + limit) * 5)
    (meili_results, _), (vector_results, _) = await asyncio.gather(
        search_semantic_asr_on_meilisearch(
            query_text, candidate_limit, 0, video_ids, candidate_frame_names, sentence_level
        ),
        search_semantic_asr_qdrant(
            query_vector, candidate_limit, 0, video_ids, candidate_frame_names, sentence_level
        ),
    )
    weight_total = embedding_weight + meilisearch_weight
    if weight_total <= 0:
        raise ValueError("At least one semantic ASR search weight must be greater than zero.")
    embedding_weight /= weight_total
    meilisearch_weight /= weight_total

    max_meili_score = max((float(item["score"]) for item in meili_results), default=1.0) or 1.0
    by_scene: Dict[str, Dict[str, Any]] = {}
    meili_by_scene: Dict[str, Dict[str, Any]] = {}
    for item in meili_results:
        scene_id = item.get("scene_id")
        if isinstance(scene_id, str):
            meili_by_scene[scene_id] = item
    for item in vector_results + meili_results:
        scene_id = item.get("scene_id")
        if isinstance(scene_id, str):
            by_scene.setdefault(scene_id, item)
    vector_scores = {
        item["scene_id"]: max(0.0, min(1.0, float(item["score"])))
        for item in vector_results
        if isinstance(item.get("scene_id"), str)
    }
    meili_scores = {
        item["scene_id"]: float(item["score"]) / max_meili_score
        for item in meili_results
        if isinstance(item.get("scene_id"), str)
    }

    ranked = []
    for scene_id, result in by_scene.items():
        embedding_score = vector_scores.get(scene_id, 0.0)
        meili_score = meili_scores.get(scene_id, 0.0)
        result = result.copy()
        result["score"] = embedding_weight * embedding_score + meilisearch_weight * meili_score
        result["source_scores"] = {
            "embedding": embedding_score,
            "meilisearch": meili_score,
        }
        formatted_summary = meili_by_scene.get(scene_id, {}).get("formatted_summary")
        if isinstance(formatted_summary, str):
            result["formatted_summary"] = formatted_summary
        ranked.append(result)
    ranked.sort(key=lambda result: result["score"], reverse=True)
    return ranked[offset:offset + limit], len(ranked)
