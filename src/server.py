import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.auth import router as auth_router
from src.db import get_conn
from src.status import router as status_router

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


@app.on_event("startup")
def _startup():
    get_conn()


@app.get("/api/health")
def health():
    return {"status": "ok"}
