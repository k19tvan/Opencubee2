from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.core import runtime

router = APIRouter()
LOGGER = logging.getLogger(__name__)

MAX_MESSAGE_BYTES = 12 * 1024 * 1024
MAX_TEAMWORK_FRAMES = 200
MAX_WRONG_FRAMES = 200
MAX_TRAKE_FRAMES = 200


def frame_key(shot: dict[str, Any] | None) -> str:
    """Return the stable identity used for deduplication and ordering."""
    if not isinstance(shot, dict):
        return ""
    return str(shot.get("filepath") or shot.get("frame_name") or shot.get("url") or "")


def teamwork_frame_key(frame: dict[str, Any] | None) -> str:
    if not isinstance(frame, dict):
        return ""
    return frame_key(frame.get("shot"))


def encode_message(message_type: str, data: Any) -> str:
    return json.dumps(
        {"type": message_type, "data": data},
        ensure_ascii=False,
        separators=(",", ":"),
    )


async def send_event(websocket: WebSocket, message_type: str, data: Any) -> bool:
    return await runtime.manager.send_text(websocket, encode_message(message_type, data))


async def broadcast_event(message_type: str, data: Any) -> None:
    await runtime.manager.broadcast(encode_message(message_type, data))


async def send_error(websocket: WebSocket, detail: str) -> None:
    await send_event(websocket, "error", {"detail": detail})


