import os
import shutil
import zipfile
import csv
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, File, UploadFile, HTTPException

router = APIRouter()

# Setup paths
PROJECT_ROOT = Path("/GuestShare_NAS/WorkingSpace/Personal/nguyenmv/HCMAIC2026/AICHALLENGE_OPENCUBEE_2")
SOLOAI_DIR = PROJECT_ROOT / "SoLoaiAIC"
SUBMISSION_DIR = SOLOAI_DIR / "submission"
os.makedirs(SOLOAI_DIR, exist_ok=True)
os.makedirs(SUBMISSION_DIR, exist_ok=True)

class SubmitRequest(BaseModel):
    query_file: str  # e.g., 'query-1-kis.txt'
    frames: List[dict] # [{ video_id, frame_id, etc. }]
    answer: Optional[str] = None # For QA
    row_index: Optional[int] = None # For updating a specific row

class DeleteRequest(BaseModel):
    query_file: str
    row_index: int

@router.post("/soloai/upload_zip")
def upload_zip(file: UploadFile = File(...)):
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Must be a .zip file")

    zip_path = SOLOAI_DIR / file.filename
    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extract_dir = SOLOAI_DIR / "queries"
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    os.makedirs(extract_dir, exist_ok=True)

    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_dir)
        
    os.remove(zip_path)
    
    # Flatten structure if it extracted a folder
    txt_files = []
    seen = set()
    for root, _, files in os.walk(extract_dir):
        for f in files:
            if f.startswith('._') or f == '.DS_Store' or '__MACOSX' in root:
                continue
                
            # Match any file containing 'query' to be safe, since they might lack extension
            if f.endswith('.csv'):
                src = os.path.join(root, f)
                dst = os.path.join(SUBMISSION_DIR, f)
                if src != dst:
                    shutil.copy2(src, dst)
            elif 'query' in f.lower() or f.endswith('.txt'):
                src = os.path.join(root, f)
                # Ensure they have .txt extension for consistency
                if not f.endswith('.txt'):
                    new_f = f + ".txt"
                else:
                    new_f = f
                
                dst = os.path.join(extract_dir, new_f)
                if src != dst:
                    shutil.move(src, dst)
                if new_f not in seen:
                    txt_files.append(new_f)
                    seen.add(new_f)
                    
    # Clean up empty directories after moving
    for root, dirs, _ in os.walk(extract_dir, topdown=False):
        for d in dirs:
            try:
                os.rmdir(os.path.join(root, d))
            except OSError:
                pass
                
    # Initialize empty CSVs
    os.makedirs(SUBMISSION_DIR, exist_ok=True)
    for txt in txt_files:
        csv_name = txt.replace(".txt", ".csv")
        csv_path = SUBMISSION_DIR / csv_name
        if not csv_path.exists():
            with open(csv_path, 'w', encoding='utf-8') as f:
                pass

    return {"message": "Success", "queries": txt_files}

@router.get("/soloai/queries")
def get_queries():
    extract_dir = SOLOAI_DIR / "queries"
    os.makedirs(extract_dir, exist_ok=True)
    os.makedirs(SUBMISSION_DIR, exist_ok=True)
    
    # Ensure any txt query without a csv has an initialized csv file
    for txt_file in os.listdir(extract_dir):
        if txt_file.endswith(".txt"):
            c_name = txt_file.replace(".txt", ".csv")
            c_path = SUBMISSION_DIR / c_name
            if not c_path.exists():
                with open(c_path, 'w', encoding='utf-8') as f:
                    pass

    # We use CSV files in SUBMISSION_DIR as the source of truth
    csv_files = [f for f in os.listdir(SUBMISSION_DIR) if f.endswith('.csv')]
    
    queries = []
    for csv_f in csv_files:
        base_name = csv_f.replace(".csv", "")
        txt_name = base_name + ".txt"
        
        content = ""
        txt_path = extract_dir / txt_name
        if txt_path.exists():
            with open(txt_path, 'r', encoding='utf-8') as txt_file:
                content = txt_file.read()
                
        csv_path = SUBMISSION_DIR / csv_f
        submissions = []
        if csv_path.exists():
            with open(csv_path, 'r', encoding='utf-8') as csv_file:
                reader = csv.reader(csv_file)
                for row in reader:
                    # Only include non-empty rows
                    if row and any(cell.strip() for cell in row):
                        submissions.append(row)
                    
        # Give it a filename that includes .txt to match the front-end logic temporarily
        queries.append({
            "filename": txt_name,
            "content": content,
            "submissions": submissions
        })
            
    # Sort queries logically by name 
    queries.sort(key=lambda x: x["filename"])
    return {"queries": queries}

