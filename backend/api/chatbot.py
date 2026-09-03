# backend/api/chatbot.py
from __future__ import annotations

import asyncio
from typing import Annotated, Any, List, Literal, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from backend.core import runtime
from backend.core.config import GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL_NAME
from backend.api.realtime import broadcast_event
from backend.services.multiagent_search import (
    MODALITIES,
    critic_filter_modality,
    deduplicate_frames,
    normalize_queries,
    parse_json_response,
    retrieve_by_modality,
)

router = APIRouter(prefix="/chatbot", tags=["chatbot"])

model = ChatOpenAI(
    model_name=GEMINI_MODEL_NAME,
    base_url=GEMINI_BASE_URL,
    api_key=GEMINI_API_KEY,
    temperature=0.0,
)


def _load_skill(skill_filename: str) -> str:
    from pathlib import Path
    skill_path = Path(__file__).resolve().parents[1] / "skills" / skill_filename
    if skill_path.exists():
        try:
            return skill_path.read_text(encoding="utf-8")
        except Exception:
            pass
    return ""


# ==============================================================================
# 1. HELPER PARSERS
# ==============================================================================

def parse_options_response(content: Any) -> list[dict[str, Any]]:
    payload = parse_json_response(content)
    raw_options = payload.get("options", payload) if isinstance(payload, dict) else payload
    if not isinstance(raw_options, list):
        return []
    options = []
    for item in raw_options:
        if isinstance(item, dict) and "option" in item:
            options.append({
                "option": str(item.get("option", "")).strip(),
                "reason": str(item.get("reason", "")).strip(),
            })
    return options


# ==============================================================================
# 2. UNIFIED MULTI-AGENT STATE & GRAPH
# ==============================================================================

class UnifiedAgentState(TypedDict):
    mode: Literal["chat", "research", "search"]
    messages: Annotated[list[BaseMessage], add_messages]
    original_query: str
    selected_options: list[str]
    use_research: bool
    k_iterations: int
    current_iteration: int
    frame_limit: int
    options: Optional[list[dict[str, Any]]]
    queries: dict[str, str]
    candidates_by_modality: dict[str, list[dict[str, Any]]]
    feedback_by_modality: dict[str, str]
    accumulated_frames_by_modality: dict[str, list[dict[str, Any]]]
    seen_frame_keys: list[str]
    modalities: dict[str, dict[str, Any]]
    warnings: list[str]
    is_finished: bool
    debug: bool


def _multiagent_human_message(content: list[dict[str, Any]]) -> list[HumanMessage]:
    return [HumanMessage(content=content)]


# --- Node: Chatbot / Conversational ---
async def chat_node(state: UnifiedAgentState) -> dict[str, Any]:
    response = await model.ainvoke(state["messages"])
    return {
        "messages": [response],
        "options": None,
        "is_finished": True,
    }


# --- Node 1: Research & Entity Disambiguation ---
async def research_node(state: UnifiedAgentState) -> dict[str, Any]:
    skill_doc = _load_skill("research_skill.md")
    system_prompt = (
        skill_doc or (
            "Bạn là một chuyên gia nghiên cứu và truy vấn video/hình ảnh.\n"
            "Hãy phân tích nội dung người dùng cung cấp và đưa ra 3-5 lựa chọn (đối tượng, sự kiện, người, thực thể, bối cảnh) "
            "có khả năng nhất kèm theo lý do cụ thể.\n"
            "BẮT BUỘC chỉ trả về định dạng JSON thuần:\n"
            '{"options": [{"option": "<tên đối tượng/người/sự kiện>", "reason": "<lý do chi tiết>"}]}'
        )
    )
    user_messages = [m for m in state.get("messages", []) if isinstance(m, (HumanMessage, AIMessage))]
    if not user_messages:
        user_messages = [HumanMessage(content=state["original_query"])]

    response = await model.ainvoke(
        [SystemMessage(content=system_prompt), *user_messages]
    )
    options_data = parse_options_response(response.content)

    # If in search mode with auto-research, populate selected_options
    chosen_opts = list(state.get("selected_options", []))
    if state["mode"] == "search" and not chosen_opts:
        chosen_opts = [opt["option"] for opt in options_data[:3] if opt.get("option")]

    return {
        "options": options_data,
        "selected_options": chosen_opts,
        "messages": [AIMessage(content="Dưới đây là các phương án nghiên cứu phù hợp nhất:")],
        "is_finished": False if state["mode"] == "search" else True,
    }


