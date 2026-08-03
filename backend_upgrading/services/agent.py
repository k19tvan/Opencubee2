import os
import base64
import asyncio
import json
from pathlib import Path
from typing import Annotated, TypedDict, List, Optional

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

from backend.core import runtime
from backend.core.config import AGENT_CANVAS_DIR
from backend.services.search import search_all_models, fuse_results
from backend.services.media import resolve_keyframe_path, generate_grid_canvas

# --- State ---
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    tab_id: str
    loop_count: int
    current_shots: List[dict]
    next_step: str # "search", "clarify", "final"

# --- Nodes ---

async def thought_node(state: AgentState):
    """Sử dụng Qwen 3.6 để suy luận bước tiếp theo."""
    # Lấy message cuối để xem có phải là quan sát từ VLM không
    llm = runtime.llm 
    
    system_msg = (
        "You are an AI Video Retrieval Agent. Analyze the user's request and findings.\n"
        "Available Actions:\n"
        "1. SEARCH: If you need to find frames. Provide a visual description.\n"
        "2. FINAL: If the target is found in the canvas. Identify the index.\n"
        "3. CLARIFY: If the request is ambiguous, ask the user.\n"
        "Response format: ACTION: <TYPE> | CONTENT: <text>"
    )
    
    response = await llm.ainvoke([HumanMessage(content=system_msg)] + state['messages'])
    content = response.content.upper()
    
    next_step = "search"
    if "ACTION: FINAL" in content: next_step = "final"
    elif "ACTION: CLARIFY" in content: next_step = "clarify"
    
    return {"next_step": next_step, "messages": [response]}

async def search_node(state: AgentState):
    """Action: Thực hiện tìm kiếm."""
    last_msg = state['messages'][-1].content
    # Trích xuất query từ thought (giản lược)
    query = state['messages'][0].content 
    
    # Search Top 20 để làm Canvas
    results_by_model = await search_all_models(["bge", "jina_v5_omni"], text=query, limit=20)
    fused = fuse_results(results_by_model, {"bge": 0.5, "jina_v5_omni": 0.5})
    
    return {"current_shots": fused[:20], "loop_count": state['loop_count'] + 1}

async def observe_node(state: AgentState):
    """Observe: Tạo Canvas và dùng Qwen Vision phân tích."""
    tab_id = state['tab_id']
    shots = state['current_shots']
    
    # 1. Chuẩn bị ảnh
    image_paths = []
    valid_shots = []
    for s in shots:
        p = await resolve_keyframe_path(s)
        if p and p.exists():
            image_paths.append(p)
            valid_shots.append(s)
            
    # 2. Tạo Grid Canvas (Tối ưu tốc độ)
    canvas_path = Path(AGENT_CANVAS_DIR) / f"{tab_id}_v{state['loop_count']}.jpg"
    await asyncio.to_thread(generate_grid_canvas, image_paths, canvas_path)
    
    # 3. Gửi Grid cho Qwen (VLM)
    with open(canvas_path, "rb") as f:
        b64_img = base64.b64encode(f.read()).decode("utf-8")
    
    vlm_msg = HumanMessage(content=[
        {"type": "text", "text": f"Analyze this 5x4 grid. Query: {state['messages'][0].content}. Does any frame match? If yes, specify index 1-20."},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64_img}"}}
    ])
    
    # Broadcast kết quả trung gian về UI qua WebSocket
    await runtime.manager.broadcast(json.dumps({
        "type": "agent_observation",
        "data": {
            "tab_id": tab_id,
            "image": f"/agent/latest_canvas?tab_id={tab_id}&v={state['loop_count']}",
            "shots": valid_shots,
            "step": state['loop_count']
        }
    }))
    
    # Qwen phân tích canvas
    vlm_res = await runtime.llm.ainvoke([vlm_msg])
    return {"messages": [vlm_res]}

# --- Graph ---

def get_agent_graph():
    builder = StateGraph(AgentState)
    builder.add_node("thought", thought_node)
    builder.add_node("search", search_node)
    builder.add_node("observe", observe_node)
    
    builder.add_edge(START, "thought")
    
    def route(state):
        if state['loop_count'] >= 3: return END
        if state['next_step'] == "search": return "search"
        return END # clarify hoặc final
    
    builder.add_conditional_edges("thought", route)
    builder.add_edge("search", "observe")
    builder.add_edge("observe", "thought")
    
    return builder.compile()

agent_graph = get_agent_graph()

async def run_langgraph_agent_worker(tab_id: str, prompt: str):
    config = {"configurable": {"thread_id": tab_id}}
    inputs = {
        "messages": [HumanMessage(content=prompt)],
        "tab_id": tab_id,
        "loop_count": 0,
        "current_shots": [],
        "next_step": "search"
    }
    
    async for event in agent_graph.astream(inputs, config):
        for node, data in event.items():
            if "messages" in data:
                # Gửi log tiến trình về UI
                await runtime.manager.broadcast(json.dumps({
                    "type": "agent_log",
                    "data": {"tab_id": tab_id, "message": f"Agent {node}: {data['messages'][-1].content[:150]}..."}
                }))