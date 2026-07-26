from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.core import runtime

router = APIRouter()


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
            elif msg_type == "agent_user_feedback":
                data = message.get("data", {})
                tab_id = data.get("tab_id")
                feedback = (data.get("message") or "").strip()
                if tab_id and feedback:
                    await runtime.manager.broadcast(json.dumps({
                        "type": "agent_log",
                        "data": {
                            "tab_id": tab_id,
                            "message": f"User feedback: {feedback}",
                        },
                    }))
                    base_prompt = runtime.agent_prompts.get(tab_id, "")
                    next_prompt = (
                        f"{base_prompt}\n\n"
                        f"Additional user feedback / clarification: {feedback}"
                    ).strip()
                    runtime.agent_prompts[tab_id] = next_prompt
                    try:
                        from backend.services.agent import agent_graph, run_langgraph_agent_worker
                    except ModuleNotFoundError:
                        agent_graph = None
                        run_langgraph_agent_worker = None
                    if agent_graph is not None and run_langgraph_agent_worker is not None:
                        asyncio.create_task(run_langgraph_agent_worker(tab_id, next_prompt))
                    else:
                        await runtime.manager.broadcast(json.dumps({
                            "type": "agent_log",
                            "data": {
                                "tab_id": tab_id,
                                "message": "ERROR: Agent dependencies are not available; feedback was received but could not restart the agent.",
                            },
                        }))
    except WebSocketDisconnect:
        runtime.manager.disconnect(websocket)
    except Exception:
        runtime.manager.disconnect(websocket)
