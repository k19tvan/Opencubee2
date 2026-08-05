from __future__ import annotations

import os
from typing import Optional

import httpx
from fastapi import WebSocket

from backend.core.config import (
    MEILISEARCH_HOST,
    QDRANT_GRPC_PORT,
    QDRANT_HOST,
    QDRANT_PORT,
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                pass


try:
    from langchain_groq import ChatGroq

    try:
        llm = ChatGroq(
            model="qwen/qwen3.6-27b",
            temperature=0.2,
            max_tokens=1024,
            api_key=os.getenv("GROQ_API_KEY"),
            reasoning_effort="none"
        )
        print("--- ChatGroq initialized successfully with qwen/qwen3.6-27b ---")
    except Exception as e:
        print(f"Warning: Failed to initialize ChatGroq (Ensure GROQ_API_KEY is set). Error: {e}")
        llm = None

    try:
        llm_enhance = ChatGroq(
            model="qwen/qwen3.6-27b",
            temperature=0.2,
            max_tokens=1024,
            api_key=os.getenv("GROQ_API_KEY"),
            reasoning_effort="none"
        )
        print("--- ChatGroq initialized successfully with qwen/qwen3.6-27b, used as enhancer ---")
    except Exception as e:
        print(f"Warning: Failed to initialize ChatGroq for Enhance. Error: {e}")
        llm_enhance = None

    # try:
    #     llm_translate = ChatGroq(
    #         model="qwen/qwen3.6-27b",
    #         temperature=0.2,
    #         max_tokens=1024,
    #         api_key=os.getenv("GROQ_API_KEY"),
    #         reasoning_effort="none"
    #     )
    #     print("--- ChatGroq initialized successfully with qwen/qwen3.6-27b, used as translator ---")
    # except Exception as e:
    #     print(f"Warning: Failed to initialize ChatGroq for Translator. Error: {e}")
    #     llm_translate = None

    
    try:
        from langchain_openai import ChatOpenAI
        llm_translate = ChatOpenAI(
            model=os.getenv("TRANSLATE_MODEL", "qwen3-vl-8b"),
            base_url=os.getenv("TRANSLATE_MODEL_BASE_URL", "http://192.168.20.150:2108/v1"),
            api_key="EMPTY",
        )

        print("--- ChatOpenAI initialized successfully with " + llm_translate.model + ", Using as Translator---")
    except Exception as e:
        print(f"Warning: Failed to initialize ChatOpenAI for Translation Error: {e}")
        llm_translate = None

except ModuleNotFoundError as e:
    print(f"Warning: ChatOpenAI dependencies are not available. Error: {e}")
    llm = None
    llm_enhance = None
    llm_translate = None

qdrant_client = None
meili_client = None
http_client: Optional[httpx.AsyncClient] = None
manager = ConnectionManager()
trake_panel_state = []
wrong_frames_state = []
frame_context_cache = {}
similar_frames_map = {}

def load_similar_frames_json():
    global similar_frames_map
    json_path = "./storage/similar_frames.json"
    if os.path.exists(json_path):
        import json
        try:
            print("--- Loading similar frames JSON into RAM (Background)... ---")
            with open(json_path, 'r', encoding='utf-8') as f:
                similar_frames_map = json.load(f)
            print(f"--- Similar frames JSON loaded! ({len(similar_frames_map)} entries) ---")
        except Exception as e:
            print(f"Error loading similar frames JSON: {e}")


def load_frame_context_json():
    global frame_context_cache
    json_path = "./storage/frame_context.json"
    if os.path.exists(json_path):
        import json
        try:
            print("--- Loading frame context JSON into RAM (Background)... ---")
            with open(json_path, 'r', encoding='utf-8') as f:
                frame_context_cache = json.load(f)
            print("--- Frame context JSON loaded successfully into RAM! ---")
        except Exception as e:
            print(f"Error loading frame context JSON: {e}")



def startup_runtime():
    global qdrant_client, meili_client, http_client

    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=32, max_connections=64),
    )

    import threading
    threading.Thread(target=load_frame_context_json, daemon=True).start()
    threading.Thread(target=load_similar_frames_json, daemon=True).start()


    try:
        from qdrant_client import QdrantClient

        print(f"--- Connecting to Qdrant at {QDRANT_HOST} (gRPC: {QDRANT_GRPC_PORT})... ---")
        qdrant_client = QdrantClient(
            host=QDRANT_HOST,
            port=QDRANT_PORT,
            grpc_port=QDRANT_GRPC_PORT,
            prefer_grpc=True,
            timeout=120.0,
        )
        print("--- Qdrant connection successful. ---")
    except Exception as e:
        print(f"FATAL: Qdrant connection failed: {e}")

    try:
        import meilisearch

        print(f"--- Connecting to Meilisearch at {MEILISEARCH_HOST}... ---")
        meili_client = meilisearch.Client(MEILISEARCH_HOST)
        if meili_client.is_healthy():
            print("--- Meilisearch connection successful. ---")
        else:
            print("FATAL: Could not connect to Meilisearch.")
            meili_client = None
    except Exception as e:
        print(f"FATAL: Could not connect to Meilisearch. Error: {e}")
        meili_client = None


async def shutdown_runtime():
    global http_client
    if http_client is not None:
        await http_client.aclose()
        http_client = None
