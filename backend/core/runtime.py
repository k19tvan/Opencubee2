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
        )
        print("--- ChatGroq initialized successfully with qwen/qwen3.6-27b ---")
    except Exception as e:
        print(f"Warning: Failed to initialize ChatGroq (Ensure GROQ_API_KEY is set). Error: {e}")
        llm = None

    try:
        llm_enhance = ChatGroq(
            model="openai/gpt-oss-20b",
            temperature=0.2,
            max_tokens=1024,
            api_key=os.getenv("GROQ_API_KEY"),
            reasoning_format="hidden",
        )
        print("--- ChatGroq initialized successfully with openai/gpt-oss-20b ---")
    except Exception as e:
        print(f"Warning: Failed to initialize ChatGroq for enhance query (Ensure GROQ_API_KEY is set). Error: {e}")
        llm_enhance = None
except ModuleNotFoundError as e:
    print(f"Warning: ChatGroq dependencies are not available. Error: {e}")
    llm = None
    llm_enhance = None

qdrant_client = None
meili_client = None
http_client: Optional[httpx.AsyncClient] = None
manager = ConnectionManager()
trake_panel_state = []
agent_prompts = {}


def startup_runtime():
    global qdrant_client, meili_client, http_client

    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=32, max_connections=64),
    )

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
