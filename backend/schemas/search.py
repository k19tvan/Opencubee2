from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class UnifiedSearchRequest(BaseModel):
    query_text: Optional[str] = None
    query_image_name: Optional[str] = None
    image_search_text: Optional[str] = None
    ocr_query: Optional[str] = None
    asr_query: Optional[str] = None
    page: int = 1
    page_size: int = 100
    models: Optional[List[str]] = ["beit3"]
    model_weights: Optional[Dict[str, float]] = {"beit3": 1.0}
    # When set, every retrieval mode is restricted to these keyframes.
    candidate_frame_names: Optional[List[str]] = None
    video_ids: Optional[List[str]] = None


class StageData(BaseModel):
    query: Optional[str] = None
    query_image_name: Optional[str] = None
    image_search_text: Optional[str] = None
    ocr_query: Optional[str] = None
    asr_query: Optional[str] = None

class TemporalSearchRequest(BaseModel):
    stages: List[StageData]
    cluster: bool = False
    ambiguous: bool = False
    page: int = 1
    page_size: int = 100
    models: Optional[List[str]] = ["beit3"]
    model_weights: Optional[Dict[str, float]] = {"beit3": 1.0}
    specified_videos: Optional[List[str]] = None
    # Persistent similarity-search scope supplied by the UI.
    video_ids: Optional[List[str]] = None
    candidate_frame_names: Optional[List[str]] = None


class EnhanceQueryRequest(BaseModel):
    query: str
    ocr_query: Optional[str] = None
    asr_query: Optional[str] = None
    literal_translate: bool = False

class SemanticAsrSearchRequest(BaseModel):
    query_text: str
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)
    candidate_frame_names: Optional[List[str]] = None
    video_ids: Optional[List[str]] = None
