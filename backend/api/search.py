from __future__ import annotations

import asyncio
import shutil
import time
import uuid
import re
import requests
from urllib.parse import quote
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.core import runtime
from backend.core.config import MAX_FRAME_LIMIT, MODEL_CONFIGS, TEMP_UPLOAD_DIR, TRANSLATE_PROVIDER, VECTOR_DATABASE
from backend.schemas.search import EnhanceQueryRequest, StageData, TemporalSearchRequest, UnifiedSearchRequest, SemanticAsrSearchRequest
from backend.services.search import (
    _combine_and_rerank_results,
    fuse_results,
    get_embedding,
    process_and_cluster_results,
    search_all_models,
    infer_spatial_query,
    search_ocr_asr_on_meilisearch_async,
    attach_similarity_labels,
    find_similar_frames,
    search_semantic_asr
)
from backend.services.translation import google_translate_text, llm_translate_text


router = APIRouter()

# Image and composed image+text retrieval are deliberately not configurable.
# The BGE-VL collection was built with BGE embeddings, and BGE-VL is the model
# that supports native image + textual-feedback (CIR) embeddings.
IMAGE_SEARCH_MODEL = "bge"


def image_search_models(image_name: Optional[str], image_text: Optional[str], requested_models: list[str]) -> list[str]:
    """Return the only valid model set for an image-mode query.

    Enforcing this in the API is intentional: the UI model picker is only a
    convenience and must not be able to make an image vector incompatible with
    the BGE Qdrant collection.
    """
    # `image_text` is feedback for an already supplied image. On its
    # own it is a plain text query and must retain the selected text models.
    if image_name and image_text:
        return [IMAGE_SEARCH_MODEL]
    return [model for model in requested_models if model in MODEL_CONFIGS]

google_search_session = requests.Session()
google_search_session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
})

def get_google_images(keyword: str, k: int = 15):
    try:
        from backend.core.config import TAVILY_API_KEY
        import requests
        
        if not TAVILY_API_KEY:
            print("TAVILY_API_KEY is not set.")
            return []
            
        res = requests.post("https://api.tavily.com/search", json={
            "api_key": TAVILY_API_KEY,
            "query": keyword,
            "include_images": True,
            "search_depth": "basic"
        })
        res.raise_for_status()
        data = res.json()
        images = data.get("images", [])
        return images[:k]
    except Exception as e:
        print(f"Error during Image Search (Tavily): {e}")
        return []

@router.get("/google_images")
async def google_images(q: str):
    if not q:
        return []
    results = await asyncio.to_thread(get_google_images, q, 30)
    return results

