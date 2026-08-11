from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, Field

from backend.api.gemini_tool import GeminiToolPool
from backend.core.config import MAX_FRAME_LIMIT, MODEL_CONFIGS
from backend.services.media import resolve_keyframe_path_sync
from backend.services.search import (
    _combine_and_rerank_results,
    attach_similarity_labels,
    fuse_results,
    search_all_models,
    search_ocr_on_meilisearch_async,
)


router = APIRouter(prefix="/agent", tags=["agent"])

MAX_AGENT_ROUNDS = 3
MAX_AGENT_FRAMES = 30
MAX_RESEARCH_OPTIONS = 5


class AgentMessageRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    use_research: bool = False
    models: list[str] = Field(default_factory=lambda: ["beit3"])
    model_weights: dict[str, float] = Field(default_factory=lambda: {"beit3": 1.0})
    top_k: int = Field(default=20, ge=1, le=MAX_AGENT_FRAMES)


class AgentOptionRequest(BaseModel):
    session_id: str
    option_index: Optional[int] = None
    models: list[str] = Field(default_factory=lambda: ["beit3"])
    model_weights: dict[str, float] = Field(default_factory=lambda: {"beit3": 1.0})
    top_k: int = Field(default=20, ge=1, le=MAX_AGENT_FRAMES)


class AgentFeedbackRequest(BaseModel):
    session_id: str
    feedback: str = ""
    positive_frame_names: list[str] = Field(default_factory=list)
    negative_frame_names: list[str] = Field(default_factory=list)
    models: list[str] = Field(default_factory=lambda: ["beit3"])
    model_weights: dict[str, float] = Field(default_factory=lambda: {"beit3": 1.0})
    top_k: int = Field(default=20, ge=1, le=MAX_AGENT_FRAMES)


@dataclass
class AgentSession:
    session_id: str
    original_query: str = ""
    options: list[dict[str, str]] = field(default_factory=list)
    selected_option: Optional[dict[str, str]] = None
    queries: dict[str, str] = field(default_factory=dict)
    frames: list[dict[str, Any]] = field(default_factory=list)
    # Explicit critic selections survive later rounds and can seed composed
    # image + text retrieval in the next round.
    kept_frames: list[dict[str, Any]] = field(default_factory=list)
    rounds: list[dict[str, Any]] = field(default_factory=list)
    positive_frame_names: list[str] = field(default_factory=list)
    negative_frame_names: list[str] = field(default_factory=list)
    feedback: str = ""
    top_k: int = MAX_AGENT_FRAMES
    canvas_image: str = ""
    events: list[dict[str, Any]] = field(default_factory=list)
    event_seq: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_sessions: dict[str, AgentSession] = {}
_sessions_guard = asyncio.Lock()
_agent_llm: Optional[ChatOpenAI] = None
_gemini_pool: Optional[GeminiToolPool] = None


def _reset_run_events(session: AgentSession):
    session.events = []
    session.event_seq = 0


def _log_step(
    session: AgentSession,
    step: str,
    message: str,
    status: str = "running",
    **details: Any,
) -> dict[str, Any]:
    session.event_seq += 1
    event = {
        "id": session.event_seq,
        "timestamp": time.time(),
        "step": step,
        "status": status,
        "message": message,
        "details": details,
    }
    session.events.append(event)
    print(
        f"[agent:{session.session_id[:8]}] [{status.upper()}] {step}: {message}",
        flush=True,
    )
    return event


async def shutdown_agent_runtime():
    global _gemini_pool, _agent_llm
    pool = _gemini_pool
    _gemini_pool = None
    _agent_llm = None
    if pool is not None:
        await asyncio.to_thread(pool.close)
    async with _sessions_guard:
        _sessions.clear()


def _get_agent_llm() -> ChatOpenAI:
    global _agent_llm
    if _agent_llm is None:
        _agent_llm = ChatOpenAI(
            model=os.getenv("AGENT_MODEL", "qwen35_9b"),
            base_url=os.getenv("AGENT_MODEL_BASE_URL", "http://192.168.20.150:2308/v1"),
            api_key=os.getenv("AGENT_MODEL_API_KEY", "None"),
            temperature=0,
            max_tokens=2048,
        )
    return _agent_llm


