from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from backend.core.config import AGENT_CANVAS_DIR
from backend.core import runtime
from backend.schemas.agent import AgentStartRequest

router = APIRouter()


@router.post("/agent/start")
async def start_agent_search(payload: AgentStartRequest, background_tasks: BackgroundTasks):
    try:
        from backend.services.agent import agent_graph, run_langgraph_agent_worker
    except ModuleNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Agent dependencies are not available: {exc}") from exc

    if agent_graph is None:
        raise HTTPException(status_code=503, detail="Agent dependencies are not available.")

    runtime.agent_prompts[payload.tab_id] = payload.prompt
    background_tasks.add_task(run_langgraph_agent_worker, payload.tab_id, payload.prompt)
    return {"status": "started", "tab_id": payload.tab_id}


@router.get("/agent/latest_canvas")
async def get_latest_canvas():
    canvas_dir = Path(AGENT_CANVAS_DIR)

    if not canvas_dir.exists():
        raise HTTPException(status_code=404, detail="No canvases directory found.")

    files = sorted(
        canvas_dir.glob("*.jpg"),
        key=lambda x: x.stat().st_mtime,
        reverse=True,
    )
    if not files:
        raise HTTPException(status_code=404, detail="No saved canvases available.")

    latest_file = files[0]
    return FileResponse(latest_file, media_type="image/jpeg", filename=latest_file.name)
