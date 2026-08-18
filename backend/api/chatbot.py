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

from backend.core.config import GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_MODEL_NAME

router = APIRouter(prefix="/chatbot", tags=["chatbot"])

model = ChatOpenAI(
    model_name=GEMINI_MODEL_NAME,
    base_url=GEMINI_BASE_URL,
    api_key=GEMINI_API_KEY,
    temperature=0.0,
)

class Option(TypedDict):
    option: str
    reason: str

class Options(TypedDict):
    options: list[Option]

model_with_structured = model.with_structured_output(schema=Options)

class State(TypedDict):
    options: Optional[Options]
    messages: Annotated[list[BaseMessage], add_messages]
    isResearch: bool

def research_node(state: State):
    system_prompt = (
        "Bạn là một chuyên gia nghiên cứu và truy vấn video/hình ảnh.\n"
        "Hãy phân tích nội dung người dùng cung cấp và đưa ra 3-5 lựa chọn (đối tượng, sự kiện, người, thực thể, bối cảnh) "
        "có khả năng nhất kèm theo lý do cụ thể.\n"
        "Trả về định dạng JSON với danh sách 'options', mỗi phần tử bắt buộc có 2 trường: 'option' (tên lựa chọn) và 'reason' (lý do)."
    )
    user_messages = [m for m in state["messages"] if isinstance(m, (HumanMessage, AIMessage))]
    response = model_with_structured.invoke([SystemMessage(content=system_prompt), *user_messages])
    
    return {
        "options": response if isinstance(response, dict) else response.dict(),
        "messages": [AIMessage(content="Dưới đây là các phương án nghiên cứu phù hợp nhất:")],
    }

def chatbot_node(state: State):
    response = model.invoke(state["messages"])
    return {"messages": [response], "options": None}

def route_decision(state: State) -> Literal["research", "chatbot"]:
    return "research" if state.get("isResearch", False) else "chatbot"

graph_builder = StateGraph(State)
graph_builder.add_node("research", research_node)
graph_builder.add_node("chatbot", chatbot_node)
graph_builder.add_conditional_edges(START, route_decision)
graph_builder.add_edge("research", END)
graph_builder.add_edge("chatbot", END)

memory = MemorySaver()
graph = graph_builder.compile(checkpointer=memory)

class ChatRequest(BaseModel):
    query: str
    is_research: bool = True
    session_id: str = "default_chat"

class ChatResponse(BaseModel):
    role: str = "assistant"
    content: str
    options: Optional[List[dict]] = None
    is_research: bool = True

@router.post("/message", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    query = req.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")
    
    config = {"configurable": {"thread_id": req.session_id}}
    initial_state = {
        "messages": [HumanMessage(content=query)],
        "isResearch": req.is_research,
    }

    try:
        result = await asyncio.to_thread(graph.invoke, initial_state, config)
        
        # breakpoint()
        last_msg = result["messages"][-1].content if result.get("messages") else ""
        options_data = None
        if req.is_research and result.get("options"):
            options_data = result["options"].get("options", [])

        return ChatResponse(
            role="assistant",
            content=last_msg,
            options=options_data,
            is_research=req.is_research
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chatbot failed: {str(e)}")