import os
import asyncio
import base64
import math
import uuid
import httpx
from io import BytesIO
from typing import List, Dict, Any, Optional, Literal, Annotated
from PIL import Image, ImageDraw

# LangChain & LangGraph
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import AnyMessage, ToolMessage, HumanMessage, SystemMessage
from langchain_core.runnables import Runnable, RunnableConfig
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, StateGraph, START
from langgraph.prebuilt import tools_condition, ToolNode
from langgraph.graph.message import add_messages
from langgraph.types import Command

# Search Clients
from qdrant_client import QdrantClient
import meilisearch

# --- CONFIGURATION ---
EMBED_URL = "http://localhost:2001/embed"
QDRANT_HOST = "opencubee2_qdrant"
QDRANT_PORT = 6333
QDRANT_COLLECTION_NAME = "bge_part"
MEILISEARCH_HOST = "http://opencubee2_meilisearch:7700"
OCR_INDEX_NAME = "ocr_asr_index_part"
FRAME_FOLDER = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/keyframes_beit3_096"

qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, prefer_grpc=True)
meili_client = meilisearch.Client(MEILISEARCH_HOST)

# --- SEARCH LOGIC ---

async def get_embedding(text: str):
    async with httpx.AsyncClient() as client:
        response = await client.post(EMBED_URL, data={"text_query": text})
        return response.json()["embedding"][0]

async def vector_search(query_vector: list, limit: int):
    response = await asyncio.to_thread(
        qdrant_client.query_points,
        collection_name=QDRANT_COLLECTION_NAME,
        query=query_vector,
        limit=limit,
        with_payload=True
    )
    return {hit.payload.get("frame_name"): {
        "frame_name": hit.payload.get("frame_name"),
        "score": hit.score,
        "video_id": hit.payload.get("video_id"),
        "frame_id": hit.payload.get("frame_id"),
        "shot_id": str(hit.payload.get("shot_id", "1")),
    } for hit in response.points}

def ocr_search_sync(keyword: str, limit: int):
    if not keyword: return {}
    try:
        index = meili_client.index(OCR_INDEX_NAME)
        res = index.search(keyword, {"limit": limit, "showRankingScore": True})
        return {os.path.basename(hit['file_path']): {
            "frame_name": os.path.basename(hit['file_path']),
            "score": hit.get('_rankingScore', 1.0),
            "video_id": hit['video_id'],
            "shot_id": str(hit['shot_id']),
            "frame_id": hit['frame_id']
        } for hit in res.get("hits", []) if 'file_path' in hit}
    except Exception as e:
        print(f"Meilisearch Error: {e}")
        return {}

def rerank_with_ocr_priority(vector_map, ocr_map, limit):
    """
    Logic: OCR là filter chính. 
    1. Nếu có OCR match: Ưu tiên tuyệt đối. Score = OCR_score * 0.9 + Vector_score * 0.1
    2. Nếu frame chỉ có trong Vector mà không có trong OCR: Hạ thấp ưu tiên hoặc loại bỏ.
    """
    final_results = []
    
    if not ocr_map:
        # Nếu không có từ khóa OCR hoặc không tìm thấy, trả về kết quả vector thuần túy
        return list(vector_map.values())[:limit]

    for fname, ocr_item in ocr_map.items():
        v_item = vector_map.get(fname)
        v_score = v_item['score'] if v_item else 0.0
        
        # OCR đóng vai trò quyết định (0.9), Vector bổ trợ (0.1)
        combined_score = (ocr_item['score'] * 0.9) + (v_score * 0.1)
        
        item = ocr_item.copy()
        item['score'] = combined_score
        # Mark as OCR verified
        item['source'] = 'ocr_verified'
        final_results.append(item)
        
    # Sắp xếp theo điểm số kết hợp
    return sorted(final_results, key=lambda x: x['score'], reverse=True)[:limit]

# --- TOOLS ---