# --- Node 2: Query Decomposition & Feedback Refinement ---
async def decompose_and_plan_node(state: UnifiedAgentState) -> dict[str, Any]:
    agent_llm = runtime.llm_multiagent or model
    skill_doc = _load_skill("query_planner_skill.md")
    glossary_skill = _load_skill("translation_glossary_skill.md")
    full_skill_prompt = (
        f"{skill_doc}\n\n"
        "==================================================\n"
        "VIETNAMESE-ENGLISH TRANSLATION & VISUAL VOCABULARY GLOSSARY\n"
        "==================================================\n"
        f"{glossary_skill}"
    )

    iteration = state.get("current_iteration", 0) + 1
    feedback_str = "\n".join(
        f"- {mod}: {fb}" for mod, fb in state.get("feedback_by_modality", {}).items() if fb
    ) or "None (First iteration)"

    options_str = ", ".join(state.get("selected_options", [])) if state.get("selected_options") else "None"

    prompt = (
        f"{full_skill_prompt}\n\n"
        f"--- CURRENT CONTEXT (Iteration {iteration}/{state.get('k_iterations', 3)}) ---\n"
        f"Original User Request: {state['original_query']}\n"
        f"Selected Entities/Context: {options_str}\n"
        f"Critic Feedback from Previous Loop:\n{feedback_str}\n\n"
        "Construct optimal queries for each modality ('text', 'ocr', 'semantic_asr'). "
        'Return JSON only in format: {"queries": {"text": "...", "ocr": "...", "semantic_asr": "..."}}'
    )

    print(f"\n[Multi-Agent Loop {iteration}/{state.get('k_iterations', 3)}] === DECOMPOSE & PLAN ===")
    print(f"[Multi-Agent] Original Query: {state['original_query']}")
    print(f"[Multi-Agent] Selected Options: {options_str}")
    if feedback_str != 'None (First iteration)':
        print(f"[Multi-Agent] Critic Feedback Received:\n{feedback_str}")

    try:
        if hasattr(agent_llm, "ainvoke"):
            response = await agent_llm.ainvoke([HumanMessage(content=prompt)])
        else:
            response = await asyncio.to_thread(agent_llm.invoke, [HumanMessage(content=prompt)])
        raw_json = parse_json_response(response.content)
        queries = normalize_queries(raw_json)
        print(f"[Multi-Agent] Generated Queries -> text: '{queries.get('text')}', ocr: '{queries.get('ocr')}', semantic_asr: '{queries.get('semantic_asr')}'")
    except Exception as exc:
        print(f"[Multi-Agent] Decompose Error ({exc}), falling back to original query.")
        queries = {
            "text": state["original_query"],
            "ocr": "",
            "semantic_asr": state["original_query"],
        }

    return {"queries": queries, "current_iteration": iteration}


# --- Node 3: Independent Modality Retrieval ---
async def retrieve_node(state: UnifiedAgentState) -> dict[str, Any]:
    queries = state.get("queries", {})
    exclude_set = set(state.get("seen_frame_keys", []))
    print(f"[Multi-Agent] === RETRIEVAL START (Excluding {len(exclude_set)} previously seen frames) ===")
    candidates = await retrieve_by_modality(queries, state.get("frame_limit", 50), exclude_frames=exclude_set)
    for m in MODALITIES:
        print(f"[Multi-Agent] Modality '{m}' fetched {len(candidates.get(m, []))} candidates")
    return {"candidates_by_modality": candidates}