@router.post("/search")
async def search_unified(search_data: str = Form(...), query_image: Optional[UploadFile] = File(None)):
    start_time = time.time()
    timings = {}
    
    try:
        search_model = UnifiedSearchRequest.parse_raw(search_data)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Cấu trúc dữ liệu không hợp lệ: {e}")

    image_name = None
    if query_image:
        image_name = f"direct_{uuid.uuid4()}.jpg"
        temp_filepath = TEMP_UPLOAD_DIR / image_name
        with temp_filepath.open("wb") as buffer:
            shutil.copyfileobj(query_image.file, buffer)
    else:
        image_name = search_model.query_image_name

    models_to_use = image_search_models(
        image_name,
        search_model.image_search_text or search_model.query_text,
        search_model.models or ["beit3"],
    )
    if not models_to_use: models_to_use = ["beit3"]

    spatial = infer_spatial_query(search_model.query_text, search_model.spatial_region)
    spatial_only = bool(search_model.spatial_only and spatial["spatial_region"] != "full")
    if spatial_only:
        models_to_use = ["beit3"]
        
    weights = ({IMAGE_SEARCH_MODEL: 1.0} if models_to_use == [IMAGE_SEARCH_MODEL]
               else search_model.model_weights or {"beit3": 1.0})

    has_vector_query = bool(search_model.query_text or image_name or search_model.image_search_text)
    has_filter_query = bool(search_model.ocr_query or search_model.asr_query) 

    print(f"\n==================== [SEARCH PIPELINE START] ====================")
    print(f" ▶ Query Text  : {repr(search_model.query_text)}")
    print(f" ▶ Image Query : {image_name}")
    print(f" ▶ Models      : {models_to_use}")
    print(f" ▶ OCR Filter  : {repr(search_model.ocr_query)} | ASR Filter: {repr(search_model.asr_query)}")
    print(f" ▶ Spatial     : region='{spatial.get('spatial_region')}' (only={spatial_only})")
    if search_model.candidate_frame_names:
        print(f" ▶ Candidate Filter: {len(search_model.candidate_frame_names)} frames")
    if search_model.video_ids:
        print(f" ▶ Video Filter    : {search_model.video_ids}")

    async def _vector_stage():
        if not has_vector_query:
            return []
        t_vec_start = time.time()
        results_by_model = await search_all_models(
            models_to_use,
            text=spatial["semantic_query"],
            image_name=image_name,
            image_text=search_model.image_search_text,
            limit=MAX_FRAME_LIMIT,
            candidate_frame_names=search_model.candidate_frame_names,
            video_ids=search_model.video_ids,  
            spatial_region=spatial["spatial_region"],
            spatial_only=spatial_only,
        )
        fused = fuse_results(results_by_model, {m: weights.get(m, 1.0) for m in models_to_use})
        print(f"  ⏱ [Stage: Vector Search & Fusion] Finished in {time.time() - t_vec_start:.3f}s -> {len(fused)} items")
        return fused

    async def _ocr_stage():
        if not has_filter_query:
            return []
        t_filter_start = time.time()
        res = await search_ocr_asr_on_meilisearch_async(
            ocr_keyword=search_model.ocr_query,
            asr_keyword=search_model.asr_query,
            limit=5000,
            candidate_frame_names=search_model.candidate_frame_names,
            video_ids=search_model.video_ids, 
        )
        print(f"  ⏱ [Stage: OCR/ASR Meilisearch] Finished in {time.time() - t_filter_start:.3f}s -> {len(res)} items")
        return res

    start_retrieval = time.time()
    fused_vector_results, filter_search_results = await asyncio.gather(_vector_stage(), _ocr_stage())
    timings["retrieval_s"] = time.time() - start_retrieval

    t_rerank_start = time.time()
    final_results = []
    if has_vector_query and has_filter_query:
        final_results = _combine_and_rerank_results(fused_vector_results, filter_search_results)
    elif has_vector_query:
        final_results = fused_vector_results
    elif has_filter_query:
        for res in filter_search_results: 
            res['score'] = res.get('score', 0.0)
            res['url'] = f"/keyframes/{res['frame_name']}"
        final_results = sorted(filter_search_results, key=lambda x: x.get('score', 0), reverse=True)
    t_rerank = time.time() - t_rerank_start

    start_final = time.time()
    t_label_start = time.time()
    attach_similarity_labels(final_results)
    t_label = time.time() - t_label_start

    t_cluster_start = time.time()
    clustered = process_and_cluster_results(final_results)
    t_cluster = time.time() - t_cluster_start

    total_results = len(clustered)
    start_idx = (search_model.page - 1) * search_model.page_size
    paginated = clustered[start_idx:start_idx + search_model.page_size]
    
    timings["final_processing_s"] = time.time() - start_final
    timings["total_request_s"] = time.time() - start_time

    db_name = "Milvus" if VECTOR_DATABASE == "milvus" else "Qdrant"
    print(f" ----------------- TIMING SUMMARY -----------------")
    print(f"  • Retrieval ({db_name}/Meili) : {timings['retrieval_s']:.3f}s")
    print(f"  • Score Fusion & Reranking : {t_rerank:.3f}s")
    print(f"  • Similarity Labels        : {t_label:.3f}s")
    print(f"  • Temporal Clustering      : {t_cluster:.3f}s ({len(final_results)} frames -> {total_results} clusters)")
    print(f"  • TOTAL BACKEND TIME       : {timings['total_request_s']:.3f}s")
    print(f"==================== [SEARCH PIPELINE END] ====================\n")
    return {
        "results": paginated,
        "total_results": total_results,
        "timing_info": timings,
        "spatial_interpretation": spatial,
    }