def _get_gemini_pool() -> GeminiToolPool:
    global _gemini_pool
    if _gemini_pool is None:
        default_root = os.path.join(os.path.dirname(__file__), "gemini_sessions")
        configured_dirs = [
            path.strip()
            for path in os.getenv("GEMINI_SESSION_DIRS", "").split(",")
            if path.strip()
        ]
        _gemini_pool = GeminiToolPool(
            size=int(os.getenv("GEMINI_SESSION_POOL_SIZE", "5")),
            session_root=os.getenv("GEMINI_SESSION_ROOT", default_root),
            headless=os.getenv("GEMINI_HEADLESS", "true").lower() != "false",
            session_dirs=configured_dirs,
            timeout=int(os.getenv("GEMINI_TIMEOUT_SECONDS", "90")),
        )
    return _gemini_pool


async def _get_or_create_session(session_id: Optional[str]) -> AgentSession:
    async with _sessions_guard:
        if session_id and session_id in _sessions:
            return _sessions[session_id]
        new_id = session_id or uuid.uuid4().hex
        session = AgentSession(session_id=new_id)
        _sessions[new_id] = session
        return session


def _extract_json(content: Any) -> dict[str, Any]:
    if isinstance(content, dict):
        return content
    if isinstance(content, list):
        content = "".join(
            str(part.get("text", "")) if isinstance(part, dict) else str(part)
            for part in content
        )
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(content).strip(), flags=re.I | re.S)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        decoder = json.JSONDecoder()
        for match in re.finditer(r"\{", text):
            try:
                value, _ = decoder.raw_decode(text[match.start():])
                if isinstance(value, dict):
                    return value
            except json.JSONDecodeError:
                continue
    raise ValueError("The agent model did not return valid JSON.")


async def _invoke_json(messages: list[Any]) -> dict[str, Any]:
    response = await _get_agent_llm().ainvoke(messages)
    return _extract_json(response.content)