@tool
async def UnifiedSearchTool(text_description: str, ocr_keyword: str = "", limit: int = 20):
    """
    Search for video frames. 
    - text_description: Visual description (e.g., 'a man in a suit').
    - ocr_keyword: Specific text appearing on screen (e.g., a sign, a name, a license plate).
    """
    # 1. Chạy song song 2 search
    emb_task = get_embedding(text_description)
    
    # Thực hiện cả 2 search đồng thời
    emb = await emb_task
    v_results_map = await vector_search(emb, limit=1000) # Lấy pool rộng để filter
    o_results_map = await asyncio.to_thread(ocr_search_sync, ocr_keyword, limit=500)
    
    # 2. Rerank với ưu tiên OCR
    final_results = rerank_with_ocr_priority(v_results_map, o_results_map, limit)
    
    return Command(
        update={
            "latest_frames": final_results,
            "retrieval_status": "success" if final_results else "empty"
        },
        value=f"Found {len(final_results)} frames. OCR filter applied for '{ocr_keyword}'."
    )

# --- NODES ---

class State(Annotated[dict, "State"]):
    messages: Annotated[list[AnyMessage], add_messages]
    latest_frames: list[dict]
    latest_canvas_base64: str | None
    retrieval_status: Literal["unexecuted", "success", "empty"]

async def canvas_node(state: State):
    frames = state.get("latest_frames", [])
    if not frames: return {"retrieval_status": "empty"}

    images = []
    for f in frames[:12]:
        path = os.path.join(FRAME_FOLDER, f["frame_name"])
        if os.path.exists(path):
            img = Image.open(path).convert("RGB")
            img.thumbnail((256, 256))
            images.append((img, f))

    if not images: return {"retrieval_status": "empty"}

    cols = 4
    rows = math.ceil(len(images) / cols)
    canvas = Image.new("RGB", (cols * 256, rows * 320), "white")
    draw = ImageDraw.Draw(canvas)

    for i, (img, info) in enumerate(images):
        x, y = (i % cols) * 256, (i // cols) * 320
        canvas.paste(img, (x, y))
        source_label = " [OCR]" if info.get('source') == 'ocr_verified' else ""
        txt = f"ID: {info['frame_id']}{source_label}\nScore: {info['score']:.2f}"
        draw.multiline_text((x + 5, y + 260), txt, fill="black")

    buffer = BytesIO()
    canvas.save(buffer, format="PNG")
    return {"latest_canvas_base64": base64.b64encode(buffer.getvalue()).decode("utf-8")}

# --- AGENT SETUP ---

llm = ChatGroq(model="llama-3.3-70b-versatile", temperature=0)

primary_assistant_prompt = ChatPromptTemplate.from_messages([
    ("system", (
        "You are a Video Retrieval Expert.\n"
        "Your primary tool is UnifiedSearchTool which uses both Visual (Vector) and Textual (OCR) signals.\n"
        "IMPORTANT: If the user provides any specific text, names, or signs, ALWAYS pass them to 'ocr_keyword'.\n"
        "OCR is treated as a high-priority filter. Results matching OCR will be ranked highest."
    )),
    MessagesPlaceholder(variable_name="messages"),
])

assistant_tools = [UnifiedSearchTool]
assistant_runnable = primary_assistant_prompt | llm.bind_tools(assistant_tools)

async def assistant_node(state: State):
    result = await assistant_runnable.ainvoke(state)
    return {"messages": [result]}

# --- GRAPH ---

builder = StateGraph(State)
builder.add_node("assistant", assistant_node)
builder.add_node("tools", ToolNode(assistant_tools))
builder.add_node("canvas", canvas_node)

builder.add_edge(START, "assistant")
builder.add_conditional_edges("assistant", tools_condition)
builder.add_edge("tools", "canvas")
builder.add_edge("canvas", "assistant")

graph = builder.compile(checkpoint=InMemorySaver())

# --- RUN ---

async def main():
    config = {"configurable": {"thread_id": str(uuid.uuid4())}}
    # Ví dụ query có OCR clue: "Find a man near a sign that says 'EXIT'"
    query = """Find the frame about the blue school gate with the text "Chương Dương" on it."""
    
    async for event in graph.astream({"messages": [HumanMessage(content=query)]}, config, stream_mode="values"):
        if "messages" in event:
            event["messages"][-1].pretty_print()

if __name__ == "__main__":
    asyncio.run(main())