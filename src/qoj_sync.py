import asyncio
import hashlib
import http.cookiejar
import logging
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth import get_current_user
from src.db import get_conn

log = logging.getLogger("qoj_sync")
router = APIRouter(prefix="/api/qoj-sync", tags=["qoj-sync"])

# QOJ only shows profiles to logged-in users. The server logs in with one service
# account (QOJ_USERNAME / QOJ_PASSWORD env vars) and reads anyone's profile by handle,
# so users only give their handle. Login flow (QOJ 4.5.46): GET /login, take the
# `_token` literal from the page's JavaScript, POST it with md5(password); the reply
# body is "ok" on success. The session lives in this process's cookie jar and is
# renewed whenever a page comes back as the login page.
BASE = "https://qoj.ac"
USER_AGENT = (  # QOJ answers 403 to non-browser user agents
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)
_TOKEN_RE = re.compile(r'_token\s*:\s*"([A-Za-z0-9]{60})"')
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
_login_lock = threading.Lock()


class QojSyncBody(BaseModel):
    handle: str | None = None


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


def _open(url: str, data: bytes | None = None) -> tuple[str, str]:
    """Request through the shared session; returns (final URL, body)."""
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Referer": f"{BASE}/login"})
    with _opener.open(req, timeout=30) as resp:
        return resp.geturl(), resp.read().decode("utf-8", errors="replace")


def _is_login_page(url: str, html: str) -> bool:
    return urllib.parse.urlparse(url).path == "/login" or "<title>Login - QOJ.ac</title>" in html


def _login() -> None:
    username = os.environ.get("QOJ_USERNAME")
    password = os.environ.get("QOJ_PASSWORD")
    if not username or not password:
        raise HTTPException(503, "QOJ sync isn't set up on the server (QOJ_USERNAME / QOJ_PASSWORD)")
    _, html = _open(f"{BASE}/login")
    m = _TOKEN_RE.search(html)
    if not m:
        raise HTTPException(502, "QOJ's login page changed (no _token); the sync needs updating")
    form = urllib.parse.urlencode({
        "_token": m.group(1),
        "login": "",
        "username": username,
        "password": hashlib.md5(password.encode()).hexdigest(),  # QOJ expects md5 hex, not plaintext
    }).encode()
    _, body = _open(f"{BASE}/login", form)
    if body.strip() != "ok":
        raise HTTPException(502, "QOJ rejected the service account's login")


def fetch_qoj_profile(handle: str) -> str:
    """Profile HTML for `handle`, logging the service account in first if needed."""
    url = f"{BASE}/user/profile/{urllib.parse.quote(handle)}"
    try:
        for attempt in range(2):
            final_url, html = _open(url)
            if "Just a moment..." in html[:3000]:
                raise HTTPException(503, "QOJ is showing a Cloudflare check; try again later")
            if not _is_login_page(final_url, html):
                return html
            if attempt == 0:
                with _login_lock:
                    _login()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise HTTPException(404, f"QOJ user '{handle}' not found")
        raise HTTPException(502, f"QOJ server error (HTTP {e.code})")
    except urllib.error.URLError as e:
        raise HTTPException(502, f"Could not reach QOJ: {e.reason}")
    raise HTTPException(502, "Logged in to QOJ, but the profile still asks for a login")


def sync_user_qoj(user_id: int, handle: str | None = None) -> dict:
    """Import a user's QOJ accepted/tried problems as AC/WA statuses."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT qoj_handle FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    target_handle = (handle or "").strip() or (row[0] if row else None)
    if not target_handle:
        raise HTTPException(400, "QOJ handle required")

    accepted, tried = parse_qoj_profile_html(fetch_qoj_profile(target_handle))

    # qoj_cookie is no longer used; clear any session cookie a user pasted before.
    conn.execute(
        """UPDATE users SET qoj_handle = ?, qoj_cookie = NULL, qoj_last_synced = CURRENT_TIMESTAMP
           WHERE id = ?""",
        (target_handle, user_id),
    )

    # 1. AC always wins. Rows that are already AC are left alone so their
    # updated_at (the solve date the heatmap/activity feed use) isn't reset each sync.
    ac_pids = list(dict.fromkeys(accepted))
    for chunk in _chunked(ac_pids):
        values = ",".join(["(?, ?, 'AC')"] * len(chunk))
        args = [x for pid in chunk for x in (user_id, pid)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status='AC', updated_at=CURRENT_TIMESTAMP
                WHERE problem_status.status != 'AC'""",
            args,
        )

    # 2. "Tried" only fills rows with no verdict yet: never overwrites AC/NI or a
    # more specific WA/TL/RE, and never re-stamps an unchanged row.
    tried_pids = [pid for pid in dict.fromkeys(tried) if pid not in set(ac_pids)]
    for chunk in _chunked(tried_pids):
        values = ",".join(["(?, ?, 'WA')"] * len(chunk))
        args = [x for pid in chunk for x in (user_id, pid)]
        conn.execute(
            f"""INSERT INTO problem_status (user_id, problem_id, status)
                VALUES {values}
                ON CONFLICT(user_id, problem_id) DO UPDATE SET
                  status=excluded.status, updated_at=CURRENT_TIMESTAMP
                WHERE problem_status.status IN ('', 'No submission')""",
            args,
        )

    conn.commit()
    return {"handle": target_handle, "solved": len(ac_pids), "attempted": len(tried_pids)}


@router.post("")
def qoj_sync(body: QojSyncBody, user: dict = Depends(get_current_user)):
    return sync_user_qoj(user["id"], body.handle)


@router.get("/status")
def get_qoj_status(user: dict = Depends(get_current_user)):
    cur = get_conn().cursor()
    cur.execute("SELECT qoj_handle, qoj_last_synced FROM users WHERE id = ?", (user["id"],))
    row = cur.fetchone()
    if not row or not row[0]:
        return {"connected": False}
    return {"connected": True, "handle": row[0], "last_synced": row[1]}


@router.delete("")
def disconnect_qoj(user: dict = Depends(get_current_user)):
    conn = get_conn()
    conn.execute(
        "UPDATE users SET qoj_handle = NULL, qoj_cookie = NULL, qoj_last_synced = NULL WHERE id = ?",
        (user["id"],),
    )
    conn.commit()
    return {"status": "disconnected"}


def _sync_all() -> None:
    cur = get_conn().cursor()
    cur.execute("SELECT id, username, qoj_handle FROM users WHERE qoj_handle IS NOT NULL AND qoj_handle != ''")
    users = cur.fetchall()
    log.info("[QOJ Auto-Sync] syncing %d users", len(users))
    for uid, uname, handle in users:
        try:
            res = sync_user_qoj(uid)
            log.info("[QOJ Auto-Sync] User '%s' (%s): %d AC, %d WA", uname, handle, res["solved"], res["attempted"])
        except Exception as e:
            log.warning("[QOJ Auto-Sync] Could not sync user '%s' (%s): %s", uname, handle, e)


async def run_qoj_auto_sync_all():
    """Background task: sync every user with a QOJ handle (in a worker thread, so the
    blocking QOJ/DB requests don't stall the API's event loop)."""
    if not (os.environ.get("QOJ_USERNAME") and os.environ.get("QOJ_PASSWORD")):
        log.info("[QOJ Auto-Sync] skipped: QOJ_USERNAME / QOJ_PASSWORD not set")
        return
    try:
        await asyncio.to_thread(_sync_all)
    except Exception as e:
        log.error("[QOJ Auto-Sync] Background sync error: %s", e)
