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
from backend.services.multiagent_search import (
    MODALITIES,
    critic_filter,
    normalize_queries,
    parse_json_response,
    retrieve_by_modality,
)

router = APIRouter(prefix="/chatbot", tags=["chatbot"])

# ==============================================================================
# 1. MODELS & STRUCTURED SCHEMAS
# ==============================================================================

model = ChatOpenAI(
    model_name=GEMINI_MODEL_NAME,
    base_url=GEMINI_BASE_URL,
    api_key=GEMINI_API_KEY,
    temperature=0.0,
)

class OptionSchema(BaseModel):
    option: str = Field(description="Tên đối tượng, sự kiện, người hoặc thực thể được chọn")
    reason: str = Field(description="Lý do chi tiết đưa ra lựa chọn này")

class OptionsSchema(BaseModel):
    options: list[OptionSchema]

model_with_structured = model.with_structured_output(schema=OptionsSchema)


# ==============================================================================
# 2. CHAT & RESEARCH WORKFLOW GRAPH
# ==============================================================================

class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    is_research: bool
    options: Optional[list[dict[str, Any]]]

async def research_node(state: ChatState) -> dict[str, Any]:
    system_prompt = (
        "Bạn là một chuyên gia nghiên cứu và truy vấn video/hình ảnh.\n"
        "Hãy phân tích nội dung người dùng cung cấp và đưa ra 3-5 lựa chọn (đối tượng, sự kiện, người, thực thể, bối cảnh) "
        "có khả năng nhất kèm theo lý do cụ thể.\n"
        "Trả về định dạng JSON với danh sách 'options', mỗi phần tử bắt buộc có 2 trường: 'option' và 'reason'"
    )
    user_messages = [m for m in state["messages"] if isinstance(m, (HumanMessage, AIMessage))]
    
    response = await model_with_structured.ainvoke(
        [SystemMessage(content=system_prompt), *user_messages]
    )
    
    # Chuyển đổi an toàn sang list of dicts
    options_data = []
    if isinstance(response, OptionsSchema):
        options_data = [opt.dict() for opt in response.options]
    elif isinstance(response, dict):
        options_data = response.get("options", [])

    return {
        "options": options_data,
        "messages": [AIMessage(content="Dưới đây là các phương án nghiên cứu phù hợp nhất:")],
    }

async def chatbot_node(state: ChatState) -> dict[str, Any]:
    response = await model.ainvoke(state["messages"])
    return {
        "messages": [response],
        "options": None,
    }

def route_chat_decision(state: ChatState) -> Literal["research", "chatbot"]:
    return "research" if state.get("is_research", False) else "chatbot"

chat_graph_builder = StateGraph(ChatState)
chat_graph_builder.add_node("research", research_node)
chat_graph_builder.add_node("chatbot", chatbot_node)
chat_graph_builder.add_conditional_edges(START, route_chat_decision)
chat_graph_builder.add_edge("research", END)
chat_graph_builder.add_edge("chatbot", END)

chat_memory = MemorySaver()
chat_graph = chat_graph_builder.compile(checkpointer=chat_memory)


# ==============================================================================
# 3. MULTI-AGENT SEARCH WORKFLOW GRAPH
# ==============================================================================

class MultiAgentSearchState(TypedDict):
    original_query: str
    frame_limit: int
    queries: dict[str, str]
    candidates_by_modality: dict[str, list[dict[str, Any]]]
    modalities: dict[str, dict[str, Any]]
    warnings: list[str]
    selected_count: int
    active_modalities: int

def _multiagent_human_message(content: list[dict[str, Any]]) -> list[HumanMessage]:
    return [HumanMessage(content=content)]

async def decompose_node(state: MultiAgentSearchState) -> dict[str, Any]:
    """Node 1: Phân tách câu truy vấn người dùng thành các modalities độc lập."""
    if runtime.llm_multiagent is None:
        raise HTTPException(
            status_code=503,
            detail="Multi-agent model is not initialized. Configure MULTIAGENT_MODEL, MULTIAGENT_MODEL_BASE_URL, and MULTIAGENT_MODEL_API_KEY.",
        )
    
    prompt = (
        "You decompose a Vietnamese or English video-retrieval request into independent retrieval queries. "
        "Return JSON only, exactly shaped as: "
        "{\"queries\":{\"text\":\"...\",\"ocr\":\"...\",\"asr\":\"...\",\"semantic_asr\":\"...\"}}. "
        "Use concise English retrieval phrases for text. OCR is only visible written text; ASR is exact spoken words; "
        "semantic_asr is a short event/topic description. Use an empty string when a modality has no useful query. "
        "Do not invent facts that are absent from the request.\n"
        f"User request: {state['original_query']}"
    )

    try:
        if hasattr(runtime.llm_multiagent, "ainvoke"):
            response = await runtime.llm_multiagent.ainvoke([HumanMessage(content=prompt)])
        else:
            response = await asyncio.to_thread(runtime.llm_multiagent.invoke, [HumanMessage(content=prompt)])
            
        queries = normalize_queries(parse_json_response(response.content))
        return {"queries": queries}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Query decomposition failed: {exc}") from exc

