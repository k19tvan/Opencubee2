from __future__ import annotations

import asyncio
import base64
import json
import re
from io import BytesIO
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
CANVAS_FRAME_COUNT = 3  # Maximum 3 images per candidate canvas as specified


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
    for frame in frames:
        key = str(frame.get("frame_name") or frame.get("filepath") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        normalized = dict(frame)
        normalized.setdefault("url", f"/keyframes/{key}")
        deduplicated.append(normalized)
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
        # Uses fgclip2 for database retrieval as requested
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


async def make_canvas(frames: list[dict[str, Any]], max_per_row: int = 3) -> tuple[str | None, list[dict[str, Any]]]:
    """Create an in-memory, numbered horizontal canvas (up to 3 images per row) and retain only inspectable images."""
    if not frames:
        return None, []

    cell_width, image_height, label_height = 320, 180, 32
    columns = min(len(frames), max_per_row)
    rows = max(1, (len(frames) + columns - 1) // columns)
    canvas = Image.new("RGB", (columns * cell_width, rows * (image_height + label_height)), "#0f172a")
    draw = ImageDraw.Draw(canvas)
    inspectable: list[dict[str, Any]] = []

    for frame in frames:
        path = await resolve_keyframe_path(frame)
        if path is None:
            continue
        try:
            with Image.open(path) as source:
                image = ImageOps.fit(source.convert("RGB"), (cell_width, image_height), Image.Resampling.LANCZOS)
        except Exception:
            continue
        number = len(inspectable) + 1
        x = ((number - 1) % columns) * cell_width
        y = ((number - 1) // columns) * (image_height + label_height)
        canvas.paste(image, (x, y))
        draw.rectangle((x, y, x + 36, y + 26), fill="#eab308")
        draw.text((x + 10, y + 6), str(number), fill="#0f172a")
        label = f"{frame.get('video_id', '?')} | {frame.get('frame_id', '?')}"
        draw.text((x + 8, y + image_height + 8), label[:40], fill="#f8fafc")
        inspectable.append(frame)

    if not inspectable:
        return None, []
    output = BytesIO()
    canvas.save(output, format="JPEG", quality=85)
    return base64.b64encode(output.getvalue()).decode("ascii"), inspectable


async def critic_filter_modality(
    *,
    llm: Any,
    human_message_factory: Callable[[list[dict[str, Any]]], Any],
    original_query: str,
    modality: str,
    modality_query: str,
    candidates: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str, list[str]]:
    """
    Stage 4 Critic:
    1. Splits candidate frames into small canvases of max 3 images.
    2. Runs visual inspection to select suitable frames independently per canvas.
    3. Merges all selected frames into a new summary canvas to generate actionable modality feedback.
    """
    if not candidates:
        return [], "", []
    if llm is None:
        return candidates, "LLM not configured for visual criticism.", []

    stage1_selected: list[tuple[float, dict[str, Any]]] = []
    warnings: list[str] = []

    # Step 4a: Process batches of maximum 3 frames per canvas
    for start in range(0, len(candidates), CANVAS_FRAME_COUNT):
        batch = candidates[start:start + CANVAS_FRAME_COUNT]
        encoded_canvas, inspectable = await make_canvas(batch, max_per_row=3)
        if not inspectable or encoded_canvas is None:
            continue

        prompt_select = (
            f"You are a strict Visual Critic inspecting a {len(inspectable)}-frame canvas for the modality '{modality}'.\n"
            f"Original user request: {original_query}\n"
            f"Current modality search query: {modality_query}\n"
            "Inspect the numbered frames. Select ONLY frames that visually match or directly support the request.\n"
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
            for item in selected_items:
                if isinstance(item, dict):
                    num = int(item.get("number", 0))
                    rel = float(item.get("relevance", 0.0))
                    reason = str(item.get("reason", ""))
                    if 1 <= num <= len(inspectable):
                        frame_data = {**inspectable[num - 1], "critic_score": round(rel, 1), "critic_reason": reason}
                        stage1_selected.append((rel, frame_data))
        except Exception as exc:
            warnings.append(f"Canvas selection failed for {modality} batch [{start}:{start+3}]: {exc}")

    # Deduplicate selected frames
    stage1_selected.sort(key=lambda x: -x[0])
    selected_frames = deduplicate_frames([f for _, f in stage1_selected])

    # Step 4b: Build feedback from selected frames or overall candidates
    feedback_text = ""
    frames_for_feedback = selected_frames[:6] if selected_frames else candidates[:3]
    encoded_feedback_canvas, inspectable_fb = await make_canvas(frames_for_feedback, max_per_row=3)

    feedback_prompt = (
        f"You are evaluating the visual retrieval performance for modality '{modality}'.\n"
        f"Target User Request: {original_query}\n"
        f"Modality Search Query: {modality_query}\n"
        f"Total selected relevant frames found: {len(selected_frames)} out of {len(candidates)} candidates.\n"
        "Analyze why the current query succeeded or failed to find exact matches. Provide concise, diagnostic feedback "
        "and concrete recommendations on how the query planner should refine the query for this modality in the next loop.\n"
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
