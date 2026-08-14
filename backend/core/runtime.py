from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

import httpx
from fastapi import WebSocket

from backend.core.config import (
    MEILISEARCH_HOST,
    QDRANT_GRPC_PORT,
    QDRANT_HOST,
    QDRANT_PORT,
)

LOGGER = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self._connections: dict[WebSocket, asyncio.Lock] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections[websocket] = asyncio.Lock()

    def disconnect(self, websocket: WebSocket):
        self._connections.pop(websocket, None)

    async def send_text(self, websocket: WebSocket, message: str) -> bool:
        lock = self._connections.get(websocket)
        if lock is None:
            return False
        try:
            async with lock:
                await asyncio.wait_for(websocket.send_text(message), timeout=5.0)
            return True
        except Exception as exc:
            self.disconnect(websocket)
            LOGGER.debug("Removing dead WebSocket connection: %s", exc)
            return False

    async def broadcast(self, message: str):
        connections = list(self._connections)
        if connections:
            await asyncio.gather(
                *(self.send_text(connection, message) for connection in connections),
                return_exceptions=True,
            )

    @property
    def connection_count(self) -> int:
        return len(self._connections)


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
teamwork_panel_state = []
trake_panel_state = []
wrong_frames_state = []
frame_context_cache = {}
similar_frames_map = {}
frame_similarity_labels = {}
video_frame_mapping = {}
scene_frame_mapping = {}
frame_scene_ids_map = {}

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


def load_frame_similarity_labels_json():
    """Load pre-computed labels used directly by normal search results."""
    global frame_similarity_labels
    json_path = "./storage/frame_similarity_labels.json"
    if os.path.exists(json_path):
        import json
        try:
            print("--- Loading frame similarity labels into RAM (Background)... ---")
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            frame_similarity_labels = data.get("labels", data)
            print(f"--- Frame similarity labels loaded! ({len(frame_similarity_labels)} frames) ---")
        except Exception as e:
            print(f"Error loading frame similarity labels: {e}")


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


def load_video_frame_mapping_json():
    """Load the dedicated video-to-keyframe mapping used by the full timeline."""
    global video_frame_mapping
    json_path = Path(__file__).resolve().parents[2] / "storage/video_frame_mapping.json"
    try:
        import json

        with open(json_path, "r", encoding="utf-8") as file:
            data = json.load(file)
        if not isinstance(data, dict):
            raise ValueError("root value must be a JSON object")
        video_frame_mapping = data
        print(f"--- Video frame mapping loaded! ({len(data)} videos) ---")
    except Exception as e:
        video_frame_mapping = {}
        print(f"Error loading video frame mapping {json_path}: {e}")


def load_scene_frame_mapping_json():
    """Load semantic scenes and build a frame-to-scene lookup in RAM."""
    global scene_frame_mapping, frame_scene_ids_map
    json_path = Path(__file__).resolve().parents[2] / "storage/scene_frame_mapping.json"
    try:
        import json

        print("--- Loading semantic ASR scene mapping into RAM... ---")
        with open(json_path, "r", encoding="utf-8") as file:
            data = json.load(file)
        if not isinstance(data, dict):
            raise ValueError("root value must be a JSON object")

        reverse_mapping = {}
        for scene_id, scene in data.items():
            if not isinstance(scene_id, str) or not isinstance(scene, dict):
                continue
            for frame_name in scene.get("frame_inside", []):
                if isinstance(frame_name, str):
                    reverse_mapping.setdefault(frame_name, []).append(scene_id)

        scene_frame_mapping = data
        frame_scene_ids_map = reverse_mapping
        print(
            "--- Semantic ASR scene mapping loaded! "
            f"({len(data)} scenes, {len(reverse_mapping)} frames) ---"
        )
    except Exception as e:
        scene_frame_mapping = {}
        frame_scene_ids_map = {}
        print(f"Error loading semantic ASR scene mapping {json_path}: {e}")
            
def startup_runtime():
    global qdrant_client, meili_client, http_client

    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=32, max_connections=64),
    )

    import threading
    threading.Thread(target=load_frame_context_json, daemon=True).start()
    threading.Thread(target=load_similar_frames_json, daemon=True).start()
    threading.Thread(target=load_frame_similarity_labels_json, daemon=True).start()
    # This small dedicated mapping must be ready before the first timeline request.
    load_video_frame_mapping_json()
    # Semantic search needs this mapping immediately to turn scene IDs into
    # exact keyframes, so load it synchronously and avoid a startup race.
    load_scene_frame_mapping_json()


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