def _clean_query(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().strip('"')


def _normalize_queries(payload: dict[str, Any]) -> dict[str, str]:
    return {
        "text_query": _clean_query(payload.get("text_query")),
        "ocr_query": _clean_query(payload.get("ocr_query")),
        "asr_query": _clean_query(payload.get("asr_query")),
    }


def _query_fingerprint(queries: dict[str, str]) -> tuple[str, str, str]:
    """Ignore casing and punctuation-only edits when comparing retrieval plans."""
    return tuple(
        re.sub(r"[^\w]+", " ", queries.get(key, "").casefold()).strip()
        for key in ("text_query", "ocr_query", "asr_query")
    )


def _queries_changed(previous: dict[str, str], candidate: dict[str, str]) -> bool:
    return _query_fingerprint(previous) != _query_fingerprint(candidate)


def _query_was_attempted(session: AgentSession, candidate: dict[str, str]) -> bool:
    candidate_fingerprint = _query_fingerprint(candidate)
    return any(
        _query_fingerprint(item.get("queries", {})) == candidate_fingerprint
        for item in session.rounds
    )


async def research_node(session: AgentSession) -> dict[str, Any]:
    _log_step(
        session,
        "research",
        "Sending the original request to Gemini research.",
        original_query=session.original_query,
    )
    research_prompt = (
        "Research this Vietnamese video-retrieval request. Explain ambiguous named entities, "
        "places, events, people, visual attributes, and exact words that may appear in frames. "
        f"Return useful factual context for disambiguation. User request: {session.original_query}"
    )
    raw_research = await _get_gemini_pool().ask(research_prompt)
    result = await _invoke_json([
        SystemMessage(content=(
            "You turn web research into disambiguation choices for a video retrieval agent. "
            "Return JSON only with keys summary and options. options is an array of at most five "
            "objects with string keys option and explain. Do not invent facts. Use the user's language."
        )),
        HumanMessage(content=(
            f"Original query:\n{session.original_query}\n\nGemini research:\n{raw_research}"
        )),
    ])
    options = []
    for item in result.get("options", [])[:MAX_RESEARCH_OPTIONS]:
        if not isinstance(item, dict) or not _clean_query(item.get("option")):
            continue
        options.append({
            "option": _clean_query(item.get("option")),
            "explain": _clean_query(item.get("explain")),
        })
    session.options = options
    summary = _clean_query(result.get("summary"))
    _log_step(
        session,
        "research",
        f"Gemini research produced {len(options)} disambiguation option(s).",
        "completed",
        option_count=len(options),
        summary=summary,
        options=options,
    )
    return {"summary": summary, "options": options}


async def query_node(session: AgentSession) -> dict[str, str]:
    choice_context = (
        json.dumps(session.selected_option, ensure_ascii=False)
        if session.selected_option else "The user kept the original meaning and selected no research option."
    )
    _log_step(
        session,
        "query_planner",
        "Generating Text, OCR, and ASR retrieval queries.",
        original_query=session.original_query,
        research_context=session.selected_option,
    )
    result = await _invoke_json([
        SystemMessage(content=(
            "You are a multimodal video retrieval query planner. Return JSON only with string keys "
            "text_query, ocr_query, asr_query, explanation. text_query MUST be a concise English visual "
            "description. OCR and ASR are literal strings likely to truly appear on screen or be spoken; "
            "they may be Vietnamese or English and must be empty when the evidence is uncertain. Never "
            "translate a proper on-screen/spoken phrase merely to make it English. Produce one stage only."
        )),
        HumanMessage(content=(
            f"Original query: {session.original_query}\nSelected research context: {choice_context}"
        )),
    ])
    session.queries = _normalize_queries(result)
    _log_step(
        session,
        "query_planner",
        "Modality queries are ready.",
        "completed",
        queries=session.queries,
        explanation=_clean_query(result.get("explanation")),
    )
    return session.queries


def _valid_models(models: list[str]) -> list[str]:
    selected = [model for model in models if model in MODEL_CONFIGS]
    return selected or ["beit3"]


def _deduplicate_frames(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the first instance of every stable keyframe name."""
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for frame in frames:
        name = str(frame.get("frame_name") or "")
        if not name or name in seen:
            continue
        seen.add(name)
        unique.append(frame)
    return unique


async def compose_image_retrieval_tool(
    session: AgentSession,
    reference_frame_name: str,
    text_instruction: str,
    top_k: int,
) -> list[dict[str, Any]]:
    """BGE-VL retrieval from a kept frame composed with a text instruction."""
    _log_step(
        session,
        "compose_image_retrieval",
        "Composing a kept frame with the current visual query.",
        reference_frame_name=reference_frame_name,
        text_instruction=text_instruction,
        model="bge",
    )
    try:
        by_model = await search_all_models(
            ["bge"],
            image_name=f"_frame_:{reference_frame_name}",
            image_text=text_instruction,
            limit=MAX_FRAME_LIMIT,
        )
        results = fuse_results(by_model, {"bge": 1.0})
        results = [item for item in results if item.get("frame_name") not in set(session.negative_frame_names)]
        for item in results:
            item["retrieval_source"] = "composed_image"
        attach_similarity_labels(results)
        _log_step(
            session,
            "compose_image_retrieval",
            f"Composed-image retrieval returned {len(results)} candidate frame(s).",
            "completed",
            reference_frame_name=reference_frame_name,
            candidate_count=len(results),
        )
        return results[:max(1, min(top_k, MAX_AGENT_FRAMES))]
    except Exception as exc:
        # The ordinary text retrieval remains useful when the image worker is down.
        _log_step(session, "compose_image_retrieval", f"Composed-image retrieval was skipped: {exc}", "failed")
        return []


async def image_search_tool(session: AgentSession, query: str) -> list[str]:
    """Agent-accessible web image search, used as a fallback/reference tool."""
    query = _clean_query(query)
    if not query:
        return []
    _log_step(session, "image_search", "Searching for visual reference images.", query=query)
    try:
        # Keep a single image-search implementation and its Tavily configuration.
        from backend.api.search import get_google_images

        image_urls = await asyncio.to_thread(get_google_images, query, 5)
        image_urls = [url for url in image_urls if isinstance(url, str) and url]
        _log_step(
            session,
            "image_search",
            f"Image search found {len(image_urls)} visual reference(s).",
            "completed",
            query=query,
            image_urls=image_urls,
        )
        return image_urls
    except Exception as exc:
        _log_step(session, "image_search", f"Image search was skipped: {exc}", "failed", query=query)
        return []


async def search_node(
    session: AgentSession,
    models: list[str],
    model_weights: dict[str, float],
    top_k: int = MAX_AGENT_FRAMES,
) -> list[dict[str, Any]]:
    """Run the same single-stage text/filter behavior as POST /search."""
    text_query = session.queries.get("text_query", "")
    ocr_query = session.queries.get("ocr_query", "")
    asr_query = session.queries.get("asr_query", "")
    has_vector_query = bool(text_query)
    has_filter_query = bool(ocr_query or asr_query)
    selected_models = _valid_models(models)
    weights = {
        model: float(model_weights.get(model, 1.0))
        for model in selected_models
    }

    async def vector_stage():
        if not has_vector_query:
            return []
        by_model = await search_all_models(
            selected_models,
            text=text_query,
            limit=MAX_FRAME_LIMIT,
        )
        return fuse_results(by_model, weights)

    async def filter_stage():
        if not has_filter_query:
            return []
        return await search_ocr_on_meilisearch_async(
            keyword=ocr_query or asr_query,
            limit=5000,
        )

    vector_results, filter_results = await asyncio.gather(vector_stage(), filter_stage())
    if has_vector_query and has_filter_query:
        results = _combine_and_rerank_results(vector_results, filter_results)
    elif has_vector_query:
        results = vector_results
    else:
        results = filter_results
        for result in results:
            result["score"] = result.get("score", 0.0)
            result["url"] = f"/keyframes/{result['frame_name']}"
        results.sort(key=lambda item: item.get("score", 0.0), reverse=True)

    rejected = set(session.negative_frame_names)
    results = [item for item in results if item.get("frame_name") not in rejected]
    attach_similarity_labels(results)

    # From round two onwards, use the critic's strongest retained frame as an
    # image anchor.  The composed result is placed first because it has both
    # a visual reference and the refined textual instruction; text results
    # still fill any remaining slots.
    if session.kept_frames:
        reference = session.kept_frames[-1]
        composed_results = await compose_image_retrieval_tool(
            session,
            str(reference.get("frame_name") or ""),
            text_query,
            top_k,
        )
        results = _deduplicate_frames(composed_results + results)
    elif not results:
        # This tool is deliberately a non-blocking fallback. Its references
        # are exposed in the agent trace for a user to inspect, while a failed
        # external image provider never turns a no-result search into an error.
        await image_search_tool(session, text_query or session.original_query)

    previous = {item.get("frame_name"): item for item in session.frames}
    positives = [previous[name] for name in session.positive_frame_names if name in previous]
    seen = {item.get("frame_name") for item in positives}
    merged = positives + [item for item in results if item.get("frame_name") not in seen]
    return merged[:max(1, min(top_k, MAX_AGENT_FRAMES))]


def canvas_node(frames: list[dict[str, Any]]) -> str:
    """Build the internal white contact sheet consumed by the vision critic."""
    frame_count = max(1, min(len(frames), MAX_AGENT_FRAMES))
    columns = min(5, frame_count)
    rows = max(1, (frame_count + columns - 1) // columns)
    cell_width, cell_height = 320, 200
    label_height = 28
    canvas = Image.new("RGB", (columns * cell_width, rows * cell_height), "white")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()

    for index, frame in enumerate(frames[:frame_count]):
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        path = resolve_keyframe_path_sync(frame.get("frame_name", ""))
        if path:
            try:
                with Image.open(path) as source:
                    image = source.convert("RGB")
                    image.thumbnail((cell_width - 8, cell_height - label_height - 8))
                    image_x = x + (cell_width - image.width) // 2
                    image_y = y + 4 + (cell_height - label_height - 8 - image.height) // 2
                    canvas.paste(image, (image_x, image_y))
            except Exception:
                pass
        draw.rectangle((x, y, x + cell_width - 1, y + cell_height - 1), outline="#9ca3af", width=2)
        label = f"#{index + 1}  {frame.get('frame_name', 'missing')}"
        draw.rectangle((x + 2, y + cell_height - label_height, x + cell_width - 2, y + cell_height - 2), fill="white")
        draw.text((x + 8, y + cell_height - label_height + 7), label, fill="black", font=font)

    output = io.BytesIO()
    canvas.save(output, format="JPEG", quality=88, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


async def critic_node(
    session: AgentSession,
    frames: list[dict[str, Any]],
    canvas_base64: str,
    round_number: int,
) -> dict[str, Any]:
    frame_manifest = "\n".join(
        f"#{index + 1}: {frame.get('frame_name')} (retrieval score={frame.get('score', 0):.4f})"
        for index, frame in enumerate(frames)
    )
    attempted_queries = [item.get("queries", {}) for item in session.rounds]
    payload = await _invoke_json([
        SystemMessage(content=(
            "You are the visual critic of a video retrieval agent. Inspect the numbered contact sheet "
            "against the ORIGINAL request, not merely the generated query. Return JSON only with keys: "
            "satisfied (boolean), analysis (short string), selected_frame_numbers (array containing only frames "
            "that plausibly satisfy the request), ranked_frame_numbers (an array containing EVERY candidate frame "
            "number exactly once), text_query, ocr_query, asr_query. ranked_frame_numbers MUST be ordered against "
            "the ORIGINAL request: exact matches first, then partial matches by how many original constraints they "
            "satisfy, and retrieval score only as a tie-breaker. If the original request describes events or actions "
            "in a sequence, order matching frames by that described event sequence before relevance within each "
            f"phase. Both arrays use unique 1-based integers and have maximum {session.top_k} items. If results "
            "are weak, the returned queries are the NEXT retrieval plan and MUST materially differ from the current "
            "queries. Change the visual wording, attributes, context, or safely relax uncertain OCR/ASR constraints. "
            "Never repeat a query already attempted. text_query must remain English; OCR/ASR must be literal likely "
            "visible/spoken strings and may be Vietnamese or English. Empty uncertain OCR/ASR. Respect user "
            "feedback and positive/negative frame labels. On round 3, rank the best available frames even if "
            "none fully satisfies the request."
        )),
        HumanMessage(content=[
            {
                "type": "text",
                "text": (
                    f"Original query: {session.original_query}\n"
                    f"Current queries: {json.dumps(session.queries, ensure_ascii=False)}\n"
                    f"Previously attempted queries: {json.dumps(attempted_queries, ensure_ascii=False)}\n"
                    f"Feedback: {session.feedback or 'None'}\n"
                    f"Positive frames: {session.positive_frame_names or 'None'}\n"
                    f"Negative frames: {session.negative_frame_names or 'None'}\n"
                    f"Round: {round_number}/{MAX_AGENT_ROUNDS}\nFrames:\n{frame_manifest}"
                ),
            },
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{canvas_base64}"},
            },
        ]),
    ])
    def parse_frame_numbers(values: Any) -> list[int]:
        numbers = []
        if not isinstance(values, list):
            return numbers
        for value in values:
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            if 1 <= number <= len(frames) and number not in numbers:
                numbers.append(number)
        return numbers

    selected_numbers = parse_frame_numbers(payload.get("selected_frame_numbers"))
    ranked_numbers = parse_frame_numbers(payload.get("ranked_frame_numbers"))
    # Preserve useful ordering from older/model-noncompliant responses, then
    # deterministically complete the ranking so every displayed frame has a rank.
    if not ranked_numbers:
        ranked_numbers = list(selected_numbers)
    ranked_numbers.extend(
        number for number in range(1, len(frames) + 1)
        if number not in ranked_numbers
    )
    result = {
        "satisfied": bool(payload.get("satisfied")),
        "analysis": _clean_query(payload.get("analysis")),
        "selected_frame_numbers": selected_numbers[:MAX_AGENT_FRAMES],
        "ranked_frame_numbers": ranked_numbers[:MAX_AGENT_FRAMES],
        "refined_queries": _normalize_queries(payload),
    }
    return result


async def refine_node(
    session: AgentSession,
    critique: dict[str, Any],
    round_number: int,
) -> dict[str, str]:
    previous = dict(session.queries)
    refined = _normalize_queries(critique.get("refined_queries") or {})
    strategy = "critic proposal"

    if (
        not any(refined.values())
        or not _queries_changed(previous, refined)
        or _query_was_attempted(session, refined)
    ):
        _log_step(
            session,
            "refine",
            "The critic did not provide a materially different query; requesting an alternative retrieval strategy.",
            previous_queries=previous,
            critic_queries=refined,
            critic_analysis=critique.get("analysis", ""),
            next_round=round_number + 1,
        )
        attempted_queries = [item.get("queries", {}) for item in session.rounds] + [previous]
        response = await _invoke_json([
            SystemMessage(content=(
                "You are the fallback query strategist for a video retrieval system. Return JSON only with "
                "string keys text_query, ocr_query, asr_query, explanation. Create a materially different plan "
                "for the next search round. Do not merely rephrase punctuation or word order and do not repeat "
                "an attempted query. Change the visual retrieval angle by using missing observable attributes, "
                "a broader scene/context description, or safer synonyms. Remove uncertain OCR/ASR terms when "
                "they may be over-constraining retrieval. text_query must be English. OCR/ASR must be literal "
                "likely visible/spoken strings in their real language, otherwise empty."
            )),
            HumanMessage(content=(
                f"Original request: {session.original_query}\n"
                f"Failed/weak query: {json.dumps(previous, ensure_ascii=False)}\n"
                f"Critic observation: {critique.get('analysis') or 'No candidate frames were returned.'}\n"
                f"Queries already attempted: {json.dumps(attempted_queries, ensure_ascii=False)}\n"
                f"Prepare search round {round_number + 1}/{MAX_AGENT_ROUNDS}."
            )),
        ])
        refined = _normalize_queries(response)
        strategy = _clean_query(response.get("explanation")) or "fallback query strategist"

    if (
        not any(refined.values())
        or not _queries_changed(previous, refined)
        or _query_was_attempted(session, refined)
    ):
        # Last-resort deterministic relaxation guarantees that another round never
        # repeats the exact same retrieval request, even if the LLM ignores instructions.
        refined = dict(previous)
        if refined.get("ocr_query") or refined.get("asr_query"):
            refined["ocr_query"] = ""
            refined["asr_query"] = ""
            strategy = "Removed uncertain OCR/ASR constraints to broaden retrieval."
        elif refined.get("text_query"):
            refined["text_query"] = f"{refined['text_query']} in a wider scene context"
            strategy = "Broadened the visual query with surrounding scene context."
        else:
            refined["text_query"] = "distinctive visible scene matching the user request"
            strategy = "Added a broad English visual retrieval query."

    if _query_was_attempted(session, refined):
        base_query = refined.get("text_query") or previous.get("text_query") or "distinctive visible scene"
        refined["text_query"] = f"{base_query} alternate visual context for retrieval round {round_number + 1}"
        strategy = f"{strategy} Added a unique alternate scene context to avoid repeating an earlier round."

    session.queries = refined
    _log_step(
        session,
        "refine",
        f"Prepared a materially different query plan for round {round_number + 1}.",
        "completed",
        previous_queries=previous,
        next_queries=session.queries,
        strategy=strategy,
        changed=_queries_changed(previous, session.queries),
        next_round=round_number + 1,
    )
    return session.queries


async def feedback_node(session: AgentSession) -> dict[str, str]:
    _log_step(
        session,
        "feedback",
        "Applying text feedback and positive/negative frame labels.",
        feedback=session.feedback,
        positive_frames=session.positive_frame_names,
        negative_frames=session.negative_frame_names,
        positive_count=len(session.positive_frame_names),
        negative_count=len(session.negative_frame_names),
    )
    response = await _invoke_json([
        SystemMessage(content=(
            "Refine video retrieval queries using explicit user feedback. Return JSON only with string "
            "keys text_query, ocr_query, asr_query, explanation. text_query must be English. OCR and ASR "
            "must be exact likely visible/spoken strings, in their real language, or empty when uncertain."
        )),
        HumanMessage(content=(
            f"Original request: {session.original_query}\nCurrent queries: "
            f"{json.dumps(session.queries, ensure_ascii=False)}\nFeedback: {session.feedback}\n"
            f"Positive frames: {session.positive_frame_names}\nNegative frames: {session.negative_frame_names}"
        )),
    ])
    session.queries = _normalize_queries(response)
    _log_step(
        session,
        "feedback",
        "Feedback was converted into refined retrieval queries.",
        "completed",
        queries=session.queries,
        explanation=_clean_query(response.get("explanation")),
    )
    return session.queries


def _rank_final_frames(
    frames: list[dict[str, Any]],
    ranked_numbers: list[int],
    top_k: int,
) -> list[dict[str, Any]]:
    ranked = [frames[number - 1] for number in ranked_numbers if 1 <= number <= len(frames)]
    seen = {item.get("frame_name") for item in ranked}
    return (ranked + [item for item in frames if item.get("frame_name") not in seen])[:top_k]


async def _run_retrieval_graph(
    session: AgentSession,
    models: list[str],
    model_weights: dict[str, float],
    top_k: int,
) -> dict[str, Any]:
    session.top_k = max(1, min(top_k, MAX_AGENT_FRAMES))
    rounds: list[dict[str, Any]] = []
    frames: list[dict[str, Any]] = []
    best_frames: list[dict[str, Any]] = []
    best_critique: dict[str, Any] = {}
    final_critique: dict[str, Any] = {
        "satisfied": False,
        "analysis": "No candidate frame was returned.",
        "selected_frame_numbers": [],
        "ranked_frame_numbers": [],
    }

    for round_number in range(1, MAX_AGENT_ROUNDS + 1):
        round_queries = dict(session.queries)
        selected_models = _valid_models(models)
        _log_step(
            session,
            "search",
            f"Round {round_number}/{MAX_AGENT_ROUNDS}: searching for the top {session.top_k} candidate frames.",
            round=round_number,
            top_k=session.top_k,
            queries=round_queries,
            models=selected_models,
            model_weights={model: float(model_weights.get(model, 1.0)) for model in selected_models},
        )
        frames = await search_node(session, models, model_weights, session.top_k)
        _log_step(
            session,
            "search",
            f"Round {round_number}: retrieved {len(frames)} candidate frame(s).",
            "completed",
            round=round_number,
            candidate_count=len(frames),
            queries=round_queries,
            candidates=[
                {
                    "frame_name": item.get("frame_name"),
                    "score": round(float(item.get("score") or 0.0), 5),
                }
                for item in frames
            ],
        )
        if not frames:
            final_critique = {
                "satisfied": False,
                "analysis": "Search returned no candidate frames. The next round must use a broader or alternative query plan.",
                "selected_frame_numbers": [],
                "ranked_frame_numbers": [],
                "refined_queries": {},
            }
            round_result = {
                "round": round_number,
                "queries": round_queries,
                "candidate_count": 0,
                "satisfied": False,
                "analysis": final_critique["analysis"],
            }
            rounds.append(round_result)
            session.rounds = rounds
            if round_number == MAX_AGENT_ROUNDS:
                break
            await refine_node(session, final_critique, round_number)
            round_result["next_queries"] = dict(session.queries)
            continue

        _log_step(
            session,
            "canvas",
            f"Building a white contact sheet from {len(frames)} frame(s).",
            round=round_number,
        )
        canvas = await asyncio.to_thread(canvas_node, frames)
        session.canvas_image = f"data:image/jpeg;base64,{canvas}"
        _log_step(
            session,
            "canvas",
            f"Contact sheet with {len(frames)} frame(s) is ready for the visual critic.",
            "completed",
            round=round_number,
            frame_count=len(frames),
            frame_names=[item.get("frame_name") for item in frames],
        )
        _log_step(
            session,
            "critic",
            f"Round {round_number}: Qwen is inspecting the contact sheet against the original request.",
            round=round_number,
            original_query=session.original_query,
            queries=round_queries,
            candidate_count=len(frames),
        )
        final_critique = await critic_node(session, frames, canvas, round_number)
        best_frames = frames
        best_critique = final_critique
        selected_frames = [
            frames[number - 1]
            for number in final_critique["selected_frame_numbers"]
            if 1 <= number <= len(frames)
        ]
        session.kept_frames = _deduplicate_frames(session.kept_frames + selected_frames)
        _log_step(
            session,
            "critic",
            final_critique["analysis"] or f"Round {round_number} critique completed.",
            "completed",
            round=round_number,
            satisfied=final_critique["satisfied"],
            selected_count=len(final_critique["selected_frame_numbers"]),
            selected_frame_numbers=final_critique["selected_frame_numbers"],
            selected_frames=selected_frames,
            kept_frame_count=len(session.kept_frames),
            ranked_frame_numbers=final_critique["ranked_frame_numbers"],
            ranking_basis="original_query",
            current_queries=round_queries,
            proposed_next_queries=final_critique["refined_queries"],
            analysis=final_critique["analysis"],
        )
        round_result = {
            "round": round_number,
            "queries": round_queries,
            "candidate_count": len(frames),
            "satisfied": final_critique["satisfied"],
            "analysis": final_critique["analysis"],
            "selected_frame_numbers": final_critique["selected_frame_numbers"],
            "ranked_frame_numbers": final_critique["ranked_frame_numbers"],
            # Actual frame payloads are retained so the client can display
            # the critic-approved frames for this particular round.
            "selected_frames": selected_frames,
        }
        rounds.append(round_result)
        session.rounds = rounds
        if final_critique["satisfied"] or round_number == MAX_AGENT_ROUNDS:
            break
        await refine_node(session, final_critique, round_number)
        round_result["next_queries"] = dict(session.queries)

    if not frames and best_frames:
        frames = best_frames
        final_critique = {
            **best_critique,
            "analysis": (
                f"{best_critique.get('analysis', '')} The last refinement returned no frames, "
                "so the strongest candidates from the previous round are shown."
            ).strip(),
        }

    # The final result grid is intentionally restricted to frames the visual
    # critic explicitly selected in one of the rounds.  Candidate rankings are
    # useful for the critic internally, but must not leak unselected frames to
    # the user-facing "Ranked results" list.
    session.frames = session.kept_frames[:session.top_k]
    session.rounds = rounds
    _log_step(
        session,
        "finalize",
        f"Finalized {len(session.frames)} frame(s) for the user.",
        "completed",
        frame_count=len(session.frames),
        final_queries=session.queries,
        ranking_basis="critic_selected_frames",
        ranked_frame_numbers=final_critique.get("ranked_frame_numbers", []),
        frame_names=[item.get("frame_name") for item in session.frames],
        kept_frame_names=[item.get("frame_name") for item in session.kept_frames],
    )
    return _completed_response(session, final_critique.get("analysis", ""))


def _completed_response(session: AgentSession, analysis: str) -> dict[str, Any]:
    return {
        "session_id": session.session_id,
        "status": "completed",
        "assistant_message": analysis or "Đã chọn các frame có khả năng phù hợp nhất.",
        "queries": session.queries,
        "frames": session.frames,
        "kept_frames": session.kept_frames,
        "rounds": session.rounds,
        "top_k": session.top_k,
        "canvas_image": session.canvas_image,
        "events": session.events,
    }


@router.post("/message")
async def create_agent_message(request: AgentMessageRequest):
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")
    session = await _get_or_create_session(request.session_id)
    async with session.lock:
        _reset_run_events(session)
        session.top_k = request.top_k
        _log_step(
            session,
            "request",
            "Received a new retrieval request.",
            "completed",
            original_query=message,
            research_enabled=request.use_research,
            top_k=request.top_k,
            models=_valid_models(request.models),
            model_weights=request.model_weights,
        )
        session.original_query = message
        session.options = []
        session.selected_option = None
        session.queries = {}
        session.frames = []
        session.kept_frames = []
        session.rounds = []
        session.feedback = ""
        session.positive_frame_names = []
        session.negative_frame_names = []
        session.canvas_image = ""

        if request.use_research:
            try:
                research = await research_node(session)
            except Exception as exc:
                _log_step(session, "error", str(exc), "failed")
                raise HTTPException(status_code=502, detail=f"Gemini research failed: {exc}") from exc
            if research["options"]:
                return {
                    "session_id": session.session_id,
                    "status": "awaiting_option",
                    "assistant_message": research["summary"],
                    "options": research["options"],
                    "top_k": session.top_k,
                    "events": session.events,
                }

        try:
            await query_node(session)
            return await _run_retrieval_graph(session, request.models, request.model_weights, request.top_k)
        except Exception as exc:
            _log_step(session, "error", str(exc), "failed")
            raise HTTPException(status_code=502, detail=f"Agent execution failed: {exc}") from exc


@router.post("/option")
async def select_agent_option(request: AgentOptionRequest):
    session = _sessions.get(request.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Agent session not found.")
    async with session.lock:
        _reset_run_events(session)
        session.top_k = request.top_k
        if request.option_index is not None:
            if request.option_index < 0 or request.option_index >= len(session.options):
                raise HTTPException(status_code=422, detail="Invalid research option.")
            session.selected_option = session.options[request.option_index]
            _log_step(
                session,
                "option",
                f"Selected research option: {session.selected_option['option']}",
                "completed",
                selected_option=session.selected_option,
            )
        else:
            session.selected_option = None
            _log_step(session, "option", "No research option selected; keeping the original request.", "completed")
        try:
            await query_node(session)
            return await _run_retrieval_graph(session, request.models, request.model_weights, request.top_k)
        except Exception as exc:
            _log_step(session, "error", str(exc), "failed")
            raise HTTPException(status_code=502, detail=f"Agent execution failed: {exc}") from exc


@router.post("/feedback")
async def submit_agent_feedback(request: AgentFeedbackRequest):
    session = _sessions.get(request.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Agent session not found.")
    if not request.feedback.strip() and not request.positive_frame_names and not request.negative_frame_names:
        raise HTTPException(status_code=400, detail="Feedback or frame labels are required.")
    async with session.lock:
        _reset_run_events(session)
        session.top_k = request.top_k
        session.feedback = request.feedback.strip()
        session.positive_frame_names = list(dict.fromkeys(request.positive_frame_names))
        session.negative_frame_names = list(dict.fromkeys(request.negative_frame_names))
        try:
            await feedback_node(session)
            return await _run_retrieval_graph(session, request.models, request.model_weights, request.top_k)
        except Exception as exc:
            _log_step(session, "error", str(exc), "failed")
            raise HTTPException(status_code=502, detail=f"Agent feedback failed: {exc}") from exc


@router.get("/sessions/{session_id}/events")
async def get_agent_events(session_id: str, after_id: int = 0):
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Agent session not found.")
    return {
        "session_id": session_id,
        "events": [event for event in session.events if event["id"] > after_id],
        "last_event_id": session.event_seq,
    }


@router.delete("/sessions/{session_id}")
async def delete_agent_session(session_id: str):
    async with _sessions_guard:
        removed = _sessions.pop(session_id, None)
    return {"deleted": removed is not None}
