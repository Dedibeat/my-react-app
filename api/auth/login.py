import json
from api._db import get_conn
from api._auth import make_token, check_password
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
    if not username or not password:
        return err("Missing credentials", 400)

    cur = get_conn().cursor()
    cur.execute("SELECT id, password_hash FROM users WHERE username = ?", (username,))
    row = cur.fetchone()
    if not row or not check_password(password, row[1]):
        return err("Invalid credentials", 401)

    return ok({
        "token": make_token(row[0]),
        "user": {"id": row[0], "username": username},
    })