# --- Corrected Enhance Query Endpoint (Direct calls to LangChain base structures and Async helper) ---
@router.post("/enhance_query")
async def enhance_query(request_data: EnhanceQueryRequest):
    query = (request_data.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query is required.")

    if request_data.literal_translate:
        try:
            if TRANSLATE_PROVIDER in {"google", "google_translate", "googletrans"}:
                enhanced = await google_translate_text(query)
            elif TRANSLATE_PROVIDER in {"llm", "llm_translate", "vllm"}:
                enhanced = await llm_translate_text(runtime.llm_translate, query)
            else:
                raise HTTPException(
                    status_code=500,
                    detail="Invalid TRANSLATE_PROVIDER. Use 'llm_translate' or 'google_translate'.",
                )

            print(f"Translated Query ({TRANSLATE_PROVIDER}): {enhanced}")
            return {"enhanced_query": enhanced}
        except HTTPException as exc:
            if exc.status_code == 500:
                raise
            print(f"Translation failed with provider '{TRANSLATE_PROVIDER}': {exc.detail}. Using original query.")
            return {"enhanced_query": query, "translation_error": str(exc.detail)}
        except Exception as exc:
            print(f"Translation failed with provider '{TRANSLATE_PROVIDER}': {exc}. Using original query.")
            return {"enhanced_query": query, "translation_error": str(exc)}

    context_parts = []
    if request_data.ocr_query:
        context_parts.append(f"OCR filter: {request_data.ocr_query.strip()}")
    if request_data.asr_query:
        context_parts.append(f"ASR filter: {request_data.asr_query.strip()}")
    context_text = "\n".join(context_parts) if context_parts else "No OCR/ASR filters."

    system_prompt = """
        Rewrite the user's video/image retrieval query into a concise, vivid visual search query.
        Preserve all concrete entities, actions, colors, locations, text, and temporal intent.
        Do not add facts that are not implied. Return only the improved query, no quotes or explanation.
        If the user's query is in vietnamese, change it to english. If the user's query is in english, keep it in english.
    """
    human_prompt = f"Query:\n{query}\n\nContext:\n{context_text}"

    messages = [
        ("system", system_prompt),
        ("human", human_prompt)
    ]

    if runtime.llm_enhance is None:
        raise HTTPException(status_code=503, detail="Groq LLM for query enhancement is not initialized.")
    enhanced = runtime.llm_enhance.invoke(messages).content.strip()

    print(f"Enhanced Query: {enhanced}")

    return {"enhanced_query": enhanced}

async def _temporal_search_legacy(request_data: TemporalSearchRequest):
    start_time = time.time()
    timings = {}
    
    stages = request_data.stages
    ambiguous = request_data.ambiguous
    
    if not stages:
        raise HTTPException(status_code=400, detail="Stages are required.")
        
    models_to_use = request_data.models or ["beit3"]
    models_to_use = [m for m in models_to_use if m in MODEL_CONFIGS]
    if not models_to_use: models_to_use = ["beit3"]
        
    weights = request_data.model_weights or {"beit3": 1.0}
    
    valid_stage_results = []
    processed_queries_for_ui = []
    
    for idx, stage in enumerate(stages):
        has_vector_query = bool(stage.query or stage.query_image_name or stage.image_search_text)
        has_filter_query = bool(stage.ocr_query or stage.asr_query)
        
        if not has_vector_query and not has_filter_query:
            processed_queries_for_ui.append("Empty Stage")
            continue

        async def _stage_vector(stg=stage):
            if not (stg.query or stg.query_image_name or stg.image_search_text):
                return []
            stage_models = image_search_models(
                stg.query_image_name,
                stg.image_search_text or stg.query,
                models_to_use,
            ) or ["beit3"]
            spatial = infer_spatial_query(stg.query, stg.spatial_region)
            stage_spatial_only = bool(stg.spatial_only and spatial["spatial_region"] != "full")
            if stage_spatial_only:
                stage_models = ["beit3"]
            stage_weights = ({IMAGE_SEARCH_MODEL: 1.0}
                             if stage_models == [IMAGE_SEARCH_MODEL]
                             else {model: weights.get(model, 1.0) for model in stage_models})
            results_by_model = await search_all_models(
                stage_models,
                text=spatial["semantic_query"],
                image_name=stg.query_image_name,
                image_text=stg.image_search_text,
                limit=MAX_FRAME_LIMIT,
                spatial_region=spatial["spatial_region"],
                spatial_only=stage_spatial_only,
            )
            return fuse_results(results_by_model, stage_weights)

        async def _stage_ocr(stg=stage):
            if not (stg.ocr_query or stg.asr_query):
                return []
            return await search_ocr_asr_on_meilisearch_async(
                ocr_keyword=stg.ocr_query, asr_keyword=stg.asr_query, limit=MAX_FRAME_LIMIT,
            )

        fused_stage_results, filter_stage_results = await asyncio.gather(_stage_vector(), _stage_ocr())

        final_stage_results = []
        if has_vector_query and has_filter_query:
            final_stage_results = _combine_and_rerank_results(fused_stage_results, filter_stage_results)
        elif has_vector_query:
            final_stage_results = fused_stage_results
        elif has_filter_query:
            for res in filter_stage_results:
                res['score'] = res.get('score', 0.0)
                res['url'] = f"/keyframes/{res['frame_name']}"
            final_stage_results = sorted(filter_stage_results, key=lambda x: x.get('score', 0), reverse=True)

        clustered_stage = process_and_cluster_results(final_stage_results)
        valid_stage_results.append(clustered_stage)
        
        ui_query = stage.query or stage.ocr_query or f"Stage {idx+1} Input"
        processed_queries_for_ui.append(ui_query)

    for stage_clusters in valid_stage_results:
        for cluster in stage_clusters:
            if cluster.get('shots'):
                shot_ids_int = []
                for s in cluster['shots']:
                    try: shot_ids_int.append(int(s['shot_id']))
                    except: pass
                if shot_ids_int:
                    cluster['min_shot_id'] = min(shot_ids_int)
                    cluster['max_shot_id'] = max(shot_ids_int)
                    cluster['video_id'] = cluster['best_shot']['video_id']
    
    clusters_by_video = defaultdict(lambda: defaultdict(list))
    for i, stage_clusters in enumerate(valid_stage_results):
        for cluster in stage_clusters:
            if 'video_id' in cluster:
                clusters_by_video[cluster['video_id']][i].append(cluster)
    
    all_valid_sequences = []
    if not ambiguous:
        for video_id, video_stages in clusters_by_video.items():
            if len(video_stages) < len(stages): continue
            def find_sequences_recursive(stage_idx: int, current_sequence: list):
                if stage_idx == len(stages):
                    all_valid_sequences.append(list(current_sequence))
                    return
                for next_cluster in video_stages.get(stage_idx, []):
                    if not current_sequence or next_cluster.get('min_shot_id', -1) > current_sequence[-1].get('max_shot_id', -1):
                        current_sequence.append(next_cluster)
                        find_sequences_recursive(stage_idx + 1, current_sequence)
                        current_sequence.pop()
            find_sequences_recursive(0, [])
    else:
        for video_id, video_stages in clusters_by_video.items():
            if len(video_stages) < len(stages): continue
            best_clusters_for_video = []
            for stage_idx in range(len(stages)):
                stage_clusters = video_stages.get(stage_idx, [])
                if not stage_clusters:
                    best_clusters_for_video = []
                    break
                best_clusters_for_video.append(max(stage_clusters, key=lambda c: c.get('cluster_score', 0)))
            if best_clusters_for_video:
                all_valid_sequences.append(best_clusters_for_video)
                
    processed_sequences = []
    TEMPORAL_PENALTY_WEIGHT = 0.05
    for cluster_seq in all_valid_sequences:
        if not cluster_seq: continue
        avg_score = sum(c.get('cluster_score', 0) for c in cluster_seq) / len(cluster_seq)
        total_temporal_gap = 0
        if len(cluster_seq) > 1 and not ambiguous:
            for i in range(len(cluster_seq) - 1):
                gap = cluster_seq[i+1].get('min_shot_id', 0) - cluster_seq[i].get('max_shot_id', 0)
                if gap > 0: total_temporal_gap += gap
        combined_score = avg_score / (1 + (total_temporal_gap * TEMPORAL_PENALTY_WEIGHT))
        
        shots_to_display = []
        for c in cluster_seq:
            shot_mapped = c['best_shot'].copy()
            if 'url' not in shot_mapped:
                shot_mapped['url'] = f"/keyframes/{shot_mapped['frame_name']}"
            shots_to_display.append(shot_mapped)
            
        processed_sequences.append({
            "combined_score": combined_score,
            "average_rrf_score": avg_score,
            "temporal_gap": total_temporal_gap,
            "clusters": cluster_seq,
            "shots": shots_to_display,
            "video_id": cluster_seq[0].get('video_id', 'N/A')
        })
        
    final_sequences_all = sorted(processed_sequences, key=lambda x: x['combined_score'], reverse=True)
    total_sequences = len(final_sequences_all)
    
    start_idx = (request_data.page - 1) * request_data.page_size
    paginated_sequences = final_sequences_all[start_idx : start_idx + request_data.page_size]
    
    timings["total_request_s"] = time.time() - start_time
    
    return {
        "results": paginated_sequences,
        "processed_queries": processed_queries_for_ui,
        "is_temporal_search": not ambiguous,
        "is_ambiguous_search": ambiguous,
        "total_results": total_sequences,
        "timing_info": timings
    }

@router.post("/temporal_search")
async def temporal_search_previous_behavior(request_data: TemporalSearchRequest):
    start_time = time.time()
    timings = {}
    stages = request_data.stages
    ambiguous = request_data.ambiguous
    specified_videos = set(request_data.specified_videos or request_data.video_ids or [])
    candidate_frame_names = request_data.candidate_frame_names

    if not stages:
        raise HTTPException(status_code=400, detail="Stages are required.")

    models_to_use = [
        model
        for model in (request_data.models or ["beit3"])
        if model in MODEL_CONFIGS
    ] or ["beit3"]
    weights = request_data.model_weights or {"beit3": 1.0}

    async def get_stage_results(index: int, stage: StageData):
        has_vector_query = bool(stage.query or stage.query_image_name or stage.image_search_text)
        has_filter_query = bool(stage.ocr_query or stage.asr_query)
        if not has_vector_query and not has_filter_query:
            return index, [], "Empty Stage", {"semantic_query": "", "spatial_region": "full", "source": "none"}

        spatial = infer_spatial_query(stage.query, stage.spatial_region)
        stage_spatial_only = bool(stage.spatial_only and spatial["spatial_region"] != "full")

        async def vector_search():
            if not has_vector_query:
                return []
            stage_models = image_search_models(
                stage.query_image_name,
                stage.image_search_text or stage.query,
                models_to_use,
            ) or ["beit3"]
            if stage_spatial_only:
                stage_models = ["beit3"]
            stage_weights = ({IMAGE_SEARCH_MODEL: 1.0}
                             if stage_models == [IMAGE_SEARCH_MODEL]
                             else {model: weights.get(model, 1.0) for model in stage_models})
            results_by_model = await search_all_models(
                stage_models,
                text=spatial["semantic_query"],
                image_name=stage.query_image_name,
                image_text=stage.image_search_text,
                limit=MAX_FRAME_LIMIT,
                candidate_frame_names=candidate_frame_names,
                video_ids=list(specified_videos) if specified_videos else None,
                spatial_region=spatial["spatial_region"],
                spatial_only=stage_spatial_only,
            )
            return fuse_results(
                results_by_model,
                stage_weights,
            )

        async def filter_search():
            if not has_filter_query:
                return []
            return await search_ocr_asr_on_meilisearch_async(
                ocr_keyword=stage.ocr_query, asr_keyword=stage.asr_query,
                limit=MAX_FRAME_LIMIT,
                candidate_frame_names=candidate_frame_names,
                video_ids=list(specified_videos) if specified_videos else None,
            )

        vector_results, filter_results = await asyncio.gather(
            vector_search(),
            filter_search(),
        )

        if has_vector_query and has_filter_query:
            stage_results = _combine_and_rerank_results(vector_results, filter_results)
        elif has_vector_query:
            stage_results = vector_results
        else:
            for result in filter_results:
                result['score'] = result.get('score', 0.0)
                result['url'] = f"/keyframes/{result['frame_name']}"
            stage_results = sorted(
                filter_results,
                key=lambda result: result.get('score', 0),
                reverse=True,
            )

        display_query = stage.query or stage.ocr_query or stage.asr_query or f"Stage {index + 1} Input"
        return index, stage_results, display_query, spatial

    stage_started = time.time()
    gathered_stages = await asyncio.gather(
        *(get_stage_results(index, stage) for index, stage in enumerate(stages)),
        return_exceptions=True,
    )
    timings["stage_candidate_gathering_s"] = time.time() - stage_started

    stage_failure = next(
        (result for result in gathered_stages if isinstance(result, Exception)),
        None,
    )
    if stage_failure is not None:
        print(f"Temporal stage failed: {stage_failure}")
        return {
            "results": [],
            "processed_queries": [],
            "is_temporal_search": not ambiguous,
            "is_ambiguous_search": ambiguous,
            "total_results": 0,
            "timing_info": {**timings, "total_request_s": time.time() - start_time},
        }

    ordered_stages = sorted(gathered_stages, key=lambda result: result[0])
    processed_queries = [result[2] for result in ordered_stages]
    spatial_interpretations = [result[3] for result in ordered_stages]
    stage_candidates = [result[1] for result in ordered_stages]
    stage_candidate_counts = [len(candidates) for candidates in stage_candidates]

    if specified_videos:
        stage_candidates = [
            [shot for shot in candidates if shot.get('video_id') in specified_videos]
            for candidates in stage_candidates
        ]

    clustered_results_by_stage = []
    for candidates in stage_candidates:
        unique_candidates = {}
        for shot in candidates:
            candidate_key = shot.get('frame_name') or shot.get('filepath')
            if candidate_key:
                unique_candidates[candidate_key] = shot
        clustered_results_by_stage.append(
            process_and_cluster_results(list(unique_candidates.values()))
        )
    stage_cluster_counts = [len(clusters) for clusters in clustered_results_by_stage]
    temporal_debug = {
        "stage_candidate_counts": stage_candidate_counts,
        "stage_candidate_counts_after_video_filter": [len(candidates) for candidates in stage_candidates],
        "stage_cluster_counts": stage_cluster_counts,
        "candidate_limit_per_stage": MAX_FRAME_LIMIT,
        "used_relaxed_fallback": False,
        "failure_reason": None,
    }

    if any(not clusters for clusters in clustered_results_by_stage):
        temporal_debug["failure_reason"] = "at_least_one_stage_has_no_clusters"
        return {
            "results": [],
            "processed_queries": processed_queries,
            "is_temporal_search": not ambiguous,
            "is_ambiguous_search": ambiguous,
            "total_results": 0,
            "timing_info": {**timings, "total_request_s": time.time() - start_time},
            "temporal_debug": temporal_debug,
        }

    assembly_started = time.time()
    for stage_clusters in clustered_results_by_stage:
        for cluster in stage_clusters:
            shot_ids = [
                shot['shot_id_int']
                for shot in cluster.get('shots', [])
                if 'shot_id_int' in shot
            ]
            if shot_ids:
                cluster['min_shot_id'] = min(shot_ids)
                cluster['max_shot_id'] = max(shot_ids)
                cluster['video_id'] = cluster['best_shot']['video_id']

    clusters_by_video = defaultdict(lambda: defaultdict(list))
    for stage_index, stage_clusters in enumerate(clustered_results_by_stage):
        for cluster in stage_clusters:
            if cluster.get('video_id'):
                clusters_by_video[cluster['video_id']][stage_index].append(cluster)

    valid_sequences = []
    if not ambiguous:
        for video_stages in clusters_by_video.values():
            if len(video_stages) < len(stages):
                continue

            def find_sequences(stage_index: int, current_sequence: list):
                if stage_index == len(stages):
                    valid_sequences.append(list(current_sequence))
                    return
                for next_cluster in video_stages.get(stage_index, []):
                    if (
                        not current_sequence
                        or next_cluster.get('min_shot_id', -1)
                        > current_sequence[-1].get('max_shot_id', -1)
                    ):
                        current_sequence.append(next_cluster)
                        find_sequences(stage_index + 1, current_sequence)
                        current_sequence.pop()

            find_sequences(0, [])
        if not valid_sequences:
            temporal_debug["used_relaxed_fallback"] = True
            for video_stages in clusters_by_video.values():
                if len(video_stages) < len(stages):
                    continue
                relaxed_sequence = []
                for stage_index in range(len(stages)):
                    stage_clusters = video_stages.get(stage_index, [])
                    if not stage_clusters:
                        relaxed_sequence = []
                        break
                    relaxed_sequence.append(
                        max(stage_clusters, key=lambda cluster: cluster.get('cluster_score', 0))
                    )
                if relaxed_sequence:
                    valid_sequences.append(relaxed_sequence)
    else:
        for video_stages in clusters_by_video.values():
            if len(video_stages) < len(stages):
                continue
            best_clusters = []
            for stage_index in range(len(stages)):
                stage_clusters = video_stages.get(stage_index, [])
                if not stage_clusters:
                    best_clusters = []
                    break
                best_clusters.append(
                    max(stage_clusters, key=lambda cluster: cluster.get('cluster_score', 0))
                )
            if best_clusters:
                valid_sequences.append(best_clusters)
    timings["sequence_assembly_s"] = time.time() - assembly_started
    if not valid_sequences:
        temporal_debug["failure_reason"] = "no_video_contains_all_stages"

    final_started = time.time()
    temporal_penalty_weight = 0.05
    processed_sequences = []
    for cluster_sequence in valid_sequences:
        average_score = (
            sum(cluster.get('cluster_score', 0) for cluster in cluster_sequence)
            / len(cluster_sequence)
        )
        total_gap = 0
        if len(cluster_sequence) > 1 and not ambiguous:
            for index in range(len(cluster_sequence) - 1):
                gap = (
                    cluster_sequence[index + 1].get('min_shot_id', 0)
                    - cluster_sequence[index].get('max_shot_id', 0)
                )
                if gap > 0:
                    total_gap += gap
                elif temporal_debug["used_relaxed_fallback"]:
                    total_gap += abs(gap)

        combined_score = average_score / (1 + total_gap * temporal_penalty_weight)
        if ambiguous:
            display_shots = [
                shot
                for cluster in cluster_sequence
                for shot in cluster.get('shots', [])
            ]
        else:
            display_shots = [cluster['best_shot'] for cluster in cluster_sequence]

        processed_sequences.append({
            "combined_score": combined_score,
            "average_rrf_score": average_score,
            "temporal_gap": total_gap,
            "used_relaxed_fallback": temporal_debug["used_relaxed_fallback"],
            "clusters": cluster_sequence,
            "shots": display_shots,
            "video_id": cluster_sequence[0].get('video_id', 'N/A'),
        })

    ranked_sequences = sorted(
        processed_sequences,
        key=lambda sequence: sequence['combined_score'],
        reverse=True,
    )
    total_results = len(ranked_sequences)
    start_index = (request_data.page - 1) * request_data.page_size
    page_results = ranked_sequences[start_index:start_index + request_data.page_size]
    timings["final_processing_s"] = time.time() - final_started
    timings["total_request_s"] = time.time() - start_time

    return {
        "results": page_results,
        "processed_queries": processed_queries,
        "is_temporal_search": not ambiguous,
        "is_ambiguous_search": ambiguous,
        "total_results": total_results,
        "timing_info": timings,
        "temporal_debug": temporal_debug,
        "spatial_interpretations": spatial_interpretations,
    }

@router.get("/similar")
async def similar_frames(
    frame_name: str,
    limit: int = 15,
    threshold: float = 0.95,
    intro_min_frame_gap: int = 100,
    intro_start_window_frames: int = 300,
):
    """Fetch and classify near-duplicate frames using BEiT3 similarity."""
    try:
        similar = await find_similar_frames(
            frame_name,
            limit=limit,
            threshold=threshold,
            intro_min_frame_gap=intro_min_frame_gap,
            intro_start_window_frames=intro_start_window_frames,
        )
        return {"results": similar}
    except Exception as e:
        print(f"Error finding similar frames for {frame_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search_semantic_asr")
async def search_semantic_asr_endpoint(request_data: SemanticAsrSearchRequest):
    start_time = time.time()
    timings = {}

    query_text = (request_data.query_text or "").strip()
    if not query_text:
        raise HTTPException(status_code=400, detail="Query text is required.")

    embedding = None
    if request_data.search_mode in {"embedding", "hybrid"}:
        embedding = await get_embedding(model_name="qwen", text=query_text)
        if not embedding:
            raise HTTPException(
                status_code=502,
                detail="Failed to generate embedding from Qwen worker (Check if Qwen worker is running on port 2006).",
            )
    if request_data.search_mode == "hybrid" and (
        request_data.embedding_weight + request_data.meilisearch_weight <= 0
    ):
        raise HTTPException(status_code=422, detail="At least one search weight must be greater than zero.")

    offset = (request_data.page - 1) * request_data.page_size
    results, total_results = await search_semantic_asr(
        query_text=query_text,
        query_vector=embedding,
        search_mode=request_data.search_mode,
        embedding_weight=request_data.embedding_weight,
        meilisearch_weight=request_data.meilisearch_weight,
        limit=request_data.page_size,
        offset=offset,
        video_ids=request_data.video_ids,
        candidate_frame_names=request_data.candidate_frame_names,
        sentence_level=request_data.sentence_level,
    )

    timings["total_request_s"] = time.time() - start_time
    return {
        "results": results,
        "total_results": total_results,
        "page": request_data.page,
        "page_size": request_data.page_size,
        "is_semantic_asr": True,
        "search_mode": request_data.search_mode,
        "timing_info": timings,
    }
