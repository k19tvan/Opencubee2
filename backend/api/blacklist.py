from fastapi import APIRouter, HTTPException
import json
import os
from pydantic import BaseModel
from backend.core import runtime
from backend.services.search import get_stored_vector, search_qdrant

router = APIRouter(prefix="/blacklist", tags=["blacklist"])

class BlacklistAddRequest(BaseModel):
    frame_name: str

@router.get("/")
def get_blacklist():
    return {"sources": list(runtime.blacklist_sources.keys()), "sources_data": runtime.blacklist_sources}

@router.post("/")
async def add_to_blacklist(req: BlacklistAddRequest):
    frame_name = req.frame_name
    if frame_name in runtime.blacklist_sources:
        return {"msg": "Already blacklisted"}

    # 1. Get embedding
    vector = await get_stored_vector(frame_name, "beit3")
    if not vector:
        raise HTTPException(404, f"Vector for {frame_name} not found in beit3")

    # 2. Search for score >= 0.99
    results = await search_qdrant(vector, "beit3", limit=1000)
    
    similar_frames = [res["frame_name"] for res in results if res["score"] >= 0.99]
    if frame_name not in similar_frames:
        similar_frames.append(frame_name)
        
    # 3. Add to sets
    runtime.blacklist_sources[frame_name] = {
        "frame_name": frame_name,
        "count_banned": len(similar_frames)
    }
    runtime.banned_frames.update(similar_frames)
    
    # 4. Save to JSON
    banned_path = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/blacklisted_frames.json"
    sources_path = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/blacklist_sources.json"
    
    with open(banned_path, "w", encoding="utf-8") as f:
        json.dump(list(runtime.banned_frames), f)
    with open(sources_path, "w", encoding="utf-8") as f:
        json.dump(runtime.blacklist_sources, f)
        
    return {"msg": f"Added {frame_name} and banned {len(similar_frames)} similar frames", "banned_frames_count": len(runtime.banned_frames)}

@router.delete("/{frame_name}")
async def remove_from_blacklist(frame_name: str):
    if frame_name not in runtime.blacklist_sources:
        raise HTTPException(404, "Not in blacklist sources")
        
    del runtime.blacklist_sources[frame_name]
    
    # We must recalculate the ENTIRE banned_frames set because we don't know which source added which frame (sets overlap)
    runtime.banned_frames.clear()
    
    for source_fname in list(runtime.blacklist_sources.keys()):
        vector = await get_stored_vector(source_fname, "beit3")
        if vector:
            results = await search_qdrant(vector, "beit3", limit=1000)
            similar_frames = [res["frame_name"] for res in results if res["score"] >= 0.99]
            if source_fname not in similar_frames:
                similar_frames.append(source_fname)
            runtime.banned_frames.update(similar_frames)
            
    # Save
    banned_path = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/blacklisted_frames.json"
    sources_path = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/results/blacklist_sources.json"
    
    with open(banned_path, "w", encoding="utf-8") as f:
        json.dump(list(runtime.banned_frames), f)
    with open(sources_path, "w", encoding="utf-8") as f:
        json.dump(runtime.blacklist_sources, f)
        
    return {"msg": f"Removed {frame_name}, re-calculated banned frames to {len(runtime.banned_frames)}"}
