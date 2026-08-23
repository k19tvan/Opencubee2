from __future__ import annotations

import asyncio
import base64
import json
import re
from io import BytesIO
from typing import Any, Callable

from PIL import Image, ImageDraw, ImageOps

from backend.core.config import ASR_SEARCH_FIELD, OCR_SEARCH_FIELD
from backend.services.media import resolve_keyframe_path
from backend.services.search import (
    fuse_results,
    search_all_models,
    search_semantic_asr,
    search_text_on_meilisearch_sync,
)


MODALITIES = ("text", "ocr", "asr", "semantic_asr")
CANVAS_FRAME_COUNT = 20


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


def _deduplicate(frames: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
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
        if len(deduplicated) >= limit:
            break
    return deduplicated


async def retrieve_by_modality(queries: dict[str, str], frame_limit: int) -> dict[str, list[dict[str, Any]]]:
    """Retrieve candidates independently so a weak modality cannot suppress another."""
    async def text_search() -> list[dict[str, Any]]:
        query = queries["text"]
        if not query:
            return []
        results = await search_all_models(["beit3", "bge"], text=query, limit=frame_limit)
        return _deduplicate(fuse_results(results, {"beit3": 0.5, "bge": 0.5}), frame_limit)

    async def lexical_search(modality: str, field: str) -> list[dict[str, Any]]:
        query = queries[modality]
        if not query:
            return []
        results = await asyncio.to_thread(search_text_on_meilisearch_sync, query, field, frame_limit)
        return _deduplicate(results, frame_limit)

    async def semantic_search() -> list[dict[str, Any]]:
        query = queries["semantic_asr"]
        if not query:
            return []
        scenes, _ = await search_semantic_asr(
            query_text=query,
            query_vector=None,
            search_mode="meilisearch",
            limit=frame_limit,
        )
        frames = [shot for scene in scenes for shot in scene.get("shots", [])]
        return _deduplicate(frames, frame_limit)

    text, ocr, asr, semantic_asr = await asyncio.gather(
        text_search(),
        lexical_search("ocr", OCR_SEARCH_FIELD),
        lexical_search("asr", ASR_SEARCH_FIELD),
        semantic_search(),
    )
    return {"text": text, "ocr": ocr, "asr": asr, "semantic_asr": semantic_asr}


async def make_canvas(frames: list[dict[str, Any]]) -> tuple[str | None, list[dict[str, Any]]]:
    """Create an in-memory, numbered 5×4 canvas and retain only images the VLM can inspect."""
    cell_width, image_height, label_height = 240, 135, 28
    columns = 5
    rows = max(1, (len(frames) + columns - 1) // columns)
    canvas = Image.new("RGB", (columns * cell_width, rows * (image_height + label_height)), "#111827")
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
        draw.rectangle((x, y, x + 34, y + 22), fill="#facc15")
        draw.text((x + 8, y + 5), str(number), fill="#111827")
        label = f"{frame.get('video_id', '?')} · {frame.get('frame_id', '?')}"
        draw.text((x + 6, y + image_height + 7), label[:38], fill="#f9fafb")
        inspectable.append(frame)

    if not inspectable:
        return None, []
    output = BytesIO()
    canvas.save(output, format="JPEG", quality=82)
    return base64.b64encode(output.getvalue()).decode("ascii"), inspectable


async def critic_filter(
    *,
    llm: Any,
    human_message_factory: Callable[[list[dict[str, Any]]], Any],
    original_query: str,
    modality: str,
    modality_query: str,
    candidates: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Ask the VLM to score every 20-frame canvas, with deterministic fallbacks."""
    if not candidates:
        return [], []
    if llm is None:
        return candidates, ["Multi-agent VLM is not configured; showing retrieved candidates without critic filtering."]

    ranked_frames: list[tuple[float, int, dict[str, Any]]] = []
    warnings: list[str] = []
    sequence = 0
    for start in range(0, len(candidates), CANVAS_FRAME_COUNT):
        encoded_canvas, inspectable = await make_canvas(candidates[start:start + CANVAS_FRAME_COUNT])
        if not inspectable:
            continue
        if encoded_canvas is None:
            warnings.append(f"Could not build the {modality} canvas {start // CANVAS_FRAME_COUNT + 1}.")
            continue
        prompt = (
            "You are a strict visual critic for video retrieval. Inspect the numbered canvas and choose only frames "
            "that satisfy the original request. A frame may be selected only when the visible image supports it; "
            "do not infer unseen facts. Score every selected frame on an absolute 0-100 relevance scale, where 100 is "
            "an exact visible match. Return JSON only in this shape: "
            "{\"selected_frames\":[{\"number\":1,\"relevance\":95}],\"reason\":\"short\"}. "
            "List selected_frames from most relevant to least relevant.\n"
            f"Original request: {original_query}\n"
            f"Modality: {modality}\n"
            f"Generated modality query: {modality_query}\n"
            f"Canvas has {len(inspectable)} numbered frames."
        )
        try:
            response = await asyncio.to_thread(
                llm.invoke,
                human_message_factory([
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded_canvas}"}},
                ]),
            )
            payload = parse_json_response(response.content)
            selected_frames = payload.get("selected_frames", [])
            if isinstance(selected_frames, list) and selected_frames:
                for item in selected_frames:
                    if not isinstance(item, dict):
                        continue
                    try:
                        number = int(item.get("number"))
                    except (TypeError, ValueError):
                        continue
                    try:
                        relevance = max(0.0, min(100.0, float(item.get("relevance", 0))))
                    except (TypeError, ValueError):
                        relevance = 0.0
                    if isinstance(number, int) and 1 <= number <= len(inspectable):
                        ranked_frames.append((relevance, sequence, inspectable[number - 1]))
                        sequence += 1
            else:
                # Backward-compatible parsing for a model that follows the older response shape.
                numbers = payload.get("selected_frame_numbers", [])
                if not isinstance(numbers, list):
                    numbers = []
                for rank, number in enumerate(numbers):
                    if isinstance(number, int) and 1 <= number <= len(inspectable):
                        ranked_frames.append((100.0 - rank, sequence, inspectable[number - 1]))
                        sequence += 1
        except Exception as exc:
            warnings.append(f"Critic failed for {modality} canvas {start // CANVAS_FRAME_COUNT + 1}: {exc}")

    # Absolute critic scores make the order meaningful even when candidates came from different canvases.
    ranked_frames.sort(key=lambda item: (-item[0], item[1]))
    selected = [
        {**frame, "critic_score": round(score, 1)}
        for score, _, frame in ranked_frames
    ]
    # If the critic found nothing, preserve its verdict rather than silently claiming a match.
    return _deduplicate(selected, len(candidates)), warnings