# --- Node 4: Two-Pass Visual Critic & Diagnostic Feedback ---
async def critic_and_feedback_node(state: UnifiedAgentState) -> dict[str, Any]:
    critic_llm = runtime.llm_multiagent or model
    queries = state.get("queries", {})
    candidates_by_modality = state.get("candidates_by_modality", {})
    accumulated = dict(state.get("accumulated_frames_by_modality", {}))
    seen_keys = set(state.get("seen_frame_keys", []))
    new_feedback = {}
    warnings = list(state.get("warnings", []))

    async def evaluate_modality(modality: str):
        candidates = candidates_by_modality.get(modality, [])
        query_text = queries.get(modality, "")
        selected, feedback, w = await critic_filter_modality(
            llm=critic_llm,
            human_message_factory=_multiagent_human_message,
            original_query=state["original_query"],
            modality=modality,
            modality_query=query_text,
            candidates=candidates,
            debug=state.get("debug", True),
            iteration=state.get("current_iteration", 1),
        )
        return modality, selected, feedback, w

    print(f"[Multi-Agent] === CRITIC INSPECTION (Canvas 20-Images/Batch) ===")
    results = await asyncio.gather(*(evaluate_modality(m) for m in MODALITIES))

    modalities_output = {}
    for modality, selected, feedback, w in results:
        warnings.extend(w)
        new_feedback[modality] = feedback

        existing = accumulated.get(modality, [])
        combined = deduplicate_frames(existing + selected)
        accumulated[modality] = combined

        print(f"[Multi-Agent Critic] '{modality}' selected {len(selected)} new frames (Total accumulated: {len(combined)} frames)")
        if feedback:
            print(f"[Multi-Agent Critic] '{modality}' Feedback: {feedback}")

        for f in combined:
            k = str(f.get("frame_name") or f.get("filepath") or "")
            if k:
                seen_keys.add(k)

        modalities_output[modality] = {
            "query": queries.get(modality, ""),
            "feedback": feedback,
            "candidate_count": len(candidates_by_modality.get(modality, [])),
            "frames": combined,
        }

    is_done = state["current_iteration"] >= state["k_iterations"]
    print(f"[Multi-Agent] Loop {state['current_iteration']}/{state['k_iterations']} complete. Finished: {is_done}")

    # Broadcast loop progress in real-time to all connected frontend clients
    try:
        total_frames = sum(len(item.get("frames", [])) for item in modalities_output.values())
        progress_payload = {
            "query": state["original_query"],
            "current_iteration": state["current_iteration"],
            "k_iterations": state["k_iterations"],
            "modalities": modalities_output,
            "selected_count": total_frames,
            "is_done": is_done,
        }
        asyncio.create_task(broadcast_event("multiagent_loop_progress", progress_payload))
    except Exception as exc:
        print(f"[Multi-Agent] Failed to broadcast loop progress: {exc}")

    return {
        "feedback_by_modality": new_feedback,
        "accumulated_frames_by_modality": accumulated,
        "seen_frame_keys": list(seen_keys),
        "modalities": modalities_output,
        "warnings": warnings,
        "is_finished": is_done,
    }


# --- Routing Conditions ---
def route_start_decision(state: UnifiedAgentState) -> Literal["chat", "research", "auto_research_or_decompose"]:
    mode = state.get("mode", "chat")
    if mode == "chat":
        return "chat"
    if mode == "research":
        return "research"
    # Search mode: check if research is needed or options are provided
    if state.get("use_research", True) and not state.get("selected_options"):
        return "research"
    return "auto_research_or_decompose"


def route_search_or_finish(state: UnifiedAgentState) -> Literal["decompose", "finish"]:
    if state.get("mode") == "research":
        return "finish"
    if state.get("is_finished", False):
        return "finish"
    return "decompose"


def route_critic_loop(state: UnifiedAgentState) -> Literal["decompose", "finish"]:
    return "finish" if state.get("is_finished", False) else "decompose"


# ==============================================================================
# 3. BUILD UNIFIED STATEGRAPH
# ==============================================================================

unified_graph_builder = StateGraph(UnifiedAgentState)

unified_graph_builder.add_node("chat", chat_node)
unified_graph_builder.add_node("research", research_node)
unified_graph_builder.add_node("decompose", decompose_and_plan_node)
unified_graph_builder.add_node("retrieve", retrieve_node)
unified_graph_builder.add_node("critic", critic_and_feedback_node)

