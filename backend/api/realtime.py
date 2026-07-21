from __future__ import annotations

import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.core import runtime

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await runtime.manager.connect(websocket)
    try:
        await websocket.send_text(json.dumps({"type": "trake_sync", "data": runtime.trake_panel_state}))
    except Exception:
        pass

    try:
        while True:
            raw_data = await websocket.receive_text()
            message = json.loads(raw_data)
            msg_type = message.get("type")

            if msg_type in ["new_frame", "remove_frame", "clear_panel"]:
                await runtime.manager.broadcast(raw_data)
            elif msg_type == "trake_add":
                shot_data = message.get("data", {}).get("shot")
                if (
                    shot_data
                    and shot_data.get("filepath")
                    and not any(item.get("filepath") == shot_data.get("filepath") for item in runtime.trake_panel_state)
                ):
                    runtime.trake_panel_state.append(shot_data)
                    await runtime.manager.broadcast(json.dumps({"type": "trake_add", "data": {"shot": shot_data}}))
            elif msg_type == "trake_remove":
                filepath = message.get("data", {}).get("filepath")
                if filepath:
                    runtime.trake_panel_state = [
                        item for item in runtime.trake_panel_state if item.get("filepath") != filepath
                    ]
                    await runtime.manager.broadcast(raw_data)
    except WebSocketDisconnect:
        runtime.manager.disconnect(websocket)
    except Exception:
        runtime.manager.disconnect(websocket)