def remove_matching_teamwork_frames(criteria: dict[str, Any]) -> None:
    keys = {
        str(criteria.get(field))
        for field in ("filepath", "frame_name", "url")
        if criteria.get(field)
    }
    if not keys:
        return
    runtime.teamwork_panel_state = [
        frame
        for frame in runtime.teamwork_panel_state
        if frame_key(frame.get("shot") if isinstance(frame, dict) else None) not in keys
        and not keys.intersection(
            {
                str(value)
                for value in (
                    (frame.get("shot") or {}).get("filepath"),
                    (frame.get("shot") or {}).get("frame_name"),
                    (frame.get("shot") or {}).get("url"),
                )
                if value
            }
        )
    ]


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await runtime.manager.connect(websocket)
    LOGGER.info("WebSocket connected; active=%d", runtime.manager.connection_count)

    try:
        # Serialize the initial snapshot with mutations. Otherwise a newly
        # connected client can receive a newer event followed by an older sync.
        async with runtime.realtime_state_lock:
            synced = await send_event(websocket, "team_sync", runtime.teamwork_panel_state)
            synced = synced and await send_event(websocket, "trake_sync", runtime.trake_panel_state)
            synced = synced and await send_event(websocket, "wrong_frames_sync", runtime.wrong_frames_state)
        if not synced:
            return

        while True:
            raw_data = await websocket.receive_text()
            if len(raw_data.encode("utf-8")) > MAX_MESSAGE_BYTES:
                await websocket.close(code=1009, reason="WebSocket message is too large")
                return

            try:
                message = json.loads(raw_data)
            except json.JSONDecodeError:
                await send_error(websocket, "Message must be valid JSON.")
                continue

            if not isinstance(message, dict):
                await send_error(websocket, "Message must be a JSON object.")
                continue

            msg_type = message.get("type")
            data = message.get("data") or {}
            if not isinstance(data, dict):
                await send_error(websocket, "Message data must be a JSON object.")
                continue

            if msg_type == "ping":
                await send_event(websocket, "pong", {"timestamp": data.get("timestamp")})

            elif msg_type == "new_frame":
                shot = data.get("shot")
                key = frame_key(shot)
                if not isinstance(shot, dict) or not key:
                    await send_error(websocket, "new_frame requires a shot with a stable key.")
                    continue
                async with runtime.realtime_state_lock:
                    if not any(teamwork_frame_key(frame) == key for frame in runtime.teamwork_panel_state):
                        runtime.teamwork_panel_state.insert(0, data)
                        del runtime.teamwork_panel_state[MAX_TEAMWORK_FRAMES:]
                    # Full snapshots make the server authoritative and repair
                    # clients that missed an earlier incremental event.
                    await broadcast_event("team_sync", runtime.teamwork_panel_state)

            elif msg_type == "remove_frame":
                async with runtime.realtime_state_lock:
                    remove_matching_teamwork_frames(data)
                    await broadcast_event("team_sync", runtime.teamwork_panel_state)

            elif msg_type == "clear_panel":
                async with runtime.realtime_state_lock:
                    runtime.teamwork_panel_state = []
                    await broadcast_event("team_sync", runtime.teamwork_panel_state)

            elif msg_type == "global_correct_submission":
                shot = data.get("shot")
                if not isinstance(shot, dict) or not frame_key(shot):
                    await send_error(websocket, "global_correct_submission requires a valid shot.")
                    continue
                async with runtime.realtime_state_lock:
                    runtime.wrong_frames_state = []
                    runtime.teamwork_panel_state = [data]
                    await broadcast_event("global_correct_submission", data)

            elif msg_type == "global_wrong_submission":
                shot = data.get("shot")
                key = frame_key(shot)
                if not isinstance(shot, dict) or not key:
                    await send_error(websocket, "global_wrong_submission requires a valid shot.")
                    continue
                async with runtime.realtime_state_lock:
                    if not any(frame_key(item) == key for item in runtime.wrong_frames_state):
                        runtime.wrong_frames_state.insert(0, shot)
                        del runtime.wrong_frames_state[MAX_WRONG_FRAMES:]
                    await broadcast_event("global_wrong_submission", data)

            elif msg_type == "trake_update_state":
                query_file = data.get("query_file")
                full_state = data.get("full_state")
                if not query_file or not isinstance(full_state, list):
                    await send_error(websocket, "trake_update_state requires query_file and full_state as a list.")
                    continue
                async with runtime.realtime_state_lock:
                    runtime.trake_panel_state[query_file] = full_state
                    await broadcast_event("trake_sync", runtime.trake_panel_state)

            elif msg_type == "join_query":
                query_file = data.get("query_file")
                old_query = runtime.connection_active_queries.get(websocket)
                
                if query_file:
                    runtime.connection_active_queries[websocket] = query_file
                elif websocket in runtime.connection_active_queries:
                    del runtime.connection_active_queries[websocket]
                    
                if old_query and old_query != query_file:
                    async with runtime.realtime_state_lock:
                        count = sum(1 for v in runtime.connection_active_queries.values() if v == old_query)
                        if count == 0 and old_query in runtime.trake_panel_state:
                            del runtime.trake_panel_state[old_query]
                            await broadcast_event("trake_clear", {"query_file": old_query})
                            await broadcast_event("trake_sync", runtime.trake_panel_state)

            elif msg_type == "soloai_submitted":
                await broadcast_event("soloai_submitted", data)

            elif msg_type == "force_clear_draft":
                query_file = data.get("query_file")
                if query_file:
                    async with runtime.realtime_state_lock:
                        if query_file in runtime.trake_panel_state:
                            del runtime.trake_panel_state[query_file]
                        await broadcast_event("trake_clear", {"query_file": query_file})

            else:
                await send_error(websocket, f"Unsupported message type: {msg_type!r}.")

    except WebSocketDisconnect:
        pass
    except Exception:
        LOGGER.exception("Unhandled WebSocket error")
    finally:
        old_query = runtime.connection_active_queries.pop(websocket, None)
        runtime.manager.disconnect(websocket)
        LOGGER.info("WebSocket disconnected; active=%d", runtime.manager.connection_count)
        
        if old_query:
            async with runtime.realtime_state_lock:
                count = sum(1 for v in runtime.connection_active_queries.values() if v == old_query)
                if count == 0 and old_query in runtime.trake_panel_state:
                    del runtime.trake_panel_state[old_query]
                    await broadcast_event("trake_clear", {"query_file": old_query})
                    await broadcast_event("trake_sync", runtime.trake_panel_state)