unified_graph_builder.add_conditional_edges(START, route_start_decision, {
    "chat": "chat",
    "research": "research",
    "auto_research_or_decompose": "decompose",
})

unified_graph_builder.add_edge("chat", END)
unified_graph_builder.add_conditional_edges("research", route_search_or_finish, {
    "decompose": "decompose",
    "finish": END,
})

unified_graph_builder.add_edge("decompose", "retrieve")
unified_graph_builder.add_edge("retrieve", "critic")
unified_graph_builder.add_conditional_edges("critic", route_critic_loop, {
    "decompose": "decompose",
    "finish": END,
})

agent_memory = MemorySaver()
unified_multiagent_graph = unified_graph_builder.compile(checkpointer=agent_memory)


# ==============================================================================
# 4. FASTAPI REQUEST / RESPONSE MODELS & ENDPOINTS
# ==============================================================================

class ChatRequest(BaseModel):
    query: str
    is_research: bool = True
    session_id: str = "default_chat"


class ChatResponse(BaseModel):
    role: str = "assistant"
    content: str
    options: Optional[List[dict]] = None
    is_research: bool = True


class MultiAgentSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    selected_options: List[str] = Field(default_factory=list)
    use_research: bool = True
    k_iterations: int = Field(default=3, ge=1, le=10)
    frame_limit: int = Field(default=50, ge=10, le=200)
    debug: bool = True


@router.post("/message", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    
    config = {"configurable": {"thread_id": req.session_id}}
    initial_state = {
        "mode": "research" if req.is_research else "chat",
        "messages": [HumanMessage(content=query)],
        "original_query": query,
        "selected_options": [],
        "use_research": req.is_research,
        "k_iterations": 1,
        "current_iteration": 0,
        "frame_limit": 50,
        "options": None,
        "queries": {},
        "candidates_by_modality": {},
        "feedback_by_modality": {},
        "accumulated_frames_by_modality": {m: [] for m in MODALITIES},
        "seen_frame_keys": [],
        "modalities": {},
        "warnings": [],
        "is_finished": False,
        "debug": getattr(req, "debug", True),
    }

    try:
        result = await unified_multiagent_graph.ainvoke(initial_state, config)
        last_msg = result["messages"][-1].content if result.get("messages") else ""
        options_data = result.get("options") if req.is_research else None

        return ChatResponse(
            role="assistant",
            content=last_msg,
            options=options_data,
            is_research=req.is_research,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chatbot failed: {str(e)}")


@router.post("/search")
async def multiagent_search_endpoint(req: MultiAgentSearchRequest):
    """
    Unified Multi-Agent Search:
    Routes through UnifiedGraph: (Research) -> (Decompose -> Retrieve -> Critic) * K -> Final Result
    """
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    initial_state = {
        "mode": "search",
        "messages": [HumanMessage(content=query)],
        "original_query": query,
        "selected_options": req.selected_options,
        "use_research": req.use_research,
        "k_iterations": req.k_iterations,
        "current_iteration": 0,
        "frame_limit": req.frame_limit,
        "options": None,
        "queries": {},
        "feedback_by_modality": {},
        "accumulated_frames_by_modality": {m: [] for m in MODALITIES},
        "seen_frame_keys": [],
        "modalities": {},
        "warnings": [],
        "is_finished": False,
        "debug": getattr(req, "debug", True),
    }

    import uuid
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": f"search_{thread_id}"}}

    try:
        result = await unified_multiagent_graph.ainvoke(initial_state, config)
        modalities = result.get("modalities", {})
        total_selected = sum(len(item.get("frames", [])) for item in modalities.values())
        active_count = sum(1 for item in modalities.values() if item.get("query"))

        return {
            "query": result["original_query"],
            "selected_options": result.get("selected_options", []),
            "k_iterations": result.get("k_iterations", req.k_iterations),
            "completed_iterations": result.get("current_iteration", 0),
            "frame_limit": result.get("frame_limit", req.frame_limit),
            "modalities": modalities,
            "selected_count": total_selected,
            "active_modalities": active_count,
            "warnings": result.get("warnings", []),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MultiAgent Search failed: {str(e)}")
