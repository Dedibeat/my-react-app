import asyncio
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth import get_current_user
from src.db import get_conn

log = logging.getLogger("qoj_sync")
router = APIRouter(prefix="/api/qoj-sync", tags=["qoj-sync"])


class QojSyncBody(BaseModel):
    handle: str | None = None
    cookies: str | None = None
    auto_sync: bool | None = None
    solved: list[int] | None = None
    attempted: list[int] | None = None


def _chunked(seq, n=200):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def parse_qoj_profile_html(html: str) -> tuple[list[int], list[int]]:
    """Extract accepted and tried problem IDs from a QOJ user profile page."""
    acc_idx = -1
    for kw in ["Accepted problems", "通过的题目", "Accepted problems："]:
        idx = html.find(kw)
        if idx != -1:
            acc_idx = idx
            break

    tried_idx = -1
    for kw in ["Tried problems", "尝试过的题目", "Tried problems："]:
        idx = html.find(kw)
        if idx != -1:
            tried_idx = idx
            break

    auth_idx = -1
    for kw in ["Authored problems", "创建的题目", "Virtual Participations", "比赛"]:
        idx = html.find(kw)
        if idx != -1:
            auth_idx = idx
            break
    if auth_idx == -1:
        auth_idx = len(html)

    accepted = []
    tried = []
    if acc_idx != -1:
        end = tried_idx if (tried_idx != -1 and tried_idx > acc_idx) else auth_idx
        accepted = [int(m) for m in re.findall(r"/problem/(\d+)", html[acc_idx:end])]
    if tried_idx != -1:
        end = auth_idx if auth_idx > tried_idx else len(html)
        tried = [int(m) for m in re.findall(r"/problem/(\d+)", html[tried_idx:end])]

    return accepted, tried


def fetch_qoj_profile(handle: str, cookies: str | None = None) -> str:
    """Fetch user profile HTML from qoj.ac using browser headers and session cookies."""
    url = f"https://qoj.ac/user/profile/{urllib.parse.quote(handle)}"
    req = urllib.request.Request(url)
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    )
    req.add_header("Referer", "https://qoj.ac/")
    req.add_header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
    req.add_header("Accept-Language", "en-US,en;q=0.9")

    cookie_str = cookies or os.environ.get("QOJ_COOKIES", "")
    if cookie_str:
        req.add_header("Cookie", cookie_str)

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise HTTPException(404, f"QOJ user '{handle}' not found")
        if e.code == 403:
            raise HTTPException(403, "QOJ authentication required. Please provide your UOJSESSID cookie.")
        raise HTTPException(502, f"QOJ server error (HTTP {e.code})")
    except Exception as e:
        raise HTTPException(502, f"Could not reach QOJ: {e}")

    if "<title>Login - QOJ.ac</title>" in html or "Just a moment..." in html:
        raise HTTPException(
            401,
            "QOJ session expired or blocked by verification. Please provide your active UOJSESSID cookie."
        )

    return html


