from __future__ import annotations

import os
import shutil
import zipfile
from pathlib import Path
from fastapi import APIRouter, File, UploadFile, HTTPException
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/api/submission", tags=["submission"])

BASE_DIR = "/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2/SoLoaiAIC"
SUBMISSION_DIR = os.path.join(BASE_DIR, "submission")
QUERIES_DIR = os.path.join(BASE_DIR, "queries")

os.makedirs(SUBMISSION_DIR, exist_ok=True)
os.makedirs(QUERIES_DIR, exist_ok=True)

class SaveQueryRequest(BaseModel):
    csv_content: str

@router.post("/upload")
async def upload_zip(file: UploadFile = File(...)):
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="File must be a ZIP archive.")

    os.makedirs(BASE_DIR, exist_ok=True)
    os.makedirs(SUBMISSION_DIR, exist_ok=True)
    os.makedirs(QUERIES_DIR, exist_ok=True)

    temp_zip_path = os.path.join(BASE_DIR, "temp_upload.zip")
    with open(temp_zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extracted_files = []
    
    try:
        with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
            # We want to extract .txt files
            for member in zip_ref.namelist():
                if member.endswith('.txt') and not member.startswith('__MACOSX'):
                    filename = os.path.basename(member)
                    if not filename:
                        continue
                    
                    # Extract to queries
                    source = zip_ref.open(member)
                    target_path = os.path.join(QUERIES_DIR, filename)
                    with open(target_path, "wb") as target:
                        shutil.copyfileobj(source, target)
                    
                    # Create corresponding CSV in submission if it doesn't exist
                    csv_filename = os.path.splitext(filename)[0] + ".csv"
                    csv_path = os.path.join(SUBMISSION_DIR, csv_filename)
                    if not os.path.exists(csv_path):
                        with open(csv_path, "w") as f:
                            pass # empty file
                    
                    extracted_files.append(filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process zip: {str(e)}")
    finally:
        if os.path.exists(temp_zip_path):
            os.remove(temp_zip_path)

    return {"message": "Success", "extracted": extracted_files}

@router.get("/list")
async def list_queries():
    results = []
    if not os.path.exists(SUBMISSION_DIR):
        return results
        
    for filename in os.listdir(SUBMISSION_DIR):
        if filename.endswith(".csv"):
            filepath = os.path.join(SUBMISSION_DIR, filename)
            # check empty
            is_empty = True
            try:
                if os.path.getsize(filepath) > 0:
                    with open(filepath, 'r') as f:
                        content = f.read().strip()
                        if len(content) > 0:
                            is_empty = False
            except:
                pass
            
            results.append({
                "filename": filename,
                "is_empty": is_empty
            })
            
    # sort by filename naturally
    results.sort(key=lambda x: x["filename"])
    return results

@router.get("/query/{filename}")
async def get_query(filename: str):
    csv_path = os.path.join(SUBMISSION_DIR, filename)
    txt_filename = os.path.splitext(filename)[0] + ".txt"
    txt_path = os.path.join(QUERIES_DIR, txt_filename)
    
    if not os.path.exists(csv_path):
        raise HTTPException(status_code=404, detail="CSV not found")
        
    csv_content = ""
    with open(csv_path, "r", encoding="utf-8") as f:
        csv_content = f.read()
        
    query_text = ""
    if os.path.exists(txt_path):
        with open(txt_path, "r", encoding="utf-8") as f:
            query_text = f.read()
            
    return {
        "csv_content": csv_content,
        "query_text": query_text
    }

@router.post("/query/{filename}")
async def save_query(filename: str, request: SaveQueryRequest):
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Filename must end with .csv")
        
    csv_path = os.path.join(SUBMISSION_DIR, filename)
    with open(csv_path, "w", encoding="utf-8") as f:
        f.write(request.csv_content)
        
    return {"message": "Saved successfully"}