async def retrieve_node(state: MultiAgentSearchState) -> dict[str, Any]:
    """Node 2: Truy xuất ứng viên song song trên Qdrant / Meilisearch theo từng modality."""
    candidates_by_modality = await retrieve_by_modality(state["queries"], state["frame_limit"])
    return {"candidates_by_modality": candidates_by_modality}

async def critic_node(state: MultiAgentSearchState) -> dict[str, Any]:
    """Node 3: Chạy Visual Critic đánh giá song song trên tất cả các modalities."""
    queries = state["queries"]
    candidates_by_modality = state["candidates_by_modality"]
    
    async def evaluate_single_modality(modality: str):
        candidates = candidates_by_modality.get(modality, [])
        selected, critic_warnings = await critic_filter(
            llm=runtime.llm_multiagent,
            human_message_factory=_multiagent_human_message,
            original_query=state["original_query"],
            modality=modality,
            modality_query=queries.get(modality, ""),
            candidates=candidates,
        )
        return modality, selected, critic_warnings, len(candidates)

    # Đánh giá song song tất cả các modalities thay vì duyệt tuần tự
    evaluation_tasks = [evaluate_single_modality(modality) for modality in MODALITIES]
    evaluation_results = await asyncio.gather(*evaluation_tasks)

    modalities: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []

    for modality, selected, critic_warnings, candidate_count in evaluation_results:
        warnings.extend(critic_warnings)
        modalities[modality] = {
            "query": queries.get(modality, ""),
            "candidate_count": candidate_count,
            "frames": selected,
        }

    selected_count = sum(len(item["frames"]) for item in modalities.values())
    active_modalities = sum(1 for item in modalities.values() if item["query"])

    return {
        "modalities": modalities,
        "warnings": warnings,
        "selected_count": selected_count,
        "active_modalities": active_modalities,
    }

# Xây dựng Search StateGraph
search_graph_builder = StateGraph(MultiAgentSearchState)
search_graph_builder.add_node("decompose", decompose_node)
search_graph_builder.add_node("retrieve", retrieve_node)
search_graph_builder.add_node("critic", critic_node)

search_graph_builder.add_edge(START, "decompose")
search_graph_builder.add_edge("decompose", "retrieve")
search_graph_builder.add_edge("retrieve", "critic")
search_graph_builder.add_edge("critic", END)

search_graph = search_graph_builder.compile()


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
    frame_limit: Literal[20, 50, 100, 200] = 50

@router.post("/message", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    
    config = {"configurable": {"thread_id": req.session_id}}
    initial_state = {
        "messages": [HumanMessage(content=query)],
        "is_research": req.is_research,
        "options": None,
    }

    try:
        result = await chat_graph.ainvoke(initial_state, config)
        
        last_msg = result["messages"][-1].content if result.get("messages") else ""
        options_data = result.get("options") if req.is_research else None

        return ChatResponse(
            role="assistant",
            content=last_msg,
            options=options_data,
            is_research=req.is_research
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chatbot failed: {str(e)}")

@router.post("/search")
async def multiagent_search_endpoint(req: MultiAgentSearchRequest):
    """Kích hoạt Multi-Agent Search Graph: Decompose -> Retrieve -> Critic -> Filter."""
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    initial_state = {
        "original_query": query,
        "frame_limit": req.frame_limit,
        "queries": {},
        "candidates_by_modality": {},
        "modalities": {},
        "warnings": [],
        "selected_count": 0,
        "active_modalities": 0,
    }

    try:
        result = await search_graph.ainvoke(initial_state)
        return {
            "query": result["original_query"],
            "frame_limit": result["frame_limit"],
            "modalities": result["modalities"],
            "selected_count": result["selected_count"],
            "active_modalities": result["active_modalities"],
            "warnings": result["warnings"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MultiAgent Search failed: {str(e)}")