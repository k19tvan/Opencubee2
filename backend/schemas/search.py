from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel


class UnifiedSearchRequest(BaseModel):
    query_text: Optional[str] = None
    query_image_name: Optional[str] = None
    image_search_text: Optional[str] = None
    ocr_query: Optional[str] = None
    asr_query: Optional[str] = None
    page: int = 1
    page_size: int = 100
    models: Optional[List[str]] = ["bge"]
    model_weights: Optional[Dict[str, float]] = {"bge": 1.0}


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
    models: Optional[List[str]] = ["bge"]
    model_weights: Optional[Dict[str, float]] = {"bge": 1.0}
    specified_videos: Optional[List[str]] = None


class EnhanceQueryRequest(BaseModel):
    query: str
    ocr_query: Optional[str] = None
    asr_query: Optional[str] = None


class GoogleSearchRequest(BaseModel):
    query: str