class CreateQueryRequest(BaseModel):
    query_name: str

@router.post("/soloai/query")
def create_query(req: CreateQueryRequest):
    if not req.query_name:
        raise HTTPException(status_code=400, detail="Name required")
    # Clean name
    safe_name = req.query_name.replace(".csv", "").replace(".txt", "")
    csv_path = SUBMISSION_DIR / f"{safe_name}.csv"
    os.makedirs(SUBMISSION_DIR, exist_ok=True)
    if not csv_path.exists():
        with open(csv_path, 'w', encoding='utf-8') as f:
            pass
    return {"message": "Success"}

@router.delete("/soloai/query/{query_name}")
def delete_query(query_name: str):
    safe_name = query_name.replace(".txt", "").replace(".csv", "")
    
    csv_path = SUBMISSION_DIR / f"{safe_name}.csv"
    if csv_path.exists():
        os.remove(csv_path)
        
    txt_path = SOLOAI_DIR / "queries" / f"{safe_name}.txt"
    if txt_path.exists():
        os.remove(txt_path)
        
    return {"message": "Success"}

@router.post("/soloai/submit")
def submit(req: SubmitRequest):
    csv_name = req.query_file.replace(".txt", ".csv")
    csv_path = SUBMISSION_DIR / csv_name
    os.makedirs(SUBMISSION_DIR, exist_ok=True)
    
    # Determine type
    is_qa = "qa" in req.query_file.lower()
    is_trake = "trake" in req.query_file.lower()
    
    new_rows = []
    if is_trake:
        if len(req.frames) > 0:
            video_id = req.frames[0]["video_id"]
            row = [video_id]
            for frame in req.frames:
                if frame["video_id"] != video_id:
                    raise HTTPException(status_code=400, detail="TRAKE events must be from the same video")
                row.append(str(frame["frame_id"]))
            new_rows.append(row)
    elif is_qa:
        if len(req.frames) > 0:
            for frame in req.frames:
                ans = frame.get("answer", req.answer)
                if not ans:
                    raise HTTPException(status_code=400, detail="Q&A requires an answer")
                new_rows.append([frame["video_id"], str(frame["frame_id"]), ans])
    else: # KIS
        if len(req.frames) > 0:
            for frame in req.frames:
                new_rows.append([frame["video_id"], str(frame["frame_id"])])
        
    existing_rows = []
    if csv_path.exists():
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            existing_rows = list(reader)

    if is_trake:
        if req.row_index is not None and 0 <= req.row_index < len(existing_rows):
            if len(new_rows) == 1:
                existing_rows[req.row_index] = new_rows[0]
            else:
                existing_rows[req.row_index:req.row_index+1] = new_rows
        else:
            existing_rows.extend(new_rows)
    else:
        # KIS and QA overwrites entirely since the frontend sends the full staging panel.
        existing_rows = new_rows

    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(existing_rows)
        
    return {"message": "Success", "rows": existing_rows}

@router.delete("/soloai/submit")
def delete_submit(req: DeleteRequest):
    csv_name = req.query_file.replace(".txt", ".csv")
    csv_path = SUBMISSION_DIR / csv_name
    
    if not csv_path.exists():
        raise HTTPException(status_code=404, detail="CSV not found")
        
    rows = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        rows = list(reader)
        
    if req.row_index < 0 or req.row_index >= len(rows):
        raise HTTPException(status_code=400, detail="Invalid row index")
        
    rows.pop(req.row_index)
    
    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(rows)
        
    return {"message": "Success"}
