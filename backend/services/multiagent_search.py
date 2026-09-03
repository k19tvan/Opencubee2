from __future__ import annotations

import asyncio
import base64
import json
import re
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Optional

from PIL import Image, ImageDraw, ImageOps

from backend.core.config import ASR_SEARCH_FIELD, OCR_SEARCH_FIELD
from backend.services.media import resolve_keyframe_path
from backend.services.search import (
    fuse_results,
    search_all_models,
    search_semantic_asr,
    search_text_on_meilisearch_sync,
)

MODALITIES = ("text", "ocr", "semantic_asr")
CANVAS_FRAME_COUNT = 20  # Max 20 frames per grid canvas (5 cols x 4 rows)
MAX_SELECTED_PER_CANVAS = 3  # Strictly select maximum 3 candidates per canvas


def parse_json_response(content: Any) -> dict[str, Any]:
    """Extract one JSON object from an LLM response without trusting its formatting."""
    if isinstance(content, list):
        content = "".join(
            item.get("text", "") if isinstance(item, dict) else str(item)
            for item in content
        )
    text = str(content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    decoder = json.JSONDecoder()
    for offset, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[offset:])
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            continue
    raise ValueError("The model did not return a JSON object.")


def normalize_queries(payload: dict[str, Any]) -> dict[str, str]:
    queries = payload.get("queries", payload)
    if not isinstance(queries, dict):
        queries = {}
    return {
        modality: str(queries.get(modality, "") or "").strip()
        for modality in MODALITIES
    }


