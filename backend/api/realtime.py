from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.core import runtime

router = APIRouter()


def trake_frame_key(shot: dict) -> str:
    """Return the stable identity used for deduplication and ordering."""
    return shot.get("filepath") or shot.get("frame_name") or shot.get("url") or ""


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await runtime.manager.connect(websocket)
    try:
        await websocket.send_text(json.dumps({"type": "trake_sync", "data": runtime.trake_panel_state}))
        await websocket.send_text(json.dumps({"type": "wrong_frames_sync", "data": runtime.wrong_frames_state}))
    except Exception:
        pass

    try:
        while True:
            raw_data = await websocket.receive_text()
            message = json.loads(raw_data)
            msg_type = message.get("type")

            if msg_type in ["new_frame", "remove_frame", "clear_panel", "global_correct_submission"]:
                await runtime.manager.broadcast(raw_data)
            elif msg_type == "global_wrong_submission":
                shot_data = message.get("data", {}).get("shot")
                if shot_data:
                    runtime.wrong_frames_state.append(shot_data)
                    await runtime.manager.broadcast(raw_data)
            elif msg_type == "trake_add":
                shot_data = message.get("data", {}).get("shot")
                shot_key = trake_frame_key(shot_data or {})
                if (
                    shot_data
                    and shot_key
                    and not any(trake_frame_key(item) == shot_key for item in runtime.trake_panel_state)
                ):
                    runtime.trake_panel_state.append(shot_data)
                    await runtime.manager.broadcast(json.dumps({"type": "trake_add", "data": {"shot": shot_data}}))
            elif msg_type == "trake_remove":
                frame_key = message.get("data", {}).get("frame_key") or message.get("data", {}).get("filepath")
                if frame_key:
                    runtime.trake_panel_state = [
                        item for item in runtime.trake_panel_state if trake_frame_key(item) != frame_key
                    ]
                    await runtime.manager.broadcast(raw_data)
            elif msg_type == "trake_reorder":
                ordered_keys = message.get("data", {}).get("frame_keys") or []
                if not isinstance(ordered_keys, list):
                    continue
                frames_by_key = {
                    trake_frame_key(frame): frame
                    for frame in runtime.trake_panel_state
                    if trake_frame_key(frame)
                }
                reordered = [frames_by_key.pop(key) for key in ordered_keys if key in frames_by_key]
                # Keep frames concurrently added by another teammate instead of dropping them.
                reordered.extend(frames_by_key.values())
                runtime.trake_panel_state = reordered
                await runtime.manager.broadcast(json.dumps({"type": "trake_sync", "data": reordered}))
    except WebSocketDisconnect:
        runtime.manager.disconnect(websocket)
    except Exception:
        runtime.manager.disconnect(websocket)
