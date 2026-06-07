import json
from api._db import get_conn
from api._auth import make_token, hash_password
from api._util import ok, err, preflight


def handler(request):
    if request.get("method") == "OPTIONS":
        return preflight()

    try:
        body = json.loads(request.get("body") or "{}")
    except json.JSONDecodeError:
        return err("Invalid JSON body")

    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if len(username) < 3 or len(password) < 6:
        return err("Username must be 3+ chars, password 6+ chars", 400)

    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, hash_password(password)),
        )
        conn.commit()
    except Exception as e:
        if "UNIQUE" in str(e):
            return err("Username already taken", 409)
        raise

    user_id = cur.lastrowid
    return ok({
        "token": make_token(user_id),
        "user": {"id": user_id, "username": username},
    })