def sync_user_qoj(
    user_id: int,
    handle: str | None = None,
    cookies: str | None = None,
    auto_sync: bool | None = None,
    solved: list[int] | None = None,
    attempted: list[int] | None = None,
) -> dict:
    """Sync QOJ statuses for a given user_id and update database."""
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "SELECT qoj_handle, qoj_cookie, qoj_auto_sync FROM users WHERE id = ?",
        (user_id,),
    )
    row = cur.fetchone()
    saved_handle = row[0] if row else None
    saved_cookie = row[1] if row else None

    target_handle = (handle or "").strip() or saved_handle
    target_cookie = (cookies or "").strip() or saved_cookie

    accepted: list[int] = []
    tried: list[int] = []

    if solved is not None or attempted is not None:
        accepted = solved or []
        tried = attempted or []
    else:
        if not target_handle:
            raise HTTPException(400, "QOJ handle required")
        html = fetch_qoj_profile(target_handle, target_cookie)
        accepted, tried = parse_qoj_profile_html(html)

    # Update user record
    auto_sync_val = 1 if (auto_sync is True or (auto_sync is None and row and row[2] != 0)) else (0 if auto_sync is False else 1)
    conn.execute(
        """UPDATE users SET
           qoj_handle = COALESCE(?, qoj_handle),
           qoj_cookie = COALESCE(?, qoj_cookie),
           qoj_last_synced = CURRENT_TIMESTAMP,
           qoj_auto_sync = ?
           WHERE id = ?""",
        (target_handle, target_cookie, auto_sync_val, user_id),
    )

    # 1. AC always wins
    ac_pids = list(dict.fromkeys(accepted))
    for chunk in _chunked(ac_pids):
        values = ",".join(["(?, ?, 'AC')"] * len(chunk))
        args = [x for pid in chunk for x in (user_id, pid)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status='AC', updated_at=CURRENT_TIMESTAMP""",
            args,
        )

    # 2. Failed verdicts do not overwrite existing AC or NI
    tried_pids = [pid for pid in dict.fromkeys(tried) if pid not in set(ac_pids)]
    for chunk in _chunked(tried_pids):
        values = ",".join(["(?, ?, 'WA')"] * len(chunk))
        args = [x for pid in chunk for x in (user_id, pid)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status=excluded.status, updated_at=CURRENT_TIMESTAMP
                WHERE problem_status.status NOT IN ('AC', 'NI')""",
            args,
        )

    conn.commit()

    return {
        "handle": target_handle,
        "solved": len(ac_pids),
        "attempted": len(tried_pids),
        "total_qoj_solved": len(accepted),
        "total_qoj_attempted": len(tried),
        "auto_sync": bool(auto_sync_val),
    }


@router.post("")
def qoj_sync(body: QojSyncBody, user: dict = Depends(get_current_user)):
    return sync_user_qoj(
        user_id=user["id"],
        handle=body.handle,
        cookies=body.cookies,
        auto_sync=body.auto_sync,
        solved=body.solved,
        attempted=body.attempted,
    )


@router.get("/status")
def get_qoj_status(user: dict = Depends(get_current_user)):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT qoj_handle, qoj_last_synced, qoj_auto_sync, qoj_cookie FROM users WHERE id = ?",
        (user["id"],),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        return {"connected": False}

    handle, last_synced, auto_sync, cookie = row[0], row[1], row[2], row[3]
    cur.execute(
        "SELECT COUNT(*) FROM problem_status WHERE user_id = ? AND status = 'AC'",
        (user["id"],),
    )
    ac_count = cur.fetchone()[0]

    return {
        "connected": True,
        "handle": handle,
        "last_synced": last_synced,
        "auto_sync": bool(auto_sync != 0),
        "has_cookie": bool(cookie),
        "solved_count": ac_count,
    }


@router.delete("")
def disconnect_qoj(user: dict = Depends(get_current_user)):
    conn = get_conn()
    conn.execute(
        """UPDATE users SET
           qoj_handle = NULL,
           qoj_cookie = NULL,
           qoj_last_synced = NULL,
           qoj_auto_sync = 0
           WHERE id = ?""",
        (user["id"],),
    )
    conn.commit()
    return {"status": "disconnected"}


async def run_qoj_auto_sync_all():
    """Background task: periodically sync all users with auto_sync enabled."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT id, username, qoj_handle FROM users WHERE qoj_handle IS NOT NULL AND qoj_handle != '' AND (qoj_auto_sync = 1 OR qoj_auto_sync IS NULL)")
        users_to_sync = cur.fetchall()

        if not users_to_sync:
            return

        log.info("[QOJ Auto-Sync] Starting background sync for %d users...", len(users_to_sync))
        for uid, uname, handle in users_to_sync:
            try:
                res = sync_user_qoj(uid)
                log.info("[QOJ Auto-Sync] User '%s' (%s): %d AC, %d WA", uname, handle, res["solved"], res["attempted"])
            except Exception as e:
                log.warning("[QOJ Auto-Sync] Could not sync user '%s' (%s): %s", uname, handle, e)
    except Exception as e:
        log.error("[QOJ Auto-Sync] Background sync error: %s", e)
