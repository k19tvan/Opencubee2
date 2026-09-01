from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.media import router as media_router
from backend.api.realtime import router as realtime_router
from backend.api.search import router as search_router
from backend.api.chatbot import router as chatbot_router 
from backend.api.submission import router as submission_router
from backend.core.runtime import shutdown_runtime, startup_runtime


app = FastAPI(default_response_class=JSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media_router)
app.include_router(search_router)
app.include_router(realtime_router)
app.include_router(chatbot_router)
app.include_router(submission_router)



@app.on_event("startup")
def startup_event():
    startup_runtime()


@app.on_event("shutdown")
async def shutdown_event():
    await shutdown_runtime()
