from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SpatialRegion = Literal[
    "auto", "full",
    "left", "right", "top", "bottom",
    "top_left", "top_right", "bottom_left", "bottom_right",
]

class TimeRange(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)


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
    time_ranges: Optional[List[TimeRange]] = None
    video_ids: Optional[List[str]] = None
    spatial_region: SpatialRegion = "auto"
    spatial_only: bool = False


class StageData(BaseModel):
    query: Optional[str] = None
    query_image_name: Optional[str] = None
    image_search_text: Optional[str] = None
    ocr_query: Optional[str] = None
    asr_query: Optional[str] = None
    spatial_region: SpatialRegion = "auto"
    spatial_only: bool = False

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
    time_ranges: Optional[List[TimeRange]] = None


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
    time_ranges: Optional[List[TimeRange]] = None
    video_ids: Optional[List[str]] = None
    search_mode: Literal["embedding", "meilisearch", "hybrid"] = "meilisearch"
    embedding_weight: float = Field(default=0.7, ge=0)
    meilisearch_weight: float = Field(default=0.3, ge=0)
    sentence_level: bool = False
