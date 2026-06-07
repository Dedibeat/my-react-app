import json
from api._db import get_conn
from api._auth import require_user, AuthError
from api._util import ok, err, preflight

ALLOWED_STATUSES = {"AC", "WA", "TL", "RE", "NI", "No submission", ""}


def _problem_id(request) -> int | None:
    q = request.get("query") or {}
    raw = q.get("id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def handler(request):
    if request.get("method") == "OPTIONS":
        return preflight()

    try:
        user = require_user(request.get("headers") or {})
    except AuthError as e:
        return err(e.message, e.status)

    method = request.get("method")
    conn = get_conn()
    cur = conn.cursor()

    if method == "GET":
        cur.execute(
            "SELECT problem_id, status FROM problem_status WHERE user_id = ?",
            (user["id"],),
        )
        return ok({str(pid): status for pid, status in cur.fetchall()})

    if method in ("PUT", "POST"):
        try:
            body = json.loads(request.get("body") or "{}")
        except json.JSONDecodeError:
            return err("Invalid JSON body")

        pid = _problem_id(request)
        if pid is None:
            return err("Missing or invalid problem_id", 400)

        if method == "POST":
            return _upsert(conn, user["id"], pid, body.get("status") or "")

        status = body.get("status")
        if status is None:
            return err("Missing status", 400)
        return _upsert(conn, user["id"], pid, status)

    if method == "DELETE":
        pid = _problem_id(request)
        if pid is None:
            return err("Missing or invalid problem_id", 400)
        conn.execute(
            "DELETE FROM problem_status WHERE user_id = ? AND problem_id = ?",
            (user["id"], pid),
        )
        conn.commit()
        return ok({"ok": True})

    return err("Method not allowed", 405)


def _upsert(conn, user_id: int, problem_id: int, status: str):
    if status not in ALLOWED_STATUSES:
        return err(f"Invalid status: {status!r}", 400)
    conn.execute(
        """INSERT INTO problem_status (user_id, problem_id, status)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, problem_id) DO UPDATE SET
             status = excluded.status,
             updated_at = CURRENT_TIMESTAMP""",
        (user_id, problem_id, status),
    )
    conn.commit()
    return ok({"ok": True})