def deduplicate_frames(frames: list[dict[str, Any]], limit: Optional[int] = None) -> list[dict[str, Any]]:
    deduplicated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in frames:
        key = str(item.get("frame_name") or item.get("filepath") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        deduplicated.append(item)
        if limit is not None and len(deduplicated) >= limit:
            break
    return deduplicated


async def retrieve_by_modality(
    queries: dict[str, str],
    frame_limit: int,
    exclude_frames: Optional[set[str]] = None,
) -> dict[str, list[dict[str, Any]]]:
    """Retrieve candidates independently using FG-CLIP2 for text and Meilisearch for OCR / Semantic ASR."""
    exclude = exclude_frames or set()

    async def text_search() -> list[dict[str, Any]]:
        query = queries.get("text", "")
        if not query:
            return []
        # Uses fgclip2 for database retrieval
        results_by_model = await search_all_models(["fgclip2"], text=query, limit=frame_limit)
        results = results_by_model.get("fgclip2", [])
        filtered = [f for f in results if str(f.get("frame_name") or f.get("filepath")) not in exclude]
        return deduplicate_frames(filtered, frame_limit)

    async def ocr_search() -> list[dict[str, Any]]:
        query = queries.get("ocr", "")
        if not query:
            return []
        results = await asyncio.to_thread(search_text_on_meilisearch_sync, query, OCR_SEARCH_FIELD, frame_limit)
        filtered = [f for f in results if str(f.get("frame_name") or f.get("filepath")) not in exclude]
        return deduplicate_frames(filtered, frame_limit)

    async def semantic_asr_search() -> list[dict[str, Any]]:
        query = queries.get("semantic_asr", "")
        if not query:
            return []
        from backend.services.search import get_embedding
        qwen_vector = await get_embedding(model_name="qwen", text=query)
        scenes, _ = await search_semantic_asr(
            query_text=query,
            query_vector=qwen_vector,
            search_mode="hybrid" if qwen_vector else "meilisearch",
            embedding_weight=0.25,
            meilisearch_weight=0.75,
            limit=frame_limit,
        )
        frames = [shot for scene in scenes for shot in scene.get("shots", [])]
        filtered = [f for f in frames if str(f.get("frame_name") or f.get("filepath")) not in exclude]
        return deduplicate_frames(filtered, frame_limit)

    text, ocr, semantic_asr = await asyncio.gather(
        text_search(),
        ocr_search(),
        semantic_asr_search(),
    )
    return {"text": text, "ocr": ocr, "semantic_asr": semantic_asr}


async def make_canvas(
    frames: list[dict[str, Any]], 
    cols: int = 5,
    thumb_size: tuple[int, int] = (320, 180),
    save_path: Optional[Path | str] = None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """
    Create an in-memory grid canvas of up to 20 images (default 5 columns x 4 rows).
    Preserves aspect ratio with letterboxing/padding so no visuals are cropped.
    """
    if not frames:
        return None, []

    cell_width, cell_height = thumb_size
    label_height = 28
    
    inspectable: list[tuple[Image.Image, dict[str, Any]]] = []

    for frame in frames:
        path = await resolve_keyframe_path(frame)
        if path is None:
            continue
        try:
            with Image.open(path) as source:
                src_rgb = source.convert("RGB")
                # Pad to fit thumbnail box without cropping away keyframe details
                fitted = ImageOps.pad(src_rgb, (cell_width, cell_height), color=(15, 23, 42), centering=(0.5, 0.5))
                inspectable.append((fitted, frame))
        except Exception:
            continue

    if not inspectable:
        return None, []

    total_count = len(inspectable)
    columns = min(total_count, cols)
    rows = max(1, (total_count + columns - 1) // columns)
    
    canvas_w = columns * cell_width
    canvas_h = rows * (cell_height + label_height)
    canvas = Image.new("RGB", (canvas_w, canvas_h), "#0f172a")
    draw = ImageDraw.Draw(canvas)

    valid_frames: list[dict[str, Any]] = []

    for idx, (img, frame) in enumerate(inspectable):
        col_idx = idx % columns
        row_idx = idx // columns
        
        x = col_idx * cell_width
        y = row_idx * (cell_height + label_height)
        
        # Paste thumbnail
        canvas.paste(img, (x, y))
        
        # Draw prominent frame number badge
        number = idx + 1
        draw.rectangle((x, y, x + 40, y + 26), fill="#eab308")
        draw.text((x + 8, y + 5), str(number), fill="#0f172a")
        
        # Draw label bar underneath
        label = f"#{number} | {frame.get('video_id', '?')} | {frame.get('frame_id', '?')}"
        draw.rectangle((x, y + cell_height, x + cell_width, y + cell_height + label_height), fill="#1e293b")
        draw.text((x + 8, y + cell_height + 6), label[:35], fill="#f8fafc")
        
        valid_frames.append(frame)

    if save_path:
        try:
            sp = Path(save_path)
            sp.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(sp, format="JPEG", quality=85)
            print(f"  [DEBUG] Saved canvas ({total_count} frames, {columns}x{rows}) to: {sp}")
        except Exception as e:
            print(f"  [DEBUG] Failed to save canvas to {save_path}: {e}")

    output = BytesIO()
    canvas.save(output, format="JPEG", quality=85)
    return base64.b64encode(output.getvalue()).decode("ascii"), valid_frames


async def critic_filter_modality(
    *,
    llm: Any,
    human_message_factory: Callable[[list[dict[str, Any]]], Any],
    original_query: str,
    modality: str,
    modality_query: str,
    candidates: list[dict[str, Any]],
    debug: bool = True,
    iteration: int = 1,
) -> tuple[list[dict[str, Any]], str, list[str]]:
    """
    Stage 4 Critic:
    1. Splits candidate frames into grid canvases of up to 20 images each (e.g. 50 frames -> 20 + 20 + 10).
    2. Runs visual inspection on ALL canvases IN PARALLEL (asyncio.gather).
    3. Strictly selects a MAXIMUM OF 3 CANDIDATES per canvas.
    4. Creates a new summary canvas containing all selected candidates of this module.
    5. Evaluates the summary canvas to generate actionable diagnostic feedback for this module.
    """
    if not candidates:
        return [], "", []
    if llm is None:
        return candidates, "LLM not configured for visual criticism.", []

    warnings: list[str] = []

    # Step 1: Divide candidates into batches of 20 and build all canvases
    batches = [candidates[i:i + CANVAS_FRAME_COUNT] for i in range(0, len(candidates), CANVAS_FRAME_COUNT)]
    
    async def prepare_and_inspect_canvas(batch_idx: int, batch_frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
        canvas_save_path = None
        if debug:
            from backend.core.config import TEMP_UPLOAD_DIR
            canvas_save_path = TEMP_UPLOAD_DIR / f"critic_canvas_iter{iteration}_{modality}_batch{batch_idx}.jpg"

        encoded_canvas, inspectable = await make_canvas(batch_frames, cols=5, save_path=canvas_save_path)
        if not inspectable or encoded_canvas is None:
            return []

        prompt_select = (
            f"You are a strict Multi-Modal Visual Critic inspecting a {len(inspectable)}-frame grid canvas for modality '{modality}'.\n"
            f"Original user request: {original_query}\n"
            f"Current modality search query: {modality_query}\n"
            f"Inspect all {len(inspectable)} numbered frames (numbers 1 to {len(inspectable)}).\n"
            f"Select AT MOST {MAX_SELECTED_PER_CANVAS} best frames that visually match or directly relate to the request.\n"
            "If none match, return an empty array.\n"
            "Return JSON only:\n"
            '{"selected_frames": [{"number": 1, "relevance": 90, "reason": "visible match reason"}]}'
        )

        try:
            response = await asyncio.to_thread(
                llm.invoke,
                human_message_factory([
                    {"type": "text", "text": prompt_select},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded_canvas}"}},
                ]),
            )
            payload = parse_json_response(response.content)
            selected_items = payload.get("selected_frames", [])
            
            # Keep top candidates per canvas, max 3
            valid_canvas_selected: list[tuple[float, dict[str, Any]]] = []
            for item in selected_items:
                if isinstance(item, dict):
                    num = int(item.get("number", 0))
                    rel = float(item.get("relevance", 0.0))
                    reason = str(item.get("reason", ""))
                    if 1 <= num <= len(inspectable):
                        frame_data = {**inspectable[num - 1], "critic_score": round(rel, 1), "critic_reason": reason}
                        valid_canvas_selected.append((rel, frame_data))
            
            # Sort by relevance and take at most MAX_SELECTED_PER_CANVAS (3)
            valid_canvas_selected.sort(key=lambda x: -x[0])
            top_3 = [f for _, f in valid_canvas_selected[:MAX_SELECTED_PER_CANVAS]]

            if top_3:
                print(f"  [Critic Parallel Canvas {batch_idx}] Selected {len(top_3)} frames (max {MAX_SELECTED_PER_CANVAS}) from {len(inspectable)} images: {[f.get('frame_name') for f in top_3]}")
            return top_3
        except Exception as exc:
            warnings.append(f"Canvas inspection failed for {modality} batch {batch_idx}: {exc}")
            return []

    # Step 2: Read ALL canvases in parallel
    print(f"[Multi-Agent Critic] Inspecting {len(batches)} canvases in parallel for modality '{modality}'...")
    parallel_results = await asyncio.gather(
        *(prepare_and_inspect_canvas(idx + 1, batch) for idx, batch in enumerate(batches))
    )

    # Step 3: Merge all selected candidates across all canvases for this module
    merged_selected: list[dict[str, Any]] = []
    for canvas_frames in parallel_results:
        merged_selected.extend(canvas_frames)

    selected_frames = deduplicate_frames(merged_selected)
    print(f"[Multi-Agent Critic] '{modality}' gathered {len(selected_frames)} total candidates from {len(batches)} canvases")

    # Step 4: Create new summary canvas including all candidates of this module & generate feedback
    feedback_text = ""
    frames_for_feedback = selected_frames if selected_frames else candidates[:10]
    fb_save_path = None
    if debug:
        from backend.core.config import TEMP_UPLOAD_DIR
        fb_save_path = TEMP_UPLOAD_DIR / f"critic_summary_canvas_iter{iteration}_{modality}.jpg"

    encoded_feedback_canvas, inspectable_fb = await make_canvas(frames_for_feedback, cols=5, save_path=fb_save_path)

    feedback_prompt = (
        f"You are evaluating the visual retrieval performance for modality '{modality}'.\n"
        f"Target User Request: {original_query}\n"
        f"Modality Search Query: {modality_query}\n"
        f"Total selected relevant frames found: {len(selected_frames)} out of {len(candidates)} candidates.\n"
        "Analyze the candidate frames in the canvas. Explain why the current query succeeded or failed to find exact matches. "
        "Provide concise, diagnostic feedback and concrete recommendations on how the query planner should refine the query for this modality in the next loop.\n"
        "Return JSON only:\n"
        '{"feedback": "<diagnostic feedback and refinement advice>"}'
    )

    try:
        content_parts = [{"type": "text", "text": feedback_prompt}]
        if encoded_feedback_canvas:
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{encoded_feedback_canvas}"},
            })
        resp = await asyncio.to_thread(llm.invoke, human_message_factory(content_parts))
        fb_payload = parse_json_response(resp.content)
        feedback_text = str(fb_payload.get("feedback", "")).strip()
    except Exception as exc:
        feedback_text = f"Modality {modality} retrieved {len(selected_frames)} matching frames."
        warnings.append(f"Feedback generation failed for {modality}: {exc}")

    return selected_frames, feedback_text, warnings
