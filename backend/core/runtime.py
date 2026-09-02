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
    MULTIAGENT_MODEL,
    MULTIAGENT_MODEL_API_KEY,
    MULTIAGENT_MODEL_BASE_URL,
    QDRANT_GRPC_PORT,
    QDRANT_HOST,
    QDRANT_PORT,
    MILVUS_HOST,
    MILVUS_PORT,
    VECTOR_DATABASE,
    TRANSLATE_MODEL,
    TRANSLATE_MODEL_API_KEY,
    TRANSLATE_MODEL_BASE_URL,
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


llm = None
llm_enhance = None
llm_translate = None
llm_multiagent = None

try:
    from langchain_groq import ChatGroq

    llm = ChatGroq(
        model="qwen/qwen3.6-27b",
        temperature=0.2,
        max_tokens=1024,
        api_key=os.getenv("GROQ_API_KEY"),
        reasoning_effort="none",
    )
    llm_enhance = ChatGroq(
        model="qwen/qwen3.6-27b",
        temperature=0.2,
        max_tokens=1024,
        api_key=os.getenv("GROQ_API_KEY"),
        reasoning_effort="none",
    )
    print("--- ChatGroq initialized for chat and query enhancement ---")
except Exception as exc:
    print(f"Warning: Failed to initialize ChatGroq: {exc}")

try:
    from langchain_openai import ChatOpenAI

    llm_translate = ChatOpenAI(
        model=TRANSLATE_MODEL,
        base_url=TRANSLATE_MODEL_BASE_URL,
        api_key=TRANSLATE_MODEL_API_KEY,
    )
    llm_multiagent = ChatOpenAI(
        model=MULTIAGENT_MODEL,
        base_url=MULTIAGENT_MODEL_BASE_URL,
        api_key=MULTIAGENT_MODEL_API_KEY,
        temperature=0,
    )
    print("--- ChatOpenAI initialized for translation and multi-agent retrieval ---")
except Exception as exc:
    print(f"Warning: Failed to initialize ChatOpenAI runtimes: {exc}")

qdrant_client = None
milvus_client = None
meili_client = None
http_client: Optional[httpx.AsyncClient] = None
manager = ConnectionManager()
# WebSocket handlers run concurrently. Keep shared-panel mutations and their
# broadcasts in one order so every connected client observes the same state.
realtime_state_lock = asyncio.Lock()
teamwork_panel_state = []
trake_panel_state = []
wrong_frames_state = []
frame_context_cache = {}
similar_frames_map = {}
frame_similarity_labels = {}
video_frame_mapping = {}
scene_frame_mapping = {}
frame_scene_ids_map = {}
scene_frame_mapping_sentence_level = {}
frame_scene_ids_map_sentence_level = {}

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


def _load_scene_mapping_file(filename: str):
    json_path = Path(__file__).resolve().parents[2] / f"storage/{filename}"
    try:
        import json
        print(f"--- Loading {filename} into RAM... ---")
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
        print(f"--- Loaded {filename}! ({len(data)} scenes, {len(reverse_mapping)} frames) ---")
        return data, reverse_mapping
    except Exception as e:
        print(f"Error loading {json_path}: {e}")
        return {}, {}


def load_scene_frame_mapping_json():
    """Load both standard and sentence-level semantic scenes into RAM."""
    global scene_frame_mapping, frame_scene_ids_map
    global scene_frame_mapping_sentence_level, frame_scene_ids_map_sentence_level
    scene_frame_mapping, frame_scene_ids_map = _load_scene_mapping_file("scene_frame_mapping.json")
    scene_frame_mapping_sentence_level, frame_scene_ids_map_sentence_level = _load_scene_mapping_file("scene_frame_mapping_sentence_level.json")
            
def startup_runtime():
    global qdrant_client, milvus_client, meili_client, http_client

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

    if VECTOR_DATABASE == "qdrant":
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
    else:
        try:
            from pymilvus import MilvusClient
            print(f"--- Connecting to Milvus at {MILVUS_HOST}:{MILVUS_PORT}... ---")
            milvus_client = MilvusClient(uri=f"http://{MILVUS_HOST}:{MILVUS_PORT}")
            print("--- Milvus connection successful. ---")
            
            # Load collections into RAM in background
            from backend.core.config import MODEL_CONFIGS
            def pre_load_milvus_collections():
                import time
                collections_to_load = set()
                for conf in MODEL_CONFIGS.values():
                    if "collection" in conf:
                        collections_to_load.add(conf["collection"])
                    if "spatial_collection" in conf:
                        collections_to_load.add(conf["spatial_collection"])
                
                print(f"--- Pre-loading Milvus collections into RAM: {list(collections_to_load)} ---")
                for col_name in collections_to_load:
                    try:
                        start_t = time.time()
                        milvus_client.load_collection(col_name)
                        print(f"    + Loaded {col_name} into RAM (took {time.time() - start_t:.2f}s).")
                    except Exception as e:
                        print(f"    ! Error loading {col_name}: {e}")
                print("--- Finished pre-loading all Milvus collections. ---")
            
            threading.Thread(target=pre_load_milvus_collections, daemon=True).start()
            
        except Exception as e:
            print(f"FATAL: Milvus connection failed: {e}")

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
    global http_client, milvus_client
    if http_client is not None:
        await http_client.aclose()
        http_client = None
    if milvus_client is not None:
        milvus_client.close()
        milvus_client = None
