import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from src.db import get_conn

router = APIRouter(prefix="/api/auth", tags=["auth"])

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
JWT_TTL_DAYS = 30


class Credentials(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str


def _make_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def get_current_user(authorization: str | None = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    user_id = int(payload["sub"])
    cur = get_conn().cursor()
    cur.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(401, "User not found")
    return {"id": row[0], "username": row[1]}


@router.post("/signup")
def signup(body: Credentials):
    if len(body.username) < 3 or len(body.password) < 6:
        raise HTTPException(400, "Username must be 3+ chars, password 6+ chars")
    conn = get_conn()
    cur = conn.cursor()
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    try:
        cur.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (body.username, pw_hash),
        )
        conn.commit()
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(409, "Username already taken")
        raise
    user_id = cur.lastrowid
    return {
        "token": _make_token(user_id),
        "user": {"id": user_id, "username": body.username},
    }


@router.post("/login")
def login(body: Credentials):
    cur = get_conn().cursor()
    cur.execute("SELECT id, password_hash FROM users WHERE username = ?", (body.username,))
    row = cur.fetchone()
    if not row or not bcrypt.checkpw(body.password.encode(), row[1].encode()):
        raise HTTPException(401, "Invalid credentials")
    return {
        "token": _make_token(row[0]),
        "user": {"id": row[0], "username": body.username},
    }


@router.get("/me", response_model=UserOut)
def me(user: dict = Depends(get_current_user)):
    return user
