import asyncio
import os
import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.auth import router as auth_router
from src.cf_sync import router as cf_sync_router
from src.qoj_sync import router as qoj_sync_router, run_qoj_auto_sync_all
from src.db import get_conn
from src.feedback import router as feedback_router
from src.lists import router as lists_router
from src.status import router as status_router

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("problemset")

app = FastAPI(title="Problemset API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(status_router)
app.include_router(feedback_router)
app.include_router(lists_router)
app.include_router(cf_sync_router)
app.include_router(qoj_sync_router)


async def _qoj_background_worker():
    # Run a quick sync shortly after startup, then every 30 minutes
    await asyncio.sleep(5)
    await run_qoj_auto_sync_all()
    while True:
        await asyncio.sleep(1800)
        await run_qoj_auto_sync_all()


@app.on_event("startup")
async def _startup():
    get_conn()
    asyncio.create_task(_qoj_background_worker())


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    log.error("unhandled error on %s %s: %s\n%s",
              request.method, request.url.path, exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}
