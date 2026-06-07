import os
import sys
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
JWT_TTL_DAYS = 30


def make_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401):
        self.message = message
        self.status = status


def require_user(headers: dict) -> dict:
    from api._db import get_conn
    auth = headers.get("authorization") or headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise AuthError("Missing bearer token")
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise AuthError("Invalid token")
    cur = get_conn().cursor()
    cur.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    if not row:
        raise AuthError("User not found")
    return {"id": row[0], "username": row[1]}
